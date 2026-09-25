"""Exercise the actual three-house demo with signed-in accounts and isolated storage."""
from datetime import date
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app import db, models
from app.auth import hash_password
from app.routers import auth, analyses, budget, common, design_workspaces, files, ops, procurement, projects, property_data, steps, tasks

spec = importlib.util.spec_from_file_location("team_demo_system_fixture", Path(__file__).resolve().parents[2] / "scripts/prepare_team_demo.py")
demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo)


class TeamDemoWorkflowTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(prefix="team-demo-system-")
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.database = self.root / "app.db"
        self.uploads = self.root / "uploads"
        self.uploads.mkdir()
        self.engine = create_engine(f"sqlite:///{self.database}", connect_args={"check_same_thread": False})
        self.addCleanup(self.engine.dispose)
        db.Base.metadata.create_all(self.engine)
        self.password = "Isolated-system-fixture-47!"
        self.uid = {}
        roster = []
        with Session(self.engine) as session:
            for slot, role in {**demo.SLOTS, "admin": "负责人", "outsider": "采购"}.items():
                user = models.User(username=f"{slot}@example.com", email=f"{slot}@example.com", display_name=slot.title(), role_code=role,
                                   is_admin=slot == "admin", password_hash=hash_password(self.password))
                session.add(user); session.flush(); self.uid[slot] = user.id
                if slot in demo.SLOTS: roster.append({"name": slot.title(), "email": user.email, "role": role})
            session.commit()
        report = demo.prepare_demo(self.database, self.uploads, roster, self.uid["admin"], date(2026, 9, 25), apply=True, backup_dir=self.root / "backups")
        self.pids = report["project_ids"]
        app = FastAPI()
        for router in (auth, analyses, budget, design_workspaces, files, ops, procurement, projects, property_data, steps, tasks):
            app.include_router(router.router)
        def isolated_session():
            with Session(self.engine, autoflush=False, expire_on_commit=False) as session:
                yield session
        app.dependency_overrides[db.get_db] = isolated_session
        self.app = app
        self.addCleanup(patch.stopall)
        patch.object(common, "DEMO_MODE", False).start()
        patch.object(files, "UPLOAD_DIR", self.uploads).start()
        self.clients = {slot: self.login(slot) for slot in self.uid}

    def login(self, slot):
        client = TestClient(self.app)
        self.addCleanup(client.close)
        response = client.post("/api/auth/login", json={"username": f"  {slot.upper()}@EXAMPLE.COM  ", "password": self.password})
        self.assertEqual(response.status_code, 200)
        return client

    def request(self, slot, method, path, payload=None, expected=200):
        kwargs = {} if payload is None else {"json": payload}
        result = getattr(self.clients[slot], method)(path, **kwargs)
        self.assertEqual(result.status_code, expected, result.text[:500])
        return result.json() if result.content else None

    def action(self, slot, task, endpoint, **payload):
        return self.request(slot, "post", f"/api/projects/{task['project_id']}/tasks/{task['id']}/{endpoint}", {"version": task["version"], **payload})

    def test_every_account_has_real_work_and_account_isolation(self):
        assigned_ids = []
        for slot in (*demo.SLOTS, "admin"):
            mine = self.request(slot, "get", "/api/me/tasks")
            self.assertGreaterEqual(len(mine["assigned"]), 6, slot)
            self.assertTrue(all(t["assignee"]["id"] == self.uid[slot] for t in mine["assigned"]))
            self.assertTrue(any(t["stage_index"] <= t["project_current_stage_index"] and t["exec_status"] in {"not_started", "in_progress"} for t in mine["assigned"]), slot)
            assigned_ids.extend(t["id"] for t in mine["assigned"])
            wb = self.request(slot, "get", "/api/me/workbench")
            self.assertEqual({p["project_id"] for p in wb["projects"]}, set(self.pids))
            keys = {r["key"] for r in self.request(slot, "get", "/api/design-workspaces")["items"]}
            expected = 7 if slot == "admin" else 6 if slot == "david" else 5 if slot == "jessie" else 1
            self.assertEqual(len(keys), expected, slot)
        self.assertEqual(len(assigned_ids), len(set(assigned_ids)))
        self.assertEqual(self.request("outsider", "get", "/api/me/tasks")["assigned"], [])
        self.assertEqual(self.request("outsider", "get", "/api/me/workbench")["projects"], [])
        for pid in self.pids:
            self.request("outsider", "get", f"/api/projects/{pid}/tasks", expected=403)
        anon = TestClient(self.app)
        self.addCleanup(anon.close)
        for path in ("/api/me/tasks", "/api/design-workspaces", "/api/projects", f"/api/projects/{self.pids[0]}/property", f"/api/projects/{self.pids[0]}/inspections"):
            self.assertEqual(anon.get(path).status_code, 401, path)

    def test_all_eight_people_can_deliver_and_reviewers_get_immediate_results(self):
        for slot in (*demo.SLOTS, "admin"):
            mine = self.request(slot, "get", "/api/me/tasks")["assigned"]
            task = next(t for t in mine if t["step_key"] is None and t["exec_status"] == "not_started")
            task = self.action(slot, task, "status", action="start")
            task = self.action(slot, task, "status", action="wait", wait_for="Synthetic vendor", wait_reason="Confirm delivery date", wait_until="2026-09-27")
            self.assertEqual(task["exec_status"], "waiting")
            task = self.action(slot, task, "status", action="resume")
            task = self.action(slot, task, "submit", note="Synthetic account delivery")
            reviewer = next(s for s, uid in self.uid.items() if uid == task["reviewer"]["id"])
            reviewing = self.request(reviewer, "get", "/api/me/tasks")["reviewing"]
            self.assertTrue(any(t["id"] == task["id"] and t["exec_status"] == "pending_review" for t in reviewing))
            task = self.action(reviewer, task, "return", reason="Add source and date")
            task = self.action(slot, task, "submit", note="Corrected with source and date")
            task = self.action(reviewer, task, "confirm")
            self.assertEqual(task["exec_status"], "done")
            self.assertEqual([s["decision"] for s in task["submissions"]], ["confirmed", "returned"])
            reloaded = self.request(slot, "get", f"/api/projects/{task['project_id']}/tasks/{task['id']}")
            self.assertEqual(reloaded["exec_status"], "done")

    def test_business_modules_write_and_financial_boundaries(self):
        pid = self.pids[1]
        rows = self.request("tristin", "get", f"/api/projects/{pid}/procurement")["items"]
        for slot, row in zip(("tristin", "jeremy"), rows[:2]):
            updated = self.request(slot, "patch", f"/api/procurement/{row['id']}", {"status": "received", "note": "Synthetic checked delivery"})
            self.assertEqual(next(i for i in updated["items"] if i["id"] == row["id"])["status"], "received")
        updated = self.request("kody", "put", f"/api/projects/{pid}/utilities/gas", {"company": "Synthetic utility", "status": "on", "blocker": "Confirmed appointment", "account_no": "DEMO-ONLY"})
        self.assertEqual(next(u for u in updated if u["kind"] == "gas")["blocker"], "Confirmed appointment")
        expense = self.request("sabrina", "post", f"/api/projects/{pid}/expenses", {"category": "厨房", "amount": 123.45, "date": "2026-09-25", "note": "Synthetic receipt"}, expected=201)
        self.assertEqual(expense["amount"], 123.45)
        self.request("sabrina", "get", f"/api/projects/{pid}/analyses", expected=403)
        for slot in ("kody", "tristin", "jeremy", "zoey"):
            self.request(slot, "get", f"/api/projects/{pid}/budget-summary", expected=403)
            project = self.request(slot, "get", f"/api/projects/{pid}")
            self.assertTrue(project["money_hidden"])
            self.assertIsNone(project["purchase_price"])
        for slot, doc_type in (("kody", "insurance"), ("zoey", "drawing_final"), ("sabrina", "invoice")):
            available = self.request(slot, "get", f"/api/projects/{pid}/files")
            row = next(f for f in available if f["doc_type"] == doc_type)
            response = self.clients[slot].get(f"/api/files/{row['id']}/download")
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.content.startswith(b"%PDF"))
            self.request(slot, "patch", f"/api/files/{row['id']}", {"doc_date": "2026-09-25"})
        financial_file = next(f for f in self.request("jessie", "get", f"/api/projects/{pid}/files") if f["doc_type"] == "loan_doc")
        self.request("kody", "get", f"/api/files/{financial_file['id']}/download", expected=403)

    def test_all_stage_gates_latest_final_and_closeout(self):
        def current(pid):
            return self.request("jessie", "get", f"/api/projects/{pid}/steps")
        def confirm(pid, key, slot):
            return self.request(slot, "post", f"/api/projects/{pid}/steps/{key}", {"done": True})
        cedar, oak, pine = self.pids
        self.assertEqual([current(pid)["current_stage"]["key"] for pid in self.pids], ["s1", "s3", "s5"])
        for pid in self.pids:
            self.assertEqual(sum(len(s["items"]) for s in current(pid)["stages"]), 31)
        confirm(cedar, "open_escrow", "david")
        self.assertEqual(current(cedar)["current_stage"]["key"], "s1")
        confirm(cedar, "open_escrow", "jessie")
        self.assertEqual(current(cedar)["current_stage"]["key"], "s2")
        for slot in ("david", "jessie"): confirm(cedar, "close_escrow", slot)
        self.assertEqual(current(cedar)["current_stage"]["key"], "s3")
        for slot in ("david", "jessie"):
            self.request(slot, "post", f"/api/projects/{oak}/steps/final", {"done": True}, expected=400)
        self.request("zoey", "post", f"/api/projects/{oak}/inspections", {"name": "Synthetic Final reinspection", "date": "2026-09-25", "result": "passed", "is_final": True}, expected=201)
        # Existing D/J historical confirmations remain the existing business rule.
        self.assertEqual(current(oak)["current_stage"]["key"], "s4")
        self.request("jessie", "patch", f"/api/projects/{oak}", {"list_date": "2026-09-25"})
        self.assertEqual(current(oak)["current_stage"]["key"], "s5")
        self.request("zoey", "post", f"/api/projects/{pine}/steps/closed", {"done": True, "confirm_as": "D"}, expected=403)
        for slot in ("david", "jessie"): confirm(pine, "closed", slot)
        self.assertEqual(current(pine)["current_stage"]["key"], "s6")
        self.request("kody", "put", f"/api/projects/{pine}/utilities/gas", {"status": "off", "company": "Synthetic utility"})
        self.assertEqual(current(pine)["current_stage"]["key"], "done")
