"""Run with: python -m unittest discover -s tests (requires httpx)."""

import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import db, models
from app.routers.ops import router


class UtilityWebsiteTests(unittest.TestCase):
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
            session.add(models.Project(property_id=prop.id, name="Test project"))
            session.commit()

        def session_override():
            with Session(self.engine) as session:
                yield session

        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[db.get_db] = session_override
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_websites_persist_independently_and_can_be_cleared(self):
        for kind in ("water", "electric", "gas"):
            response = self.client.put(f"/api/projects/1/utilities/{kind}", json={
                "website": f" {kind}.example.com/login ", "account_no": f"{kind}-123",
                "login": "demo", "password": "test-only", "status": "on",
            })
            self.assertEqual(response.status_code, 200)
        rows = self.client.get("/api/projects/1/utilities").json()
        for row in rows:
            self.assertEqual(row["website"], f"https://{row['kind']}.example.com/login")
            self.assertEqual(row["account_no"], f"{row['kind']}-123")
            self.assertEqual(row["password"], "test-only")
        self.client.put("/api/projects/1/utilities/water", json={"website": " "})
        rows = self.client.get("/api/projects/1/utilities").json()
        self.assertIsNone(next(r for r in rows if r["kind"] == "water")["website"])
        self.assertEqual(next(r for r in rows if r["kind"] == "gas")["website"], "https://gas.example.com/login")

    def test_invalid_websites_are_rejected_without_overwriting_saved_url(self):
        path = "/api/projects/1/utilities/water"
        self.client.put(path, json={"website": "https://water.example.com"})
        for url in ("javascript:alert(1)", "data:text/html,test", "ftp://example.com", "https://", "not a website", "https://user:pass@example.com"):
            with self.subTest(url=url):
                self.assertEqual(self.client.put(path, json={"website": url}).status_code, 422)
        rows = self.client.get("/api/projects/1/utilities").json()
        self.assertEqual(next(r for r in rows if r["kind"] == "water")["website"], "https://water.example.com/")

    def test_existing_database_adds_nullable_website_without_losing_accounts(self):
        self.client.put("/api/projects/1/utilities/water", json={"account_no": "existing-123"})
        with self.engine.begin() as conn:
            conn.execute(text("ALTER TABLE utility_accounts DROP COLUMN website"))
        with patch.object(db, "engine", self.engine):
            db.init_db()
            db.init_db()  # Repeated startup must remain safe.
        self.assertIn("website", {c["name"] for c in inspect(self.engine).get_columns("utility_accounts")})
        rows = self.client.get("/api/projects/1/utilities").json()
        water = next(r for r in rows if r["kind"] == "water")
        self.assertIsNone(water["website"])
        self.assertEqual(water["account_no"], "existing-123")


if __name__ == "__main__":
    unittest.main()
