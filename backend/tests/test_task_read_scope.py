"""Task list/detail/history/members and personal lists share real-account project scope."""
from urllib.parse import quote
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.routers import common
from tests.test_tasks_assign import _TaskBase


class TaskReadScopeTests(_TaskBase):
    def setUp(self):
        super().setUp()
        self.row = self.task(self.login("jessie"))
        self.urls = [f"/api/projects/{self.pid}/tasks", f"/api/projects/{self.pid}/tasks/{self.row['id']}",
                     f"/api/projects/{self.pid}/tasks/{self.row['id']}/events", f"/api/projects/{self.pid}/members"]

    def assert_scope(self, client, status):
        for url in self.urls:
            response = client.get(url)
            self.assertEqual(response.status_code, status, (url, response.text))

    def test_active_member_can_read_all_four_routes(self):
        self.assert_scope(self.login("a"), 200)

    def test_non_member_cannot_read_even_with_spoofed_actor(self):
        reader = self.login("a2")
        for demo_mode in (True, False):
            with patch.object(common, "DEMO_MODE", demo_mode):
                for actor in ("J", "D", quote("负责人")):
                    reader.headers["X-Actor"] = actor
                    self.assert_scope(reader, 403)

    def test_admin_preview_actor_does_not_replace_real_scope(self):
        with Session(self.engine) as session:
            session.get(models.User, self.uid["a2"]).is_admin = True
            session.commit()
        reader = self.login("a2")
        reader.headers["X-Actor"] = "J"
        with patch.object(common, "DEMO_MODE", True):
            self.assert_scope(reader, 403)

    def test_global_workbench_roles_keep_cross_project_reads(self):
        for role in ("J", "D", "项目助理", "负责人"):
            with Session(self.engine) as session:
                user = session.get(models.User, self.uid["a2"])
                user.role_code = role
                user.is_admin = role == "负责人"
                session.commit()
            self.assert_scope(self.login("a2"), 200)

    def test_inactive_membership_hides_residual_assignment_and_review(self):
        with Session(self.engine) as session:
            task = session.get(models.Task, self.row["id"])
            task.assignee_user_id = self.uid["a"]
            task.reviewer_user_id = self.uid["a"]
            member = session.scalar(select(models.ProjectMember).where(
                models.ProjectMember.project_id == self.pid, models.ProjectMember.user_id == self.uid["a"]))
            member.active = False
            session.commit()
        reader = self.login("a")
        self.assert_scope(reader, 403)
        self.assertEqual(reader.get("/api/me/tasks").json(), {"assigned": [], "reviewing": []})
        with Session(self.engine) as session:
            member = session.scalar(select(models.ProjectMember).where(
                models.ProjectMember.project_id == self.pid, models.ProjectMember.user_id == self.uid["a"]))
            member.active = True
            session.commit()
        self.assert_scope(reader, 200)
        self.assertEqual([row["id"] for row in reader.get("/api/me/tasks").json()["assigned"]], [self.row["id"]])

    def test_guests_remain_demo_only_and_members_still_require_login(self):
        reader = TestClient(self.app)
        self.addCleanup(reader.close)
        with patch.object(common, "DEMO_MODE", True):
            for url in self.urls[:3]:
                self.assertEqual(reader.get(url).status_code, 200)
            self.assertEqual(reader.get(self.urls[3]).status_code, 401)
        with patch.object(common, "DEMO_MODE", False):
            self.assert_scope(reader, 401)
