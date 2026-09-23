"""Run with: python -m unittest discover -s tests (requires httpx).

KAN-71：模拟数据不得冒充公共记录；自动值不得冒充团队值；来源随字段走。

覆盖四条伪造来源的路径：provider 生成字段、apn 兜底（已删）、交易分析预填、请求默认值；
外加一次性迁移的三层防护与「缺任一金额不算利润」。
"""

import json
import unittest
from unittest.mock import patch
from urllib.parse import quote

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import db, dictionaries, migrations, models, schemas
from app import providers as providers_pkg
from app.providers.mock import MockProvider
from app.routers import analyses, dashboard, projects


SOURCE_VALUES = {s["value"] for s in dictionaries.SOURCES}


class MockProviderSourceTests(unittest.TestCase):
    """路径 1：provider 生成的字段。"""

    def test_every_field_is_demo_with_no_confidence(self):
        r = MockProvider().lookup("4928 NW Fisk Ave")
        self.assertGreaterEqual(len(r.fields), 16)
        for f in r.fields:
            with self.subTest(field=f.field):
                self.assertEqual(f.source, "demo", "随机生成的值不能标成公共记录")
                self.assertIsNone(f.confidence, "随机值谈不上把握度")

    def test_demo_and_unverified_are_in_vocabulary(self):
        self.assertIn("demo", SOURCE_VALUES)
        self.assertIn("unverified", SOURCE_VALUES)

    def test_provider_only_emits_known_sources(self):
        r = MockProvider().lookup("10404 NW 57th Terr")
        self.assertTrue({f.source for f in r.fields} <= SOURCE_VALUES)


class ProviderRegistryTests(unittest.TestCase):
    """PROVIDER 不再被静默吞掉。"""

    def test_mock_resolves(self):
        with patch.object(providers_pkg, "PROVIDER", "mock"):
            self.assertIsInstance(providers_pkg.get_provider(), MockProvider)

    def test_unknown_provider_raises_and_names_supported_values(self):
        with patch.object(providers_pkg, "PROVIDER", "rentcast"):
            with self.assertRaises(RuntimeError) as cm:
                providers_pkg.get_provider()
        self.assertIn("rentcast", str(cm.exception))
        self.assertIn("mock", str(cm.exception), "错误信息要列出支持的取值")


class FieldInDefaultTests(unittest.TestCase):
    """路径 4：请求不带 source 不能白捡一个「公共记录」。"""

    def test_default_source_is_manual(self):
        self.assertEqual(schemas.FieldIn(field="apn", value="1").source, "manual")


def _make_app(engine, routers):
    def session_override():
        with Session(engine) as session:
            yield session
    app = FastAPI()
    for r in routers:
        app.include_router(r.router)
    app.dependency_overrides[db.get_db] = session_override
    return app


ADDR = {"label": "1 Test St, Test, CA 90001", "street": "1 Test St", "city": "Test", "state": "CA", "zip": "90001"}


