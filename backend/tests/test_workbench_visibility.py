"""KAN-75：工作台各区域共用账号的项目可见范围，先过滤交接再取最近六条。"""

import json
import unittest
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import db, models
from app.routers.tasks import ensure_tasks
from tests.test_tasks_assign import _TaskBase


class WorkbenchVisibilityTests(_TaskBase):
    def setUp(self):
        super().setUp()
        with Session(self.engine) as s:
            prop = models.Property(address_std="2 Other St")
            s.add(prop)
            s.flush()
            other = models.Project(property_id=prop.id, name="其他项目", stage="lead")
            s.add(other)
            s.flush()
            self.other_pid = other.id
            ensure_tasks(s, other.id)
            self.review_ids = {}
            for pid in (self.pid, self.other_pid):
                tasks = {t.step_key: t for t in s.scalars(select(models.Task).where(models.Task.project_id == pid))}
                tasks["view"].assignee_user_id = self.uid["b"]
                tasks["view"].exec_status = "waiting"
                tasks["view"].wait_reason = "等看房时间"
                review = tasks["screen"]
                review.assignee_user_id = self.uid["b"]
                review.reviewer_user_id = self.uid["a"]
                review.exec_status = "pending_review"
                self.review_ids[pid] = review.id
                s.add(models.TaskSubmission(task_id=review.id, project_id=pid, seq=1,
                                            note="风险已核对", submitted_by_user_id=self.uid["b"]))
                # 不可见项目有更多、更近的交接；不能先 limit(6) 再在 Python 中过滤。
                count, hour = (2, 10) if pid == self.pid else (8, 11)
                for minute in range(count):
                    s.add(models.TaskEvent(project_id=pid, task_id=tasks["view"].id,
                                           kind="reassigned", actor_user_id=self.uid["jessie"],
                                           before_json=json.dumps({"assignee_user_id": self.uid["a"]}),
                                           after_json=json.dumps({"assignee_user_id": self.uid["b"]}),
                                           created_at=f"2026-09-23T{hour:02d}:{minute:02d}:00"))
                if pid == self.pid:
                    tasks["design_final"].assignee_user_id = self.uid["a"]
            s.commit()

        # 请求会话与实际服务一致，避免 autoflush 掩盖问题。
        def session_override():
            with Session(self.engine, autoflush=False, expire_on_commit=False) as s:
                yield s

        self.app.dependency_overrides[db.get_db] = session_override

    def workbench(self, client):
        response = client.get("/api/me/workbench")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def assert_empty_workbench(self, data):
        for key in ("projects", "my_pending", "recent_handoffs"):
            self.assertEqual(data[key], [], key)
        self.assertEqual(data["counts"], {"projects": 0, "pending_review_mine": 0,
                                         "unassigned_current": 0, "waiting": 0})

    def test_member_scope_covers_projects_counts_pending_and_handoffs(self):
        wb = self.workbench(self.login("a"))
        self.assertEqual([p["project_id"] for p in wb["projects"]], [self.pid])
        self.assertEqual(wb["counts"], {"projects": 1, "pending_review_mine": 1,
                                      "unassigned_current": 2, "waiting": 1})
        self.assertEqual([t["id"] for t in wb["my_pending"]], [self.review_ids[self.pid]],
                         "其他项目残留的 reviewer_user_id 不能扩大工作台范围")
        self.assertEqual(wb["projects"][0]["next_action"]["task_id"], self.review_ids[self.pid])
        events = wb["recent_handoffs"]
        self.assertEqual(len(events), 2, "先按可见项目过滤，再取最近六条")
        self.assertEqual({e["project_id"] for e in events}, {self.pid})
        self.assertTrue(all(e["project_name"] == "测试房" and e["task_title"] == "看房" for e in events))
        self.assertGreater(events[0]["created_at"], events[1]["created_at"])

    def test_non_member_gets_empty_workbench_even_with_spoofed_role(self):
        a2 = self.login("a2")
        a2.headers["X-Actor"] = quote("负责人")
        self.assert_empty_workbench(self.workbench(a2))

    def test_deactivated_membership_hides_existing_assignments_and_reviews(self):
        a = self.login("a")
        self.assertEqual(len(self.workbench(a)["projects"]), 1)
        with Session(self.engine) as s:
            member = s.scalar(select(models.ProjectMember).where(
                models.ProjectMember.project_id == self.pid, models.ProjectMember.user_id == self.uid["a"]))
            member.active = False
            s.commit()
        self.assert_empty_workbench(self.workbench(a))
        with Session(self.engine) as s:
            member = s.scalar(select(models.ProjectMember).where(
                models.ProjectMember.project_id == self.pid, models.ProjectMember.user_id == self.uid["a"]))
            member.active = True
            s.commit()
        self.assertEqual([p["project_id"] for p in self.workbench(a)["projects"]], [self.pid])

    def test_decision_and_coordination_roles_keep_all_projects_without_membership(self):
        j = self.login("jessie")
        for role in ("J", "D", "负责人", "PM"):
            with self.subTest(role=role):
                with Session(self.engine) as s:
                    s.get(models.User, self.uid["jessie"]).role_code = role
                    s.commit()
                wb = self.workbench(j)
                self.assertEqual({p["project_id"] for p in wb["projects"]}, {self.pid, self.other_pid})
                self.assertEqual(wb["counts"], {"projects": 2, "pending_review_mine": 0,
                                              "unassigned_current": 4, "waiting": 2})
                self.assertEqual(len(wb["recent_handoffs"]), 6)
                self.assertEqual({e["project_id"] for e in wb["recent_handoffs"]}, {self.other_pid})

    def test_my_tasks_remains_isolated_by_account_for_same_role(self):
        a, a2 = self.login("a"), self.login("a2")
        self.workbench(a)
        self.workbench(a2)
        self.assertEqual([t["step_key"] for t in a.get("/api/me/tasks").json()["assigned"]], ["design_final"])
        self.assertEqual(a2.get("/api/me/tasks").json(), {"assigned": [], "reviewing": []})


if __name__ == "__main__":
    unittest.main()
