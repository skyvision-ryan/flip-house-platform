"""Run with: python -m unittest discover -s tests (requires httpx).

KAN-50：线索独有字段（substage / lead_heat）的写入边界。

背景：`PATCH /api/projects/{id}` 一直只挡 `stage` 和非线索的 `substage`，**不挡 `lead_heat`**。
而前端 `EditProjectModal.tsx:31` 会把非线索项目的热度默认成 `'warm_lead'` 并无条件发送
（`:50`），于是编辑任何在建项目都会给它写上线索热度。KAN-50 让 `lead_heat` 第一次
成为主要展示字段，所以在后端兜底——挡在这里比改某一个调用方彻底。
"""

import unittest
from urllib.parse import quote

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import db, models
from app.routers.projects import router


class LeadFieldGuardTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        self.addCleanup(self.engine.dispose)
        db.Base.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            prop = models.Property(address_std="Test property")
            session.add(prop)
            session.flush()
            session.add(models.Project(
                property_id=prop.id, name="线索房", stage="lead",
                substage="contacting", lead_heat="warm_lead",
            ))
            session.add(models.Project(
                property_id=prop.id, name="在建房", stage="active",
                substage="construction", lead_heat=None,
            ))
            session.flush()
            # 关键：`stage` 是派生缓存，`sync_legacy_stage` 会在每次 project_out 时按清单重算。
            # 光把列设成 "active" 没用——没有 gate 确认记录的项目派生出来仍是 s1（线索）。
            # 要让它真的是非线索，得把 open_escrow 的 D、J 两条确认都补上（`steps.py:126-133`
            # 按 "{key}:{who}" 存，两条都 done 才算过门）。
            for who in ("D", "J"):
                session.add(models.ProjectStep(
                    project_id=2, key=f"open_escrow:{who}", done=True,
                    done_by=who, done_at="2026-09-01T00:00:00",
                ))
            session.commit()

        def session_override():
            with Session(self.engine) as session:
                yield session

        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[db.get_db] = session_override
        self.client = TestClient(app, headers={"X-Actor": quote("负责人")})
        self.addCleanup(self.client.close)

    def _read(self, pid: int):
        with Session(self.engine) as session:
            p = session.get(models.Project, pid)
            return p.stage, p.substage, p.lead_heat

    def test_lead_accepts_substage_and_heat(self):
        """线索房两个字段都能改——这是线索页的核心交互。"""
        r = self.client.patch("/api/projects/1", json={"substage": "offer_made", "lead_heat": "hot_lead"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self._read(1), ("lead", "offer_made", "hot_lead"))

    def test_non_lead_drops_lead_heat(self):
        """在建项目不接受热度——这是 KAN-50 修的缺陷本身。"""
        r = self.client.patch("/api/projects/2", json={"lead_heat": "warm_lead"})
        self.assertEqual(r.status_code, 200)
        _, _, heat = self._read(2)
        self.assertIsNone(heat, "在建项目不该被写上线索热度")

    def test_non_lead_drops_substage_but_keeps_other_edits(self):
        """丢弃是静默的，同一次请求里的其他字段照常保存。"""
        r = self.client.patch("/api/projects/2", json={
            "name": "改过名的在建房", "substage": "offer_made", "lead_heat": "hot_lead",
        })
        self.assertEqual(r.status_code, 200)
        stage, substage, heat = self._read(2)
        self.assertEqual(stage, "active")
        self.assertEqual(substage, "construction", "非线索的子阶段不该被改")
        self.assertIsNone(heat)
        with Session(self.engine) as session:
            self.assertEqual(session.get(models.Project, 2).name, "改过名的在建房")

    def test_stage_is_never_writable(self):
        """阶段由清单派生，任何身份都改不了（既有行为，回归）。"""
        r = self.client.patch("/api/projects/1", json={"stage": "active"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self._read(1)[0], "lead")


if __name__ == "__main__":
    unittest.main()