class CreateProjectSourceTests(unittest.TestCase):
    """路径 2 + 3 + 手动路径：落库与分析预填都不得伪造。"""

    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.addCleanup(self.engine.dispose)
        db.Base.metadata.create_all(self.engine)
        self.client = TestClient(_make_app(self.engine, [projects, analyses]), headers={"X-Actor": quote("负责人")})
        self.addCleanup(self.client.close)

    def _sources(self, prop_id: int) -> dict:
        with Session(self.engine) as s:
            rows = s.scalars(select(models.PropertyFieldSource).where(models.PropertyFieldSource.property_id == prop_id)).all()
            return {r.field: (r.source, r.confidence) for r in rows}

    def test_manual_blank_project_creates_with_default_create_analysis(self):
        """手动路径：空字段 + 默认 create_analysis，必须 201，且分析器不造假买入价。"""
        r = self.client.post("/api/projects", json={"name": "手动房", "address": ADDR})
        self.assertEqual(r.status_code, 201, r.text)
        pid = r.json()["id"]
        with Session(self.engine) as s:
            a = s.scalars(select(models.DealAnalysis).where(models.DealAnalysis.project_id == pid)).first()
            self.assertIsNotNone(a, "默认 create_analysis=True 应该建一份分析")
            inputs = json.loads(a.inputs_json)
        self.assertEqual(inputs["purchase_price"], 0, "没有挂牌价时不能按售价七折凭空造买入价")
        self.assertEqual(inputs["sources"]["purchase_price"]["source"], "unverified")
        self.assertNotEqual(inputs["sources"]["purchase_price"]["source"], "manual", "不能伪装成人填的")
        self.assertEqual(inputs["sources"]["sale_price"]["source"], "unverified")

    def test_hand_typed_apn_is_manual_not_demo(self):
        """来源随字段走：手填的 APN 是 manual，不因当前配置是 mock 就成演示数据。"""
        r = self.client.post("/api/projects", json={
            "name": "手填 APN", "address": ADDR,
            "fields": [{"field": "apn", "value": "12-345-67-89", "source": "manual"}],
        })
        self.assertEqual(r.status_code, 201, r.text)
        srcs = self._sources(r.json()["property"]["id"])
        self.assertEqual(srcs["apn"], ("manual", None))

    def test_field_without_source_is_not_public_record(self):
        r = self.client.post("/api/projects", json={
            "name": "漏 source", "address": ADDR,
            "fields": [{"field": "sqft", "value": "1500"}],
        })
        self.assertEqual(r.status_code, 201, r.text)
        srcs = self._sources(r.json()["property"]["id"])
        self.assertNotEqual(srcs["sqft"][0], "public_record")

    def test_public_record_passes_through_untouched(self):
        """落库不改写来源：真实 provider 将来发 public_record 必须原样存。"""
        r = self.client.post("/api/projects", json={
            "name": "真来源", "address": ADDR,
            "fields": [{"field": "sqft", "value": "1500", "source": "public_record", "confidence": 0.9}],
        })
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(self._sources(r.json()["property"]["id"])["sqft"], ("public_record", 0.9))

    def test_analysis_inherits_real_field_sources(self):
        """路径 3：分析器继承房产字段的真实来源，不再写死 public_record/0.9 与 model/0.75。"""
        r = self.client.post("/api/projects", json={
            "name": "演示房", "address": ADDR,
            "fields": [
                {"field": "list_price", "value": "300000", "source": "demo"},
                {"field": "avm_value", "value": "400000", "source": "demo"},
            ],
        })
        self.assertEqual(r.status_code, 201, r.text)
        with Session(self.engine) as s:
            a = s.scalars(select(models.DealAnalysis).where(models.DealAnalysis.project_id == r.json()["id"])).first()
            src = json.loads(a.inputs_json)["sources"]
        self.assertEqual(src["purchase_price"]["source"], "demo")
        self.assertIsNone(src["purchase_price"]["confidence"])
        self.assertEqual(src["sale_price"]["source"], "demo")
        self.assertIsNone(src["sale_price"]["confidence"])

    def test_no_apn_fallback_row_with_hardcoded_public_record(self):
        """路径 2：旧兜底会额外写一条 apn=public_record/0.99，现在不该再出现。"""
        r = self.client.post("/api/projects", json={"name": "只带 apn", "address": ADDR, "apn": "99-999-99-99-9.000"})
        self.assertEqual(r.status_code, 201, r.text)
        srcs = self._sources(r.json()["property"]["id"])
        self.assertNotEqual(srcs.get("apn"), ("public_record", 0.99))


class SummaryMissingAmountTests(unittest.TestCase):
    """缺任一金额不算利润，且要说出来。"""

    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.addCleanup(self.engine.dispose)
        db.Base.metadata.create_all(self.engine)
        with Session(self.engine) as s:
            prop = models.Property(address_std="x"); s.add(prop); s.flush()
            # 都齐：利润 = 500k - 300k - 0
            s.add(models.Project(property_id=prop.id, name="齐", stage="active", purchase_price=300000, target_arv=500000))
            # 只有 ARV、缺买入价：以前会把成本当 0 算出 400k 虚利润
            s.add(models.Project(property_id=prop.id, name="缺买入", stage="active", purchase_price=None, target_arv=400000))
            s.flush()
            for pid in (1, 2):
                for who in ("D", "J"):
                    s.add(models.ProjectStep(project_id=pid, key=f"open_escrow:{who}", done=True, done_by=who, done_at="2026-09-01T00:00:00"))
            s.commit()
        self.client = TestClient(_make_app(self.engine, [dashboard]), headers={"X-Actor": quote("老板")})
        self.addCleanup(self.client.close)

    def test_summary_skips_incomplete_and_counts_it(self):
        d = self.client.get("/api/dashboard/summary").json()
        self.assertEqual(d["expected_profit"], 200000.0, "缺买入价的那套不能算进来")
        self.assertEqual(d["profit_incomplete_count"], 1)

    def test_boss_widget_same_rule(self):
        d = self.client.get("/api/dashboard/role").json()["boss"]
        self.assertEqual(d["expected_profit"], 200000.0)
        self.assertEqual(d["profit_incomplete_count"], 1)


