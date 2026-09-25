"""Two real HTTP requests read one version before either writes; every losing transaction rolls back."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from pathlib import Path
from threading import Barrier
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app import db, models
from app.auth import hash_password
from app.routers import auth, tasks


class TaskConcurrencyTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(prefix="task-cas-")
        self.addCleanup(folder.cleanup)
        self.engine = create_engine(f"sqlite:///{Path(folder.name) / 'isolated.db'}", connect_args={"check_same_thread": False})
        self.addCleanup(self.engine.dispose)
        db.Base.metadata.create_all(self.engine)
        self.users = {}
        self.password = "synthetic-concurrency-passphrase"
        with Session(self.engine) as session:
            prop = models.Property(address_std="Synthetic concurrent project")
            session.add(prop); session.flush()
            project = models.Project(name="Synthetic concurrency", property_id=prop.id, stage="lead")
            session.add(project); session.flush()
            self.pid = project.id
            for username, role in (("planner", "J"), ("worker", "采购"), ("replacement", "采购")):
                user = models.User(username=username, display_name=username, role_code=role,
                                   password_hash=hash_password(self.password))
                session.add(user); session.flush()
                self.users[username] = user.id
                tasks.ensure_member(session, self.pid, user, None)
            tasks.ensure_tasks(session, self.pid)
            session.commit()
        app = FastAPI()
        app.include_router(auth.router); app.include_router(tasks.router)
        def session_override():
            with Session(self.engine, autoflush=False, expire_on_commit=False) as session:
                yield session
        app.dependency_overrides[db.get_db] = session_override
        self.app = app
        self.planner = self.login("planner")
        self.worker = self.login("worker")
        self.worker_other_browser = self.login("worker")
        row = next(t for t in self.planner.get(f"/api/projects/{self.pid}/tasks").json()["tasks"] if t["step_key"] == "purchase")
        response = self.planner.post(self.url(row, "assign"), json={"version": row["version"], "assignee_user_id": self.users["worker"]})
        self.assertEqual(response.status_code, 200, response.text)
        self.task = response.json()

    def login(self, username):
        client = TestClient(self.app)
        self.addCleanup(client.close)
        response = client.post("/api/auth/login", json={"username": username, "password": self.password})
        self.assertEqual(response.status_code, 200)
        return client

    def url(self, task, action):
        return f"/api/projects/{self.pid}/tasks/{task['id']}/{action}"

    def race(self, task, first, second):
        barrier = Barrier(2)
        submission_barrier = Barrier(2)
        original = tasks._task
        original_submission = tasks._latest_submission
        def read_together(*args, **kwargs):
            result = original(*args, **kwargs)
            barrier.wait(timeout=10)
            return result
        def read_submission_together(*args, **kwargs):
            result = original_submission(*args, **kwargs)
            submission_barrier.wait(timeout=10)
            return result
        def send(request):
            client, action, payload = request
            return client.post(self.url(task, action), json={"version": task["version"], **payload})
        with ExitStack() as stack:
            stack.enter_context(patch.object(tasks, "_task", side_effect=read_together))
            if all(request[1] in {"submit", "return", "confirm"} for request in (first, second)):
                stack.enter_context(patch.object(tasks, "_latest_submission", side_effect=read_submission_together))
            pool = stack.enter_context(ThreadPoolExecutor(max_workers=2))
            futures = [pool.submit(send, request) for request in (first, second)]
            responses = [future.result(timeout=20) for future in futures]
        self.assertEqual(sorted(r.status_code for r in responses), [200, 409], [r.text for r in responses])
        conflict = next(r.json()["detail"]["task"] for r in responses if r.status_code == 409)
        current = self.planner.get(f"/api/projects/{self.pid}/tasks/{task['id']}").json()
        self.assertEqual(current["version"], task["version"] + 1)
        self.assertEqual(conflict["version"], current["version"])
        self.assertEqual(conflict["exec_status"], current["exec_status"])
        return current, responses

    def test_start_and_wait_cannot_both_commit_the_same_version(self):
        current, responses = self.race(self.task,
            (self.worker, "status", {"action": "start"}),
            (self.worker_other_browser, "status", {"action": "wait", "wait_reason": "Synthetic delivery"}))
        winner = next(r.json() for r in responses if r.status_code == 200)
        self.assertEqual(current["exec_status"], winner["exec_status"])
        events = self.planner.get(self.url(current, "events")).json()
        self.assertEqual(sum(e["kind"] in {"started", "waiting"} for e in events), 1)

    def test_reassignment_and_old_assignee_start_cannot_merge(self):
        current, responses = self.race(self.task,
            (self.planner, "assign", {"assignee_user_id": self.users["replacement"], "reason": "Synthetic handoff"}),
            (self.worker, "status", {"action": "start"}))
        if responses[0].status_code == 200:
            self.assertEqual((current["assignee"]["id"], current["exec_status"]), (self.users["replacement"], "not_started"))
        else:
            self.assertEqual((current["assignee"]["id"], current["exec_status"]), (self.users["worker"], "in_progress"))

    def test_double_submit_keeps_one_batch_and_one_event(self):
        current, _ = self.race(self.task,
            (self.worker, "submit", {"note": "Synthetic first delivery"}),
            (self.worker_other_browser, "submit", {"note": "Synthetic second click"}))
        self.assertEqual(current["exec_status"], "pending_review")
        self.assertEqual(len(current["submissions"]), 1)
        self.assertEqual(current["submissions"][0]["seq"], 1)
        with Session(self.engine) as session:
            self.assertEqual(len(session.scalars(select(models.TaskSubmission)).all()), 1)
            self.assertEqual(len(session.scalars(select(models.TaskEvent).where(models.TaskEvent.kind == "submitted")).all()), 1)
            self.assertEqual(len(session.scalars(select(models.ProjectUpdate).where(models.ProjectUpdate.text.contains("次交付"))).all()), 1)

    def test_return_and_confirm_commit_one_consistent_decision(self):
        response = self.worker.post(self.url(self.task, "submit"), json={"version": self.task["version"], "note": "Synthetic delivery"})
        self.assertEqual(response.status_code, 200)
        pending = response.json()
        second_reviewer = self.login("planner")
        current, _ = self.race(pending,
            (self.planner, "return", {"reason": "Synthetic missing dimensions"}),
            (second_reviewer, "confirm", {}))
        decision = current["submissions"][0]["decision"]
        self.assertEqual(current["exec_status"], "done" if decision == "confirmed" else "in_progress")
        self.assertEqual(current["done_at"] is not None, decision == "confirmed")
        events = self.planner.get(self.url(current, "events")).json()
        self.assertEqual(sum(e["kind"] in {"returned", "confirmed"} for e in events), 1)
