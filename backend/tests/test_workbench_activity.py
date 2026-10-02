"""Real role assignment and exactly scoped workflow statistics, using synthetic records."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from sqlalchemy import select, func, text
from sqlalchemy.orm import Session
from app import models, task_activity
from app.auth import hash_password
from tests.test_tasks_assign import _TaskBase


class WorkbenchActivityTests(_TaskBase):
    def setUp(self):
        super().setUp()
        with Session(self.engine) as s:
            u = models.User(username="cody", display_name="Synthetic Cody", role_code="项目助理", password_hash=hash_password("Task-fixture-only-73!"))
            s.add(u); s.flush(); self.cody_id = u.id
            t = models.Task(project_id=self.pid, source="adhoc", title="Reviewable delivery", stage_key="s6")
            s.add(t); s.flush(); self.tid = t.id
            s.commit(); task_activity.initialize(s)
        self.j = self.login("jessie"); self.cody = self.login("cody")
        self.url = f"/api/projects/{self.pid}/tasks/{self.tid}"

    def current(self):
        return self.j.get(self.url).json()

    def assign(self, client=None, **data):
        return (client or self.j).post(self.url + "/assign", json={"version": self.current()["version"], **data})

    def test_assistant_role_assignment_preserves_or_explicitly_fills_reviewer(self):
        result = self.assign(self.cody, assignee_user_id=self.uid["a2"], assistant_user_id=self.uid["b"])
        self.assertEqual(result.status_code, 200, result.text)
        self.assertIsNone(result.json()["reviewer"])
        members = self.cody.get(f"/api/projects/{self.pid}/members").json()["members"]
        self.assertTrue({self.uid["a2"], self.uid["b"]}.issubset({m["id"] for m in members}))
        self.assertTrue(result.json()["actions"]["assign"])
        self.assertFalse(result.json()["actions"]["start"])
        explicit = self.assign(self.cody, reviewer_user_id=self.uid["jessie"])
        self.assertEqual(explicit.status_code, 200, explicit.text)
        self.assertEqual(explicit.json()["reviewer"]["id"], self.uid["jessie"])
        self.assertEqual(self.assign(self.cody, reviewer_user_id=self.uid["b"]).status_code, 409)
        self.assertEqual(self.assign(self.login("b"), assignee_user_id=self.uid["b"]).status_code, 403)
        self.assertEqual(self.assign(self.cody, assistant_user_id=self.uid["a2"], reason="Invalid pair").status_code, 400)
        self.assertEqual(self.current()["reviewer"]["id"], self.uid["jessie"])

    def test_workflow_counts_ignore_notes_assignments_and_use_same_frozen_detail_window(self):
        result = self.assign(assignee_user_id=self.uid["a"], assistant_user_id=self.uid["b"])
        self.assertEqual(result.status_code, 200, result.text)
        a, b = self.login("a"), self.login("b")
        self.assertEqual(b.post(self.url + "/notes", json={"request_key": str(uuid4()), "text": "Original collaboration note"}).status_code, 200)
        def action(client, suffix, **body):
            r = client.post(self.url + suffix, json={"version": self.current()["version"], **body})
            self.assertEqual(r.status_code, 200, r.text)
        action(a, "/status", action="start")
        action(a, "/status", action="wait", wait_reason="Waiting on synthetic response")
        frozen = self.j.get("/api/me/workbench").json()
        self.assertEqual(frozen["projects"][0]["activity_count"], 2)
        self.assertEqual([r["id"] for r in frozen["projects"][0]["in_progress_tasks"]], [self.tid])
        action(a, "/status", action="resume")
        action(a, "/submit", note="Original delivery")
        action(self.j, "/return", reason="Needs changes")
        action(a, "/submit", note="Second delivery")
        action(self.j, "/confirm")
        detail = self.j.get(f"/api/projects/{self.pid}/task-activity", params={"until": frozen["activity_window"]["until"], "limit": 1}).json()
        self.assertEqual(detail["total"], 2)
        next_page = self.j.get(f"/api/projects/{self.pid}/task-activity", params={"until": detail["window"]["until"], "cursor": detail["next_cursor"], "limit": 1}).json()
        self.assertEqual(next_page["total"], 2)
        self.assertNotEqual(detail["items"][0]["id"], next_page["items"][0]["id"])
        self.assertIsNone(next_page["next_cursor"])
        self.assertEqual(self.j.get("/api/me/workbench").json()["projects"][0]["activity_count"], 7)
        self.assertEqual(self.j.get("/api/me/workbench", params={"search": "No matching property"}).json()["counts"]["projects"], 0)
        self.assertEqual(self.j.get(f"/api/projects/{self.pid}/task-activity", params={"until": "2026-10-02T01:02:03"}).status_code, 400)
        self.assertEqual(self.j.get(f"/api/projects/{self.pid}/task-activity", params={"cursor": "bad"}).status_code, 400)

    def test_legacy_events_are_not_guessed_and_reads_do_not_write(self):
        with Session(self.engine) as s:
            s.execute(text("INSERT INTO task_events(task_id,project_id,kind,created_at) VALUES(:t,:p,'waiting','2026-10-02T01:02:03')"), {"t": self.tid, "p": self.pid})
            s.commit()
            before = s.scalar(select(func.count()).select_from(models.TaskEvent))
        for _ in range(2):
            self.j.get("/api/me/workbench"); self.j.get(self.url)
            detail = self.j.get(f"/api/projects/{self.pid}/task-activity").json()
            self.assertEqual(detail["total"], 0)
        with Session(self.engine) as s:
            self.assertEqual(s.scalar(select(func.count()).select_from(models.TaskEvent)), before)
            self.assertEqual(s.scalar(select(func.count()).select_from(models.TaskWorkflowTransition)), 0)

    def test_stats_filter_out_sensitive_tasks_and_invisible_projects(self):
        with Session(self.engine) as s:
            p = models.Project(property_id=s.get(models.Project, self.pid).property_id, name="Hidden synthetic property"); s.add(p); s.flush()
            t = models.Task(project_id=p.id, title="Hidden task", source="adhoc", stage_key="s1"); s.add(t); s.flush()
            s.add(models.TaskEvent(task_id=t.id, project_id=p.id, kind="waiting"))
            money_task = s.scalar(select(models.Task).where(models.Task.project_id == self.pid, models.Task.step_key == "loan_doc"))
            if money_task is None:
                money_task = models.Task(project_id=self.pid, title="Loan evidence", source="template", stage_key="s2", step_key="loan_doc"); s.add(money_task); s.flush()
            s.add(models.TaskEvent(task_id=money_task.id, project_id=self.pid, kind="started"))
            self.hidden_pid = p.id; s.commit()
        a = self.login("a")
        self.assertEqual(a.get(f"/api/projects/{self.hidden_pid}/task-activity").status_code, 403)
        self.assertEqual(a.get("/api/me/workbench").json()["counts"]["projects"], 1)
        self.assertEqual(self.cody.get(f"/api/projects/{self.pid}/task-activity").json()["total"], 0)
