"""Actual signed-cookie authorization against an isolated temporary database."""

from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import quote
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app import db, models
from app.auth import COOKIE_NAME, make_token
from app.routers import design_workspaces


class DesignWorkspacesTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory(prefix="design-workspaces-tests-")
        self.addCleanup(directory.cleanup)
        self.engine = create_engine(f"sqlite:///{Path(directory.name) / 'isolated.db'}",
                                    connect_args={"check_same_thread": False})
        self.addCleanup(self.engine.dispose)
        db.Base.metadata.create_all(self.engine)
        self.users = {}
        with Session(self.engine) as session:
            for name, role, admin in (("planner", "J", False), ("assistant", "项目助理", False),
                                      ("buyer_one", "采购", False), ("buyer_two", "采购", False),
                                      ("designer", "Permit/设计", False), ("finance", "财务", False),
                                      ("director", "D", False), ("admin", "负责人", True),
                                      ("legacy", "K", False), ("fake_t", "T", False), ("fake_number", "001", False), ("legacy_boss", "老板", False)):
                user = models.User(username=name, email=f"{name}@example.com", display_name=f"Test {name}",
                                   role_code=role, is_admin=admin, password_hash="unused-test-hash")
                session.add(user)
                session.flush()
                self.users[name] = user.id
            session.commit()
        app = FastAPI()
        app.include_router(design_workspaces.router)

        def override_db():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[db.get_db] = override_db
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def headers(self, name):
        return {"Cookie": f"{COOKIE_NAME}={make_token(self.users[name])}"}

    def directory(self, name, extra_headers=None):
        return self.client.get("/api/design-workspaces", headers={**self.headers(name), **(extra_headers or {})})

    def detail(self, name, key, extra_headers=None):
        return self.client.get(f"/api/design-workspaces/{key}", headers={**self.headers(name), **(extra_headers or {})})

    def assert_full_access(self, name):
        directory = self.directory(name)
        self.assertEqual(directory.status_code, 200)
        self.assertTrue(directory.json()["can_view_all"])
        self.assertEqual({item["key"] for item in directory.json()["items"]},
                         {"jessie", "kody", "procurement", "zoey", "sabrina", "david", "admin"})
        for key in ("jessie", "kody", "procurement", "zoey", "sabrina", "david", "admin"):
            self.assertEqual(self.detail(name, key).status_code, 200)

    def test_anonymous_is_rejected_for_directory_and_detail(self):
        for url in ("/api/design-workspaces", "/api/design-workspaces/jessie", "/api/design-workspaces/missing"):
            self.assertEqual(self.client.get(url, headers={"X-Actor": "J"}).status_code, 401)

    def test_disabled_account_is_rejected(self):
        with Session(self.engine) as session:
            session.get(models.User, self.users["assistant"]).active = False
            session.commit()
        self.assertEqual(self.directory("assistant").status_code, 401)
        self.assertEqual(self.detail("assistant", "kody").status_code, 401)

    def test_kody_has_only_own_workspace_and_cannot_read_jessie(self):
        response = self.directory("assistant").json()
        self.assertFalse(response["can_view_all"])
        self.assertEqual([item["key"] for item in response["items"]], ["kody"])
        self.assertTrue(self.detail("assistant", "kody").json()["available"])
        self.assertEqual(self.detail("assistant", "jessie").status_code, 403)

    def test_procurement_cannot_read_design_or_finance(self):
        self.assertEqual([x["key"] for x in self.directory("buyer_one").json()["items"]], ["procurement"])
        for key in ("zoey", "sabrina", "admin", "david", "kody", "jessie"):
            self.assertEqual(self.detail("buyer_one", key).status_code, 403)

    def test_two_accounts_share_their_role_workspace(self):
        first = self.detail("buyer_one", "procurement")
        second = self.detail("buyer_two", "procurement")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json(), second.json())

    def test_designer_and_finance_are_separate(self):
        for name, own, other in (("designer", "zoey", "sabrina"), ("finance", "sabrina", "zoey")):
            response = self.directory(name).json()
            self.assertEqual([x["key"] for x in response["items"]], [own])
            self.assertFalse(response["can_view_all"])
            self.assertEqual(self.detail(name, own).status_code, 200)
            self.assertEqual(self.detail(name, other).status_code, 403)

    def assert_scoped_access(self, name, expected):
        directory = self.directory(name)
        self.assertEqual(directory.status_code, 200)
        self.assertFalse(directory.json()["can_view_all"])
        self.assertEqual({item["key"] for item in directory.json()["items"]}, expected)
        for key in ("jessie", "kody", "procurement", "zoey", "sabrina", "david", "admin"):
            with self.subTest(user=name, workspace=key):
                self.assertEqual(self.detail(name, key).status_code, 200 if key in expected else 403)

    def test_jessie_can_view_employee_designs_but_not_director_or_founder(self):
        self.assert_scoped_access("planner", {"jessie", "kody", "procurement", "zoey", "sabrina"})

    def test_david_can_view_director_and_employee_designs_but_not_founder(self):
        self.assert_scoped_access("director", {"jessie", "kody", "procurement", "zoey", "sabrina", "david"})

    def test_admin_can_view_all_without_role_name_mapping(self):
        self.assert_full_access("admin")

    def test_unmatched_legacy_roles_have_empty_directory(self):
        for name in ("legacy", "legacy_boss", "fake_t", "fake_number"):
            self.assertEqual(self.directory(name).json(), {"items": [], "can_view_all": False})
            self.assertEqual(self.detail(name, "admin").status_code, 403)
            self.assertEqual(self.detail(name, "kody").status_code, 403)

    def test_actor_spoofing_cannot_expand_or_change_signed_identity(self):
        for role in ("D", "J", quote("负责人")):
            header = {"X-Actor": role}
            self.assertEqual([x["key"] for x in self.directory("assistant", header).json()["items"]], ["kody"])
            self.assertEqual(self.detail("assistant", "jessie", header).status_code, 403)
        self.assertEqual(len(self.directory("planner", {"X-Actor": "K"}).json()["items"]), 5)
        for name, key in (("planner", "david"), ("planner", "admin"), ("director", "admin")):
            for role in ("D", "J", "T", quote("负责人")):
                self.assertEqual(self.detail(name, key, {"X-Actor": role}).status_code, 403)

    def test_unknown_key_is_404_after_authentication(self):
        for name in ("assistant", "admin"):
            self.assertEqual(self.detail(name, "not-a-workspace").status_code, 404)

    def test_leadership_names_and_shared_business_facts(self):
        david = self.detail("director", "david").json()
        founder = self.detail("admin", "admin").json()
        self.assertTrue(david["available"])
        self.assertTrue(founder["available"])
        self.assertEqual(founder["title"], "T · 集团创始人")
        self.assertEqual(david["preview"]["projects"], founder["preview"]["projects"])
        self.assertEqual(david["preview"]["kind"], "leadership")
        self.assertEqual(founder["preview"]["person"]["display_name"], "T")
        for preview in (david["preview"], founder["preview"]):
            self.assertEqual({d["id"] for d in preview["designs"]}, {"A", "B", "C"})

    def test_leadership_loader_never_runs_for_staff_or_spoofed_roles(self):
        with patch.object(design_workspaces, "_load_leadership_blueprint", side_effect=AssertionError("must authorize first")):
            for name in ("assistant", "buyer_one", "buyer_two", "designer", "finance", "fake_t", "fake_number"):
                for key in ("david", "admin"):
                    self.assertEqual(self.detail(name, key, {"X-Actor": "D"}).status_code, 403)
            for key in ("david", "admin"):
                self.assertEqual(self.client.get(f"/api/design-workspaces/{key}").status_code, 401)

    def test_hierarchy_denial_happens_before_loading_leadership_data(self):
        with patch.object(design_workspaces, "_load_leadership_blueprint", side_effect=AssertionError("must authorize first")):
            for name, key in (("planner", "david"), ("planner", "admin"), ("director", "admin")):
                self.assertEqual(self.detail(name, key).status_code, 403)

    def test_role_and_admin_changes_take_effect_for_existing_signed_session(self):
        token = self.headers("admin")
        self.assertEqual(self.client.get("/api/design-workspaces/admin", headers=token).status_code, 200)
        with Session(self.engine) as session:
            user = session.get(models.User, self.users["admin"])
            user.is_admin = False
            user.role_code = "D"
            session.commit()
        self.assertEqual(self.client.get("/api/design-workspaces/admin", headers=token).status_code, 403)
        self.assertEqual(self.client.get("/api/design-workspaces/david", headers=token).status_code, 200)
        with Session(self.engine) as session:
            session.get(models.User, self.users["admin"]).role_code = "J"
            session.commit()
        self.assertEqual(self.client.get("/api/design-workspaces/david", headers=token).status_code, 403)
        self.assertEqual(self.client.get("/api/design-workspaces/jessie", headers=token).status_code, 200)

    def test_kody_receives_only_own_design_and_assigned_tasks(self):
        synthetic = {
            "people": {"jessie": {"display_name": "Jessie"}, "kody": {"display_name": "Kody"}},
            "designs": {"jessie": [{"id": "J-only"}], "kody": [{"id": "K-only"}]},
            "houses": [{"id": "synthetic-house"}],
            "tasks": [{"id": "k-task", "person": "Kody"}, {"id": "j-task", "person": "Jessie"},
                      {"id": "other-task", "person": "Test buyer"}],
        }
        with patch.object(design_workspaces, "_load_blueprints", return_value=synthetic):
            kody = self.detail("assistant", "kody").json()["preview"]
            self.assertEqual(kody["person"], {"display_name": "Kody"})
            self.assertEqual(kody["designs"], [{"id": "K-only"}])
            self.assertEqual(kody["tasks"], [{"id": "k-task", "person": "Kody"}])
            self.assertNotIn("J-only", str(kody))
            self.assertNotIn("j-task", str(kody))
            jessie = self.detail("planner", "jessie").json()["preview"]
            self.assertEqual(jessie["designs"], [{"id": "J-only"}])
            self.assertEqual(len(jessie["tasks"]), 3)

    def test_blueprints_are_not_loaded_on_unauthorized_requests(self):
        with patch.object(design_workspaces, "_load_blueprints", side_effect=AssertionError("must authorize first")):
            self.assertEqual(self.detail("assistant", "jessie").status_code, 403)
            self.assertEqual(self.detail("buyer_one", "kody").status_code, 403)
            self.assertEqual(self.client.get("/api/design-workspaces/kody").status_code, 401)

    def test_specialist_loader_runs_only_after_real_account_authorization(self):
        with patch.object(design_workspaces, "_load_specialist_blueprint", return_value={"scoped": True}) as loader:
            for user, key in (("buyer_one", "procurement"), ("designer", "zoey"), ("finance", "sabrina")):
                for other in {"procurement", "zoey", "sabrina"} - {key}:
                    self.assertEqual(self.detail(user, other, {"X-Actor": "J"}).status_code, 403)
                loader.assert_not_called()
                self.assertEqual(self.detail(user, key).json()["preview"], {"scoped": True})
                loader.assert_called_once_with(key)
                loader.reset_mock()
            self.assertEqual(self.client.get("/api/design-workspaces/sabrina").status_code, 401)
            loader.assert_not_called()

    def test_specialist_payloads_have_distinct_records_and_complete_comparisons(self):
        record_sets = []
        for user, key in (("buyer_one", "procurement"), ("designer", "zoey"), ("finance", "sabrina")):
            data = self.detail(user, key).json()
            self.assertTrue(data["available"])
            preview = data["preview"]
            self.assertEqual({d["id"] for d in preview["designs"]}, {"A", "B", "C"})
            self.assertTrue(preview["records"])
            houses = {h["id"] for h in preview["houses"]}
            ids = {r["id"] for r in preview["records"]}
            self.assertEqual(len(ids), len(preview["records"]))
            for record in preview["records"]:
                self.assertIn(record["house"], houses)
                if key != "sabrina":
                    self.assertNotIn("amount", record)
                    self.assertNotIn("planned", record)
            for previous in record_sets:
                self.assertFalse(ids & previous)
            record_sets.append(ids)

    def test_reading_directory_does_not_write_business_or_feedback_records(self):
        self.assert_scoped_access("planner", {"jessie", "kody", "procurement", "zoey", "sabrina"})
        self.assert_full_access("admin")
        with Session(self.engine) as session:
            for model in (models.Project, models.Task, models.ProjectStep, models.TaskEvent,
                          models.TaskSubmission, models.ProjectUpdate):
                self.assertEqual(session.scalar(select(func.count()).select_from(model)), 0)
            self.assertEqual(session.scalar(select(func.count()).select_from(models.User)), len(self.users))


if __name__ == "__main__":
    unittest.main()
