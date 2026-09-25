"""Formal-mode identity checks on existing property and inspection read routes; no project ACL changes."""
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import db, models
from app.auth import hash_password
from app.routers import auth, common, ops, property_data


class ProjectReadAuthTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.addCleanup(self.engine.dispose)
        db.Base.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            prop = models.Property(address_std="Synthetic read authentication")
            session.add(prop); session.flush()
            project = models.Project(name="Synthetic read authentication", property_id=prop.id)
            session.add(project); session.flush()
            self.pid = project.id
            session.add(models.Inspection(project_id=self.pid, name="Synthetic inspection", result="scheduled"))
            session.add(models.User(username="synthetic-reader", display_name="Synthetic reader", role_code="Permit/设计",
                                    password_hash=hash_password("synthetic-read-passphrase")))
            session.commit()
        app = FastAPI()
        for module in (auth, ops, property_data):
            app.include_router(module.router)
        def session_override():
            with Session(self.engine) as session:
                yield session
        app.dependency_overrides[db.get_db] = session_override
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_formal_mode_requires_identity_before_reading_or_existence_lookup(self):
        with patch.object(common, "DEMO_MODE", False):
            for pid in (self.pid, 99999):
                for resource in ("property", "inspections"):
                    response = self.client.get(f"/api/projects/{pid}/{resource}", headers={"X-Actor": "J"})
                    self.assertEqual(response.status_code, 401, response.text)

    def test_formal_mode_preserves_signed_employee_read_access(self):
        self.assertEqual(self.client.post("/api/auth/login", json={"username": "synthetic-reader", "password": "synthetic-read-passphrase"}).status_code, 200)
        with patch.object(common, "DEMO_MODE", False):
            for resource in ("property", "inspections"):
                response = self.client.get(f"/api/projects/{self.pid}/{resource}")
                self.assertEqual(response.status_code, 200, response.text)

    def test_demo_mode_keeps_existing_guest_read_behavior(self):
        with patch.object(common, "DEMO_MODE", True):
            for resource in ("property", "inspections"):
                self.assertEqual(self.client.get(f"/api/projects/{self.pid}/{resource}").status_code, 200)
