"""KAN-20 基线对齐验证：六段模板兼容旧数据 + 水电账户密码的权限边界。

Run with: python -m unittest discover -s tests （需要 httpx）

为什么有这个文件：origin/main（KAN-15 水电网站/复制密码）与 upstream 的
「工作流 P1 归一 + 登录」是两条分叉基线，合并后必须证明
  1. 六段模板没有丢掉任何旧 step key、旧的手工确认仍然算过门；
  2. 水电密码只给紫 / 蓝 / K，且正式模式（DEMO_MODE=0）未登录一律 401。
"""

import unittest
from unittest.mock import patch
from urllib.parse import quote

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import db, models
from app.dictionaries import STAGE_CHECKLIST
from app.routers import common
from app.routers.ops import router as ops_router
from app.steps import compute_steps

# 合并前五段清单里的 29 个 key（origin/main 的 dictionaries.py），一个都不能丢
LEGACY_STEP_KEYS = [
    "screen", "view", "price", "open_escrow",
    "loan_insurance", "loan_doc", "measure", "design", "close_escrow", "utilities_on",
    "design_final", "permit_apply", "prep_work", "permit_issued", "start",
    "purchase", "progress", "inspections", "agent", "final",
    "staging", "listing", "mow", "offer", "sale_docs", "disclosure", "sign", "closed", "services_off",
]


def _memory_engine(cleanup):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    cleanup(engine.dispose)
    db.Base.metadata.create_all(engine)
    return engine


class SixStageTemplateTests(unittest.TestCase):
    """六段模板本身的结构约束（不需要数据库）。"""

    def setUp(self):
        self.keys = [it["key"] for st in STAGE_CHECKLIST for it in st["items"]]

    def test_no_legacy_step_key_is_dropped(self):
        missing = [k for k in LEGACY_STEP_KEYS if k not in self.keys]
        self.assertEqual(missing, [], f"六段模板丢了旧 step key，历史记录会失联：{missing}")

    def test_step_keys_are_unique(self):
        dupes = sorted({k for k in self.keys if self.keys.count(k) > 1})
        self.assertEqual(dupes, [], f"step key 重复会让手工勾记录串项：{dupes}")

    def test_six_stages_in_order(self):
        self.assertEqual([st["key"] for st in STAGE_CHECKLIST], ["s1", "s2", "s3", "s4", "s5", "s6"])

    def test_a_stage_can_have_more_than_one_gate(self):
        """审计 P0-03：卖房段的第二个审批节点必须参与阶段推进，不能只认第一道门。"""
        gates = {st["key"]: [it["key"] for it in st["items"] if it.get("gate")] for st in STAGE_CHECKLIST}
        self.assertEqual(gates["s3"], ["start", "final"])
        self.assertEqual(gates["s5"], ["offer", "closed"])


class LegacyDataSurvivesMigrationTests(unittest.TestCase):
    """旧库里的手工确认、备注、操作人在六段模板下仍然有效。"""

    def setUp(self):
        self.engine = _memory_engine(self.addCleanup)
        with Session(self.engine) as s:
            prop = models.Property(address_std="1 Test St")
            s.add(prop)
            s.flush()
            s.add(models.Project(property_id=prop.id, name="旧库项目"))
            s.commit()

    def _steps(self, session):
        project = session.get(models.Project, 1)
        return compute_steps(session, project)

    def test_legacy_double_confirmation_still_passes_the_gate(self):
        with Session(self.engine) as s:
            for who in ("D", "J"):
                s.add(models.ProjectStep(project_id=1, key=f"open_escrow:{who}", done=True,
                                         done_by=who, done_at="2026-05-01", note=f"{who} 旧库确认"))
            s.commit()
            steps = self._steps(s)
            gate = next(it for st in steps["stages"] for it in st["items"] if it["key"] == "open_escrow")
            self.assertTrue(gate["done"], "旧库的 D/J 双勾在六段模板下应仍算过门")
            self.assertEqual(sorted(gate["confirmed"]), ["D", "J"])
            self.assertEqual(gate["done_at"], "2026-05-01")

    def test_partial_legacy_confirmation_does_not_pass(self):
        with Session(self.engine) as s:
            s.add(models.ProjectStep(project_id=1, key="open_escrow:D", done=True, done_by="D"))
            s.commit()
            gate = next(it for st in self._steps(s)["stages"] for it in st["items"] if it["key"] == "open_escrow")
            self.assertFalse(gate["done"], "只有一个人确认不能算过门")
            self.assertEqual(gate["confirmed"], ["D"])

    def test_stage_progress_exposes_every_gate(self):
        with Session(self.engine) as s:
            progress = self._steps(s)["stage_progress"]
        self.assertEqual(len(progress), 6)
        renovation = next(p for p in progress if p["key"] == "s3")
        self.assertIn("gates", renovation, "阶段推进要能看到本段所有门，否则第二道门会被忽略")
        self.assertEqual([g["key"] for g in renovation["gates"]], ["start", "final"])


class UtilitySecretBoundaryTests(unittest.TestCase):
    """水电账户密码：只给紫 / 蓝 / K；正式模式未登录一律 401（审计 P0-04 / P0-05）。"""

    def setUp(self):
        self.engine = _memory_engine(self.addCleanup)
        with Session(self.engine) as s:
            prop = models.Property(address_std="2 Test St")
            s.add(prop)
            s.flush()
            s.add(models.Project(property_id=prop.id, name="权限测试项目"))
            s.commit()

        def session_override():
            with Session(self.engine) as session:
                yield session

        app = FastAPI()
        app.include_router(ops_router)
        app.dependency_overrides[db.get_db] = session_override
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        # 用有权限的身份写入一条带密码的账户
        r = self.client.put("/api/projects/1/utilities/water",
                            json={"account_no": "w-1", "login": "demo", "password": "test-only", "status": "on"},
                            headers={"X-Actor": quote("负责人")})
        self.assertEqual(r.status_code, 200)

    def _water(self, actor=None):
        headers = {"X-Actor": quote(actor)} if actor else {}
        r = self.client.get("/api/projects/1/utilities", headers=headers)
        self.assertEqual(r.status_code, 200)
        return next(row for row in r.json() if row["kind"] == "water")

    def test_blue_can_read_password(self):
        self.assertEqual(self._water("负责人")["password"], "test-only")

    def test_k_can_read_password(self):
        self.assertEqual(self._water("K")["password"], "test-only")

    def test_teal_cannot_read_password_but_still_sees_the_account(self):
        row = self._water("Z")
        self.assertIsNone(row["password"], "青级不该看到水电账户密码")
        self.assertEqual(row["account_no"], "w-1", "藏密码不等于藏整条账户")

    def test_grey_cannot_read_password(self):
        self.assertIsNone(self._water("园丁")["password"])

    def test_demo_mode_default_actor_is_a_documented_hole(self):
        """演示模式下不带身份 = 负责人，这是 DEMO_MODE 的既定设计；正式模式必须关掉。"""
        self.assertEqual(self._water()["password"], "test-only")

    def test_production_mode_requires_login(self):
        with patch.object(common, "DEMO_MODE", False):
            r = self.client.get("/api/projects/1/utilities")
            self.assertEqual(r.status_code, 401, "DEMO_MODE=0 时未登录必须 401，不能默认成负责人")
            r = self.client.get("/api/projects/1/utilities", headers={"X-Actor": quote("负责人")})
            self.assertEqual(r.status_code, 401, "正式模式不接受自报身份")


if __name__ == "__main__":
    unittest.main()