class Kan71MigrationTests(unittest.TestCase):
    """三层防护：指纹命中→demo、不命中→unverified、manual 不动、幂等、戳记。"""

    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.addCleanup(self.engine.dispose)
        db.Base.metadata.create_all(self.engine)
        with Session(self.engine) as s:
            prop = models.Property(address_std="x"); s.add(prop); s.flush()
            rows = [
                ("apn", "public_record", 0.99, "指纹命中 apn"),
                ("avm_value", "model", 0.75, "指纹命中 avm"),
                ("sqft", "public_record", 0.6, "不命中：置信度不对"),
                ("beds", "model", None, "不命中：model 但无置信度"),
                ("year_built", "manual", 1.0, "人工，不动"),
                ("sqft", "lark", None, "lark，不动"),
            ]
            for f, src, conf, note in rows:
                s.add(models.PropertyFieldSource(property_id=prop.id, field=f, value="1", source=src, confidence=conf, note=note))
            s.commit()

    def _rows(self):
        with Session(self.engine) as s:
            return {(r.note): (r.source, r.confidence) for r in s.scalars(select(models.PropertyFieldSource)).all()}

    def test_fingerprint_unverified_manual_and_rerun(self):
        with Session(self.engine) as s, \
             patch.object(migrations, "SEED_DEMO", True), patch.object(migrations, "PROVIDER", "mock"):
            first = migrations.run_migrations(s)
        self.assertEqual(first[0].status, "applied")
        self.assertEqual(first[0].affected, 4)
        rows = self._rows()
        self.assertEqual(rows["指纹命中 apn"], ("demo", None))
        self.assertEqual(rows["指纹命中 avm"], ("demo", None))
        self.assertEqual(rows["不命中：置信度不对"], ("unverified", None), "来源无法确认的不能猜，标待核实")
        self.assertEqual(rows["不命中：model 但无置信度"], ("unverified", None))
        self.assertEqual(rows["人工，不动"], ("manual", 1.0))
        self.assertEqual(rows["lark，不动"], ("lark", None))
        # 幂等：第二次跳过，改动 0
        with Session(self.engine) as s, \
             patch.object(migrations, "SEED_DEMO", True), patch.object(migrations, "PROVIDER", "mock"):
            second = migrations.run_migrations(s)
        self.assertEqual(second[0].status, "skipped-already-applied")
        self.assertEqual(second[0].affected, 0)
        # 戳记存在
        with Session(self.engine) as s:
            self.assertEqual(s.execute(text("SELECT affected FROM app_migrations WHERE key='kan71_demo_source'")).scalar_one(), 4)

    def test_dry_run_changes_nothing(self):
        with Session(self.engine) as s, \
             patch.object(migrations, "SEED_DEMO", True), patch.object(migrations, "PROVIDER", "mock"):
            rep = migrations.run_migrations(s, dry_run=True)[0]
        self.assertEqual(rep.status, "dry-run")
        self.assertEqual(rep.affected, 4)
        self.assertEqual(self._rows()["指纹命中 apn"], ("public_record", 0.99), "dry-run 不能落库")
        with Session(self.engine) as s:
            self.assertIsNone(s.execute(text("SELECT 1 FROM app_migrations WHERE key='kan71_demo_source'")).first(), "dry-run 不写戳记")

    def test_not_demo_config_skips(self):
        """环境闸门：真实 provider 下不跑——保护将来的真实 public_record 行。"""
        with Session(self.engine) as s, \
             patch.object(migrations, "SEED_DEMO", True), patch.object(migrations, "PROVIDER", "rentcast"):
            rep = migrations.run_migrations(s)[0]
        self.assertEqual(rep.status, "skipped-not-demo")
        self.assertEqual(self._rows()["指纹命中 apn"], ("public_record", 0.99))


if __name__ == "__main__":
    unittest.main()
