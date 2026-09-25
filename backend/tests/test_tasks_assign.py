"""Run with: python -m unittest discover -s tests (requires httpx).

KAN-75 块 1：任务实例、真实账号分派、开始 / 等待 / 恢复、改派留痕。

场景照票面验收 1、2 写：合成账号 J（统筹）/ A、A2（同为设计师，故意两个）/ B。
"""

import unittest
from urllib.parse import quote

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import db, models
from app.auth import hash_password
from app.routers.auth import router as auth_router
from app.routers.tasks import ORDINARY_ITEMS, ensure_member, ensure_tasks, router as tasks_router
from app.steps import compute_steps


class _TaskBase(unittest.TestCase):
    """公共布置：一套房、四个账号、24 项任务实例；J 与 A 是成员。"""

    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.addCleanup(self.engine.dispose)
        db.Base.metadata.create_all(self.engine)
        with Session(self.engine) as s:
            prop = models.Property(address_std="1 Test St")
            s.add(prop); s.flush()
            self.project = models.Project(property_id=prop.id, name="测试房", stage="lead")
            s.add(self.project); s.flush()
            self.pid = self.project.id
            users = {}
            for name, role in (("jessie", "J"), ("a", "设计师"), ("a2", "设计师"), ("b", "Z")):
                u = models.User(username=name, display_name=f"员工{name.upper()}" if name != "jessie" else "Jessie",
                                role_code=role, password_hash=hash_password("Task-fixture-only-73!"))
                s.add(u); s.flush()
                users[name] = u.id
            self.uid = users
            ensure_tasks(s, self.pid)
            # J 是创建者、A 是成员；A2、B 不是成员
            ensure_member(s, self.pid, s.get(models.User, users["jessie"]), None)
            ensure_member(s, self.pid, s.get(models.User, users["a"]), None)
            s.commit()

        def session_override():
            with Session(self.engine) as s:
                yield s

        app = FastAPI()
        app.include_router(auth_router)
        app.include_router(tasks_router)
        app.dependency_overrides[db.get_db] = session_override
        self.app = app

    def login(self, name: str) -> TestClient:
        c = TestClient(self.app)
        self.addCleanup(c.close)
        r = c.post("/api/auth/login", json={"username": name, "password": "Task-fixture-only-73!"})
        self.assertEqual(r.status_code, 200, r.text)
        return c

    def task(self, client: TestClient, step_key="design_final") -> dict:
        r = client.get(f"/api/projects/{self.pid}/tasks")
        self.assertEqual(r.status_code, 200, r.text)
        return next(t for t in r.json()["tasks"] if t["step_key"] == step_key)



