"""邮箱登录 / 导入 / demo 职责的隔离回归；所有地址与密码均为合成值。"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import db, models
from app.auth import hash_password, verify_password
from app.routers import auth, budget, ops, procurement, steps, tasks
from app.routers.common import allowed
from app.routers.files import _can_touch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("provision_users", ROOT / "scripts/provision_users.py")
provision = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(provision)
PASSWORD = "synthetic-demo-passphrase"
ROSTER = [{"name": "Test Planner", "email": "planner@example.com", "role": "J"},
          {"name": "Test Board", "email": "board@example.com", "role": "D"},
          {"name": "Test Buyer", "email": "buyer@example.com", "role": "采购"},
          {"name": "Test Designer", "email": "designer@example.com", "role": "Permit/设计"},
          {"name": "Test Finance", "email": "finance@example.com", "role": "财务"}]


class EmailAccountsTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.addCleanup(self.engine.dispose)
        db.Base.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            provision.provision_users(session, ROSTER, PASSWORD)
            prop = models.Property(address_std="100 Synthetic Test Road")
            session.add(prop); session.flush()
            project = models.Project(property_id=prop.id, name="Test house", stage="lead")
            session.add(project); session.flush()
            self.pid = project.id
            session.commit()
        app = FastAPI()
        for module in (auth, budget, ops, procurement, steps, tasks):
            app.include_router(module.router)
        def session_override():
            with Session(self.engine) as session:
                yield session
        app.dependency_overrides[db.get_db] = session_override
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def login(self, email, password=PASSWORD):
        self.client.cookies.clear()
        return self.client.post("/api/auth/login", json={"email": email, "password": password})

    def test_email_login_case_whitespace_and_internal_id(self):
        plain = self.login("planner@example.com")
        self.assertEqual(plain.status_code, 200)
        varied = self.login("  PLANNER@EXAMPLE.COM  ")
        self.assertEqual(varied.status_code, 200)
        self.assertEqual(plain.json()["id"], varied.json()["id"])
        self.assertIsInstance(plain.json()["id"], int)
        self.assertEqual(self.client.get("/api/auth/me").json()["id"], plain.json()["id"])

    def test_wrong_password_unlisted_and_inactive_are_rejected(self):
        self.assertEqual(self.login("planner@example.com", "wrong-test-secret").status_code, 401)
        self.assertEqual(self.login("unlisted@example.com").status_code, 401)
        with Session(self.engine) as session:
            user = session.scalar(select(models.User).where(models.User.email == "planner@example.com"))
            user.active = False
            session.commit()
        self.assertEqual(self.login("planner@example.com").status_code, 401)

    def test_reimport_preserves_password_id_admin_active_and_unlisted_user(self):
        with Session(self.engine) as session:
            user = session.scalar(select(models.User).where(models.User.email == "planner@example.com"))
            user.password_hash = hash_password("changed-test-passphrase")
            user.is_admin = True; user.active = False
            sentinel = models.User(username="untouched", email="untouched@example.com", display_name="Untouched",
                                   role_code="D", password_hash=hash_password("sentinel-test-passphrase"))
            session.add(sentinel); session.commit()
            identity, old_hash, sentinel_hash = user.id, user.password_hash, sentinel.password_hash
            rows = [{**ROSTER[0], "email": " PLANNER@EXAMPLE.COM ", "name": "Updated", "role": "D"}]
            provision.provision_users(session, rows, PASSWORD); session.commit()
            provision.provision_users(session, rows, PASSWORD); session.commit()
            self.assertEqual(session.query(models.User).count(), 6)
            self.assertEqual(user.id, identity)
            self.assertEqual(user.password_hash, old_hash)
            self.assertEqual((user.display_name, user.role_code, user.is_admin, user.active), ("Updated", "D", True, False))
            self.assertEqual((sentinel.display_name, sentinel.role_code, sentinel.password_hash), ("Untouched", "D", sentinel_hash))
            provision.provision_users(session, rows, PASSWORD, reset_password=True); session.commit()
            self.assertTrue(verify_password(PASSWORD, user.password_hash))

    def test_duplicate_legacy_email_fails_closed_without_changing_any_user(self):
        with Session(self.engine) as session:
            session.add(models.User(username="duplicate", email=" PLANNER@EXAMPLE.COM ", display_name="Duplicate",
                                    role_code="D", password_hash=hash_password(PASSWORD)))
            session.commit()
            with self.assertRaises(ValueError):
                provision.provision_users(session, ROSTER, PASSWORD)
            self.assertEqual(session.query(models.User).count(), 6)
        self.assertEqual(self.login("planner@example.com").status_code, 401)

    def test_legacy_username_login_still_works(self):
        with Session(self.engine) as session:
            session.add(models.User(username="legacy-demo", display_name="Legacy", role_code="J", password_hash=hash_password(PASSWORD)))
            session.commit()
        response = self.client.post("/api/auth/login", json={"username": "legacy-demo", "password": PASSWORD})
        self.assertEqual(response.status_code, 200)

    def test_admin_cannot_create_or_patch_a_duplicate_email(self):
        with Session(self.engine) as session:
            user = session.scalar(select(models.User).where(models.User.email == "planner@example.com"))
            user.is_admin = True; session.commit()
        self.assertEqual(self.login("planner@example.com").status_code, 200)
        response = self.client.post("/api/users", json={"username": "new-test", "display_name": "New",
            "role_code": "采购", "password": PASSWORD, "email": " BUYER@EXAMPLE.COM "})
        self.assertEqual(response.status_code, 409)
        users = self.client.get("/api/users").json()
        board = next(u for u in users if u["email"] == "board@example.com")
        self.assertEqual(self.client.patch(f"/api/users/{board['id']}", json={"email": " BUYER@EXAMPLE.COM "}).status_code, 409)

    def test_new_roles_allow_only_their_business_actions_and_never_gate_or_admin(self):
        for role, email, yes in [("采购", "buyer@example.com", {"procurement"}),
                                ("财务", "finance@example.com", {"read_money", "budget"}),
                                ("Permit/设计", "designer@example.com", {"inspections"})]:
            for action in ("procurement", "read_money", "budget", "inspections", "assign_tasks", "confirm_for_others",
                           "tick_any", "upload_any", "create_project", "edit_money", "workbench_all_projects", "utility_secret"):
                self.assertEqual(allowed(role, action), action in yes, (role, action))
            self.assertEqual(self.login(email).status_code, 200)
            self.assertEqual(self.client.get("/api/users").status_code, 403)
            self.assertEqual(self.client.get(f"/api/projects/{self.pid}/procurement").status_code, 200 if role == "采购" else 403)
            self.assertEqual(self.client.get(f"/api/projects/{self.pid}/budget-lines").status_code, 200 if role == "财务" else 403)
            for as_who in ("D", "J"):
                response = self.client.post(f"/api/projects/{self.pid}/steps/open_escrow", json={"done": True, "confirm_as": as_who})
                self.assertEqual(response.status_code, 403)
            self.assertEqual(self.client.get("/api/me/workbench").json()["projects"], [])
        for doc in ("drawing", "drawing_final", "permit_application", "permit", "inspection_report"):
            self.assertTrue(_can_touch("Permit/设计", doc, None))
        self.assertFalse(_can_touch("Permit/设计", "loan_doc", None))
        self.assertTrue(_can_touch("财务", "invoice", None))
        self.assertFalse(_can_touch("财务", "sale_signed", None))

    def test_cli_repeated_runs_reset_and_atomic_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            engine = create_engine(f"sqlite:///{path / 'app.db'}")
            db.Base.metadata.create_all(engine)
            roster = path / "users.json"
            roster.write_text(json.dumps(ROSTER))
            env = {**os.environ, "DATA_DIR": temp, "DB_URL": f"sqlite:///{path / 'app.db'}", "INITIAL_PASSWORD": PASSWORD}
            command = [sys.executable, str(ROOT / "scripts/provision_users.py"), str(roster)]
            for _ in range(2):
                result = subprocess.run(command, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn(PASSWORD, result.stdout + result.stderr)
                self.assertNotIn("@example.com", result.stdout + result.stderr)
            with Session(engine) as session:
                users = session.scalars(select(models.User)).all()
                self.assertEqual(len(users), len(ROSTER))
                hashes = [u.password_hash for u in users]
            env["INITIAL_PASSWORD"] = "replacement-test-passphrase"
            subprocess.run(command, env=env, check=True, capture_output=True)
            with Session(engine) as session:
                self.assertEqual([u.password_hash for u in session.scalars(select(models.User))], hashes)
            subprocess.run(command + ["--reset-password"], env=env, check=True, capture_output=True)
            with Session(engine) as session:
                self.assertTrue(all(verify_password(env["INITIAL_PASSWORD"], u.password_hash) for u in session.scalars(select(models.User))))
            roster.write_text(json.dumps([{"name": "Should not create", "email": "new@example.com", "role": "D"}, {**ROSTER[0], "role": "unknown"}]))
            self.assertNotEqual(subprocess.run(command, env=env, capture_output=True).returncode, 0)
            with Session(engine) as session:
                self.assertEqual(session.query(models.User).count(), len(ROSTER))
            engine.dispose()
