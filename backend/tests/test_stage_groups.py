"""Run with: python -m unittest discover -s tests (requires httpx).

KAN-75 块 2：展示分组位置（五格）、买房内「未购入 / escrow 中」、过门时的档位快照、工作台三桶口径。
底层六段与 31 个 step key 不动，这里只验证翻译层。
"""

import unittest
from urllib.parse import quote

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import db, models
from app.dictionaries import STAGE_CHECKLIST, STAGE_GROUPS
from app.routers.dashboard import router as dashboard_router
from app.routers.projects import router as projects_router
from app.routers.steps import router as steps_router
from app.steps import compute_steps


class StageGroupTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.addCleanup(self.engine.dispose)
        db.Base.metadata.create_all(self.engine)
        with Session(self.engine) as s:
            prop = models.Property(address_std="2 Group St")
            s.add(prop); s.flush()
            s.add(models.Project(property_id=prop.id, name="线索房", stage="lead", substage="negotiating", lead_heat="hot_lead"))
            s.commit()

        def session_override():
            # 和 db.SessionLocal 一样关掉 autoflush：真实服务就是这样跑的，测试不能比线上更宽松
            with Session(self.engine, autoflush=False, expire_on_commit=False) as s:
                yield s

        app = FastAPI()
        for r in (projects_router, steps_router, dashboard_router):
            app.include_router(r)
        app.dependency_overrides[db.get_db] = session_override
        self.client = TestClient(app, headers={"X-Actor": quote("负责人")})
        self.addCleanup(self.client.close)

    def test_groups_cover_all_six_stages_exactly_once(self):
        covered = [sk for g in STAGE_GROUPS for sk in g["stages"]]
        self.assertEqual(covered, [st["key"] for st in STAGE_CHECKLIST])
        self.assertEqual(len(STAGE_GROUPS), 5)

    def test_lead_is_buying_pre_with_manual_substage(self):
        r = self.client.get("/api/projects/1").json()
        gp = r["group_position"]
        self.assertEqual((gp["group_key"], gp["sub_key"], gp["group_index"], gp["group_count"]), ("buying", "pre", 1, 5))
        self.assertEqual(gp["lead_substage_label"], "谈判中")
        self.assertEqual(gp["label"], "买房 · 未购入")
        self.assertEqual(self.client.get("/api/projects/1/steps").json()["group_position"]["sub_key"], "pre")

    def legacy_gate(self, key):
        with Session(self.engine) as s:
            for who in ("D", "J"):
                s.add(models.ProjectStep(project_id=1, key=f"{key}:{who}", done=True, done_by=who, done_at="2026-09-01"))
            s.commit()

    def test_legacy_escrow_preserves_frozen_substage_and_history(self):
        self.legacy_gate("open_escrow")
        with Session(self.engine) as s:
            s.get(models.Project, 1).lead_substage_at_escrow = "negotiating"
            s.commit()
        r = self.client.get("/api/projects/1").json()
        self.assertEqual(r["group_position"]["sub_key"], "escrow")
        self.assertEqual(r["lead_substage_at_escrow"], "negotiating")
        self.assertEqual(self.client.post("/api/projects/1/steps/open_escrow", json={"done": True, "confirm_as": "D"}).status_code, 401)

    def test_close_escrow_moves_to_renovation_without_sub(self):
        for k in ("open_escrow", "close_escrow"):
            self.legacy_gate(k)
        gp = self.client.get("/api/projects/1").json()["group_position"]
        self.assertEqual((gp["group_key"], gp["sub_key"], gp["label"]), ("renovation", None, "装修"))

    def test_summary_and_funnel_use_group_position(self):
        s0 = self.client.get("/api/dashboard/summary").json()
        self.assertEqual((s0["leads"], s0["active"], s0["portfolio"]), (1, 0, 0))
        self.assertEqual([f["count"] for f in self.client.get("/api/dashboard/widgets").json()["funnel"] if f["substage"] == "negotiating"], [1])
        self.legacy_gate("open_escrow")
        s1 = self.client.get("/api/dashboard/summary").json()
        self.assertEqual((s1["leads"], s1["active"], s1["portfolio"]), (0, 1, 0))
        self.assertEqual(sum(f["count"] for f in self.client.get("/api/dashboard/widgets").json()["funnel"]), 0, "escrow 中的房子不进漏斗")

    def test_full_completion_lands_in_last_group(self):
        with Session(self.engine) as s:
            p = s.get(models.Project, 1)
            gp = compute_steps(s, p)["group_position"]
            self.assertFalse(gp["complete"])
        self.assertEqual(STAGE_GROUPS[-1]["key"], "closeout")


if __name__ == "__main__":
    unittest.main()