class TaskAssignTests(_TaskBase):
    # ---- 预建 ----
    def test_ensure_tasks_builds_24_ordinary_items_and_is_idempotent(self):
        with Session(self.engine) as s:
            rows = ensure_tasks(s, self.pid)
            self.assertEqual(len(rows), len(ORDINARY_ITEMS))
            self.assertEqual(len(ORDINARY_ITEMS), 24)
            self.assertEqual(len(ensure_tasks(s, self.pid)), 24)
            self.assertFalse(any(t.step_key in ("open_escrow", "final", "listing") for t in rows), "关键节点不建任务实例")

    # ---- 分派 ----
    def test_assign_requires_real_login_even_with_x_actor(self):
        anon = TestClient(self.app, headers={"X-Actor": quote("负责人")})
        self.addCleanup(anon.close)
        t = self.task(anon)  # 演示模式可以看
        r = anon.post(f"/api/projects/{self.pid}/tasks/{t['id']}/assign", json={"version": t["version"], "assignee_user_id": self.uid["a"]})
        self.assertEqual(r.status_code, 401)

    def test_jessie_assigns_to_member_a_and_only_a_sees_it(self):
        j = self.login("jessie")
        t = self.task(j)
        r = j.post(f"/api/projects/{self.pid}/tasks/{t['id']}/assign", json={"version": t["version"], "assignee_user_id": self.uid["a"], "due_at": ""})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["assignee"]["id"], self.uid["a"])
        self.assertEqual(body["reviewer"]["id"], self.uid["jessie"], "审核人为空时默认是分派的人")
        self.assertIsNone(body["due_at"], "截止日期允许为空")
        self.assertEqual(body["version"], t["version"] + 1)
        self.assertEqual(body["last_event"]["kind"], "assigned")
        a = self.login("a")
        mine = a.get("/api/me/tasks").json()
        self.assertEqual([x["step_key"] for x in mine["assigned"]], ["design_final"])
        a2 = self.login("a2")
        self.assertEqual(a2.get("/api/me/tasks").json()["assigned"], [], "同角色的 A2 不会因此拥有任务")

    def test_non_member_needs_explicit_join_and_leaves_member_event(self):
        j = self.login("jessie")
        t = self.task(j)
        r = j.post(f"/api/projects/{self.pid}/tasks/{t['id']}/assign", json={"version": t["version"], "assignee_user_id": self.uid["b"]})
        self.assertEqual(r.status_code, 400)
        self.assertIn("加入项目并分派", r.json()["detail"])
        r = j.post(f"/api/projects/{self.pid}/tasks/{t['id']}/assign", json={"version": t["version"], "assignee_user_id": self.uid["b"], "join_project": True})
        self.assertEqual(r.status_code, 200, r.text)
        kinds = [e["kind"] for e in j.get(f"/api/projects/{self.pid}/tasks/{t['id']}/events").json()]
        self.assertEqual(kinds, ["assigned", "member_added"])
        members = j.get(f"/api/projects/{self.pid}/members").json()
        self.assertIn(self.uid["b"], [m["id"] for m in members["members"]])
        self.assertNotIn(self.uid["b"], [m["id"] for m in members["others"]])

    def test_executor_cannot_assign(self):
        j = self.login("jessie"); t = self.task(j)
        a = self.login("a")
        r = a.post(f"/api/projects/{self.pid}/tasks/{t['id']}/assign", json={"version": t["version"], "assignee_user_id": self.uid["a2"]})
        self.assertEqual(r.status_code, 403)

    def test_stale_version_conflicts_and_returns_latest(self):
        j = self.login("jessie"); t = self.task(j)
        ok = j.post(f"/api/projects/{self.pid}/tasks/{t['id']}/assign", json={"version": t["version"], "assignee_user_id": self.uid["a"]})
        self.assertEqual(ok.status_code, 200)
        again = j.post(f"/api/projects/{self.pid}/tasks/{t['id']}/assign", json={"version": t["version"], "due_at": "2026-09-30"})
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.json()["detail"]["task"]["version"], t["version"] + 1)
        self.assertIsNone(self.task(j)["due_at"], "冲突时不落库")

    def test_reassign_needs_reason_locks_out_old_assignee_and_keeps_history(self):
        j = self.login("jessie"); t = self.task(j)
        t = j.post(f"/api/projects/{self.pid}/tasks/{t['id']}/assign", json={"version": t["version"], "assignee_user_id": self.uid["a"]}).json()
        a = self.login("a")
        t = a.post(f"/api/projects/{self.pid}/tasks/{t['id']}/status", json={"version": t["version"], "action": "start"}).json()
        self.assertEqual(t["exec_status"], "in_progress")
        r = j.post(f"/api/projects/{self.pid}/tasks/{t['id']}/assign", json={"version": t["version"], "assignee_user_id": self.uid["a2"]})
        self.assertEqual(r.status_code, 400, "改派要写原因")
        r = j.post(f"/api/projects/{self.pid}/tasks/{t['id']}/assign", json={"version": t["version"], "assignee_user_id": self.uid["a2"], "join_project": True, "reason": "A 休假"})
        self.assertEqual(r.status_code, 200, r.text)
        t2 = r.json()
        self.assertEqual(t2["assignee"]["id"], self.uid["a2"])
        self.assertEqual(t2["exec_status"], "not_started", "换人后回到未开始")
        r = a.post(f"/api/projects/{self.pid}/tasks/{t2['id']}/status", json={"version": t2["version"], "action": "wait", "wait_reason": "x"})
        self.assertEqual(r.status_code, 403, "旧负责人不能再写")
        evs = j.get(f"/api/projects/{self.pid}/tasks/{t2['id']}/events").json()
        re_ev = next(e for e in evs if e["kind"] == "reassigned")
        self.assertEqual(re_ev["before"]["assignee_user_id"], self.uid["a"])
        self.assertEqual(re_ev["after"]["assignee_user_id"], self.uid["a2"])
        self.assertEqual(re_ev["actor"]["id"], self.uid["jessie"])
        self.assertEqual(re_ev["reason"], "A 休假")
        started = next(e for e in evs if e["kind"] == "started")
        self.assertEqual(started["actor"]["id"], self.uid["a"], "历史仍署 A")

    # ---- 状态 ----
    def test_start_wait_resume_and_stage_does_not_move(self):
        j = self.login("jessie"); t = self.task(j)
        with Session(self.engine) as s:
            before_stage = compute_steps(s, s.get(models.Project, self.pid))["current_stage"]["key"]
        t = j.post(f"/api/projects/{self.pid}/tasks/{t['id']}/assign", json={"version": t["version"], "assignee_user_id": self.uid["a"]}).json()
        a = self.login("a")
        url = f"/api/projects/{self.pid}/tasks/{t['id']}/status"
        r = a.post(url, json={"version": t["version"], "action": "wait"})
        self.assertEqual(r.status_code, 400, "等待没写原因要拒绝")
        t = a.post(url, json={"version": t["version"], "action": "start"}).json()
        t = a.post(url, json={"version": t["version"], "action": "wait", "wait_for": "业主", "wait_reason": "等入户时间", "wait_until": ""}).json()
        self.assertEqual((t["exec_status"], t["wait_for"], t["wait_reason"], t["wait_until"]), ("waiting", "业主", "等入户时间", None))
        t = a.post(url, json={"version": t["version"], "action": "resume"}).json()
        self.assertEqual(t["exec_status"], "in_progress")
        self.assertIsNone(t["wait_reason"])
        self.assertFalse(t["satisfied"], "执行状态不等于证据满足")
        seen = self.task(j)
        self.assertEqual(seen["exec_status"], "in_progress", "统筹看到同一份状态")
        with Session(self.engine) as s:
            after_stage = compute_steps(s, s.get(models.Project, self.pid))["current_stage"]["key"]
        self.assertEqual(before_stage, after_stage, "分派与状态不推进阶段")
        kinds = [e["kind"] for e in j.get(f"/api/projects/{self.pid}/tasks/{t['id']}/events").json()]
        self.assertEqual(kinds, ["resumed", "waiting", "started", "assigned"])

    def test_status_by_someone_else_is_403_even_for_jessie(self):
        j = self.login("jessie"); t = self.task(j)
        t = j.post(f"/api/projects/{self.pid}/tasks/{t['id']}/assign", json={"version": t["version"], "assignee_user_id": self.uid["a"]}).json()
        r = j.post(f"/api/projects/{self.pid}/tasks/{t['id']}/status", json={"version": t["version"], "action": "start"})
        self.assertEqual(r.status_code, 403)
        a2 = self.login("a2")
        r = a2.post(f"/api/projects/{self.pid}/tasks/{t['id']}/status", json={"version": t["version"], "action": "start"})
        self.assertEqual(r.status_code, 403)

    def test_deactivated_account_cannot_be_assigned(self):
        with Session(self.engine) as s:
            s.get(models.User, self.uid["a"]).active = False
            s.commit()
        j = self.login("jessie"); t = self.task(j)
        r = j.post(f"/api/projects/{self.pid}/tasks/{t['id']}/assign", json={"version": t["version"], "assignee_user_id": self.uid["a"]})
        self.assertEqual(r.status_code, 400)

    def test_events_are_not_written_by_reads(self):
        j = self.login("jessie")
        for _ in range(3):
            j.get(f"/api/projects/{self.pid}/tasks")
            j.get("/api/me/tasks")
        with Session(self.engine) as s:
            self.assertEqual(len(s.scalars(select(models.TaskEvent)).all()), 0)

    def test_user_email_round_trip(self):
        with Session(self.engine) as s:
            s.get(models.User, self.uid["jessie"]).is_admin = True
            s.commit()
        j = self.login("jessie")
        r = j.patch(f"/api/users/{self.uid['a']}", json={"email": "a@example.test"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["email"], "a@example.test")
        self.assertEqual(j.patch(f"/api/users/{self.uid['a']}", json={"email": "not-an-email"}).status_code, 400)
        self.assertIsNone(j.patch(f"/api/users/{self.uid['a']}", json={"email": ""}).json()["email"])


if __name__ == "__main__":
    unittest.main()


class WorkbenchAndFocusTests(_TaskBase):
    """KAN-75 块 4：头卡三条事实、下一动作、工作台项目关注。复用上面的账号与项目布置。"""

    def test_focus_for_unpurchased_house_names_next_action_and_unassigned_count(self):
        j = self.login("jessie")
        r = j.get(f"/api/projects/{self.pid}/tasks").json()
        labels = [f["label"] for f in r["focus"]]
        self.assertEqual(labels, ["下一动作", "跟进档位", "待安排"])
        self.assertEqual(r["focus"][2]["value"], "4 项", "s1 的四项普通任务都没分派")
        self.assertEqual(r["focus"][0]["value"], "筛选房源", "没人分派时按模板顺序取第一项")

    def test_next_action_prefers_assigned_in_progress_over_unassigned(self):
        j = self.login("jessie")
        t = self.task(j, "view")
        t = j.post(f"/api/projects/{self.pid}/tasks/{t['id']}/assign", json={"version": t["version"], "assignee_user_id": self.uid["a"], "due_at": "2026-09-26"}).json()
        a = self.login("a")
        a.post(f"/api/projects/{self.pid}/tasks/{t['id']}/status", json={"version": t["version"], "action": "start"})
        r = j.get(f"/api/projects/{self.pid}/tasks").json()
        self.assertEqual(r["focus"][0]["value"], "看房")
        wb = j.get("/api/me/workbench").json()
        row = next(x for x in wb["projects"] if x["project_id"] == self.pid)
        self.assertEqual((row["next_action"]["title"], row["next_action"]["kind"], row["next_action"]["actor"]["id"]), ("看房", "do", self.uid["a"]))
        self.assertEqual(row["position_label"], "买房 · 未购入")
        self.assertEqual(wb["counts"]["unassigned_current"], 3)
        self.assertEqual(wb["counts"]["waiting"], 0)

    def test_workbench_requires_login_and_counts_waiting(self):
        anon = TestClient(self.app, headers={"X-Actor": quote("负责人")})
        self.addCleanup(anon.close)
        self.assertEqual(anon.get("/api/me/workbench").status_code, 401)
        j = self.login("jessie"); t = self.task(j)
        t = j.post(f"/api/projects/{self.pid}/tasks/{t['id']}/assign", json={"version": t["version"], "assignee_user_id": self.uid["a"]}).json()
        a = self.login("a")
        a.post(f"/api/projects/{self.pid}/tasks/{t['id']}/status", json={"version": t["version"], "action": "wait", "wait_reason": "等图"})
        wb = j.get("/api/me/workbench").json()
        self.assertEqual(wb["counts"]["waiting"], 1)
        single = j.get(f"/api/projects/{self.pid}/tasks/{t['id']}").json()
        self.assertEqual(single["exec_status"], "waiting")
