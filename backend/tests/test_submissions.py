"""Run with: python -m unittest discover -s tests (requires httpx).

KAN-75 块 5：提交批次、退回、确认。只有文件类交付物才要求文件；引用文件必须属本项目且当前账号能访问；
普通审核不碰 ProjectStep（不补手工勾），证据满足与已确认并列。
"""

import unittest

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.routers.files import router as files_router
from tests.test_tasks_assign import _TaskBase


class SubmissionTests(_TaskBase):
    def setUp(self):
        super().setUp()
        self.app.include_router(files_router)
        with Session(self.engine) as s:
            other_prop = models.Property(address_std="9 Other St")
            s.add(other_prop); s.flush()
            other = models.Project(property_id=other_prop.id, name="别的房", stage="lead")
            s.add(other); s.flush()
            self.other_pid = other.id
            s.add(models.ProjectFile(project_id=self.pid, filename="定稿.pdf", stored_path="x", mime="application/pdf", size=1, doc_type="drawing_final", uploaded_by="设计师", step_key="design_final"))
            s.add(models.ProjectFile(project_id=self.other_pid, filename="别家的.pdf", stored_path="y", mime="application/pdf", size=1, doc_type="drawing_final", uploaded_by="设计师"))
            s.add(models.ProjectFile(project_id=self.pid, filename="loan.pdf", stored_path="z", mime="application/pdf", size=1, doc_type="loan_doc", uploaded_by="D"))
            s.commit()
            self.file_ok = s.scalar(select(models.ProjectFile.id).where(models.ProjectFile.filename == "定稿.pdf"))
            self.file_other = s.scalar(select(models.ProjectFile.id).where(models.ProjectFile.filename == "别家的.pdf"))
            self.file_money = s.scalar(select(models.ProjectFile.id).where(models.ProjectFile.filename == "loan.pdf"))

    def assigned(self, step_key="design_final"):
        j = self.login("jessie"); t = self.task(j, step_key)
        t = j.post(f"/api/projects/{self.pid}/tasks/{t['id']}/assign", json={"version": t["version"], "assignee_user_id": self.uid["a"]}).json()
        return j, self.login("a"), t

    def test_file_task_requires_a_file_and_note_task_does_not(self):
        j, a, t = self.assigned("design_final")
        self.assertTrue(t["requires_file"])
        r = a.post(f"/api/projects/{self.pid}/tasks/{t['id']}/submit", json={"version": t["version"], "note": "交了"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("至少选一个文件", r.json()["detail"])
        j2, a2, t2 = self.assigned("agent")   # 选 listing agent：手工勾类，交说明即可
        self.assertFalse(t2["requires_file"])
        r = a2.post(f"/api/projects/{self.pid}/tasks/{t2['id']}/submit", json={"version": t2["version"], "note": ""})
        self.assertEqual(r.status_code, 400, "说明和文件都没有不能提交")
        r = a2.post(f"/api/projects/{self.pid}/tasks/{t2['id']}/submit", json={"version": t2["version"], "note": "已和两位 agent 谈过，选 X"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["exec_status"], "pending_review")
        self.assertEqual(r.json()["submissions"][0]["seq"], 1)

    def test_referenced_file_must_belong_to_project_and_be_accessible(self):
        j, a, t = self.assigned()
        r = a.post(f"/api/projects/{self.pid}/tasks/{t['id']}/submit", json={"version": t["version"], "file_ids": [self.file_other]})
        self.assertEqual(r.status_code, 400)
        r = a.post(f"/api/projects/{self.pid}/tasks/{t['id']}/submit", json={"version": t["version"], "file_ids": [self.file_money]})
        self.assertEqual(r.status_code, 403, "设计师看不到贷款文件，不能拿它当交付")
        r = a.post(f"/api/projects/{self.pid}/tasks/{t['id']}/submit", json={"version": t["version"], "file_ids": [self.file_ok, self.file_ok], "note": "v1"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(len(r.json()["submissions"][0]["files"]), 1, "重复的 file_id 只记一次")

    def test_return_needs_reason_keeps_batch_and_confirm_completes_without_ticking_step(self):
        j, a, t = self.assigned()
        t = a.post(f"/api/projects/{self.pid}/tasks/{t['id']}/submit", json={"version": t["version"], "file_ids": [self.file_ok], "note": "第一版"}).json()
        r = a.post(f"/api/projects/{self.pid}/tasks/{t['id']}/submit", json={"version": t["version"], "file_ids": [self.file_ok]})
        self.assertEqual(r.status_code, 400, "重复提交只有一个批次")
        r = a.post(f"/api/projects/{self.pid}/tasks/{t['id']}/confirm", json={"version": t["version"]})
        self.assertEqual(r.status_code, 403, "负责人不能自己确认")
        r = j.post(f"/api/projects/{self.pid}/tasks/{t['id']}/return", json={"version": t["version"]})
        self.assertEqual(r.status_code, 400, "退回要写原因")
        t = j.post(f"/api/projects/{self.pid}/tasks/{t['id']}/return", json={"version": t["version"], "reason": "补入口尺寸"}).json()
        self.assertEqual(t["exec_status"], "in_progress")
        self.assertEqual((t["submissions"][0]["decision"], t["submissions"][0]["decision_reason"]), ("returned", "补入口尺寸"))
        t = a.post(f"/api/projects/{self.pid}/tasks/{t['id']}/submit", json={"version": t["version"], "file_ids": [self.file_ok], "note": "第二版"}).json()
        self.assertEqual([s["seq"] for s in t["submissions"]], [2, 1], "旧批次保留，新批次在前")
        a2 = self.login("a2")
        self.assertEqual(a2.post(f"/api/projects/{self.pid}/tasks/{t['id']}/confirm", json={"version": t["version"]}).status_code, 403)
        t = j.post(f"/api/projects/{self.pid}/tasks/{t['id']}/confirm", json={"version": t["version"]}).json()
        self.assertEqual(t["exec_status"], "done")
        self.assertIsNotNone(t["done_at"])
        self.assertEqual(t["submissions"][0]["decision"], "confirmed")
        with Session(self.engine) as s:
            self.assertEqual(s.scalars(select(models.ProjectStep).where(models.ProjectStep.project_id == self.pid)).all(), [], "确认不补 ProjectStep 手工勾")
        self.assertTrue(t["satisfied"], "项目里有定稿图纸，证据满足由 compute_steps 派生，与确认并列")
        kinds = [e["kind"] for e in j.get(f"/api/projects/{self.pid}/tasks/{t['id']}/events").json()]
        self.assertEqual(kinds[:4], ["confirmed", "submitted", "returned", "submitted"])
        self.assertEqual(a.post(f"/api/projects/{self.pid}/tasks/{t['id']}/status", json={"version": t["version"], "action": "start"}).status_code, 400, "完成后不能再开始")

    def test_my_tasks_and_workbench_show_pending_review_for_reviewer(self):
        j, a, t = self.assigned()
        a.post(f"/api/projects/{self.pid}/tasks/{t['id']}/submit", json={"version": t["version"], "file_ids": [self.file_ok], "note": "v1"})
        mine = j.get("/api/me/tasks").json()
        self.assertEqual([x["exec_status"] for x in mine["reviewing"]], ["pending_review"])
        wb = j.get("/api/me/workbench").json()
        self.assertEqual(wb["counts"]["pending_review_mine"], 1)
        self.assertEqual(wb["my_pending"][0]["id"], t["id"])
        self.assertEqual(wb["recent_handoffs"][0]["kind"], "submitted")
        row = next(x for x in wb["projects"] if x["project_id"] == self.pid)
        self.assertEqual((row["next_action"]["kind"], row["next_action"]["actor"]["id"]), ("review", self.uid["jessie"]))


if __name__ == "__main__":
    unittest.main()
