"""Generator/backup safety only; API workflow acceptance lives in its own suite."""
from datetime import date
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app import db, models
from app.routers.files import _can_download, _can_touch
from app.routers.tasks import _event_text
from app.steps import compute_steps

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "prepare_team_demo.py"
SPEC = importlib.util.spec_from_file_location("prepare_team_demo", SCRIPT)
demo = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(demo)


class TeamDemoGeneratorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="team-demo-generator-tests-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.database = self.root / "app.db"
        self.uploads = self.root / "uploads"
        self.backups = self.root / "backups"
        self.uploads.mkdir()
        self.engine = create_engine(f"sqlite:///{self.database}")
        self.addCleanup(self.engine.dispose)
        db.Base.metadata.create_all(self.engine)
        self.roster = []
        with Session(self.engine) as session:
            for index, (name, role) in enumerate(demo.SLOTS.items()):
                email = f"employee-{index}@example.com"
                self.roster.append({"name": name.title(), "email": email, "role": role})
                session.add(models.User(username=f"test-{index}", email=email, display_name=name.title(), role_code=role,
                                        password_hash=f"untouched-test-hash-{index}"))
            admin = models.User(username="test-admin", display_name="Test admin", role_code="负责人", is_admin=True, password_hash="untouched-admin-hash")
            untouched = models.User(username="unlisted", display_name="Unlisted", role_code="D", password_hash="untouched-unlisted-hash")
            session.add_all([admin, untouched]); session.flush()
            self.admin_id = admin.id
            prop = models.Property(address_std="Unrelated synthetic sentinel")
            session.add(prop); session.flush()
            project = models.Project(property_id=prop.id, name="Unrelated sentinel", stage="lead", notes="Keep untouched")
            session.add(project); session.flush()
            self.sentinel_id = project.id
            path = self.uploads / "sentinel.txt"
            path.write_text("Sentinel attachment remains unchanged", encoding="utf-8")
            session.add(models.ProjectFile(project_id=project.id, filename="sentinel.txt", stored_path=str(path), mime="text/plain", size=path.stat().st_size))
            session.commit()
        self.users_before = self.users_snapshot()

    def users_snapshot(self):
        with sqlite3.connect(self.database) as connection:
            return connection.execute("SELECT * FROM users ORDER BY id").fetchall()

    def run_generator(self, **kwargs):
        return demo.prepare_demo(self.database, self.uploads, self.roster, self.admin_id, date(2026, 9, 24),
                                 backup_dir=self.backups, **kwargs)

    def test_default_dry_run_leaves_database_uploads_and_accounts_untouched(self):
        checksum = demo._sha(self.database)
        result = self.run_generator()
        self.assertEqual(result["mode"], "dry-run")
        self.assertEqual(result["template_tasks"], 72)
        self.assertEqual(result["current_role_tasks"], 48)
        self.assertEqual(demo._sha(self.database), checksum)
        self.assertEqual(list(self.uploads.iterdir()), [self.uploads / "sentinel.txt"])
        self.assertFalse(self.backups.exists())

    def test_apply_binds_existing_ids_provides_120_tasks_and_legal_evidence(self):
        result = self.run_generator(apply=True)
        self.assertEqual(result["mode"], "applied")
        self.assertTrue(result["restore_verified"])
        self.assertEqual(self.users_snapshot(), self.users_before)
        with Session(self.engine) as session:
            projects = [session.get(models.Project, pid) for pid in result["project_ids"]]
            self.assertEqual([compute_steps(session, project)["current_stage"]["key"] for project in projects], ["s1", "s3", "s5"])
            for project in projects:
                steps = compute_steps(session, project)
                self.assertEqual(sum(len(stage["items"]) for stage in steps["stages"]), 31)
                self.assertEqual(session.scalar(select(func.count()).select_from(models.Task).where(models.Task.project_id == project.id, models.Task.source == "template")), 24)
                self.assertIsNone(project.sale_date)
                self.assertIsNone(project.sale_price)
            self.assertEqual(session.scalar(select(func.count()).select_from(models.Task)), 120)
            for uid in result["assignee_ids"].values():
                own = session.scalars(select(models.Task).where(models.Task.assignee_user_id == uid)).all()
                self.assertGreaterEqual(len(own), 6)
                self.assertTrue(any(task.source == "adhoc" and task.exec_status == "in_progress" for task in own))
                self.assertTrue(any(task.exec_status == "pending_review" for task in own))
            for record in session.scalars(select(models.ProjectFile).where(models.ProjectFile.project_id.in_(result["project_ids"]))).all():
                self.assertTrue(Path(record.stored_path).is_file())
                self.assertEqual(Path(record.stored_path).stat().st_size, record.size)
                self.assertTrue(_can_touch(record.uploaded_by, record.doc_type, record.step_key))
            for link in session.scalars(select(models.SubmissionFile)).all():
                sub = session.get(models.TaskSubmission, link.submission_id)
                file = session.get(models.ProjectFile, link.file_id)
                user = session.get(models.User, sub.submitted_by_user_id)
                self.assertEqual(sub.project_id, file.project_id)
                self.assertTrue(_can_download(user.role_code, file))
            self.assertEqual(session.get(models.Project, self.sentinel_id).notes, "Keep untouched")

    def test_reopen_and_repeat_preserves_user_operations_and_attachment_ids(self):
        result = self.run_generator(apply=True)
        with Session(self.engine) as session:
            task = session.scalar(select(models.Task).where(models.Task.source == "adhoc"))
            task.description = "User changed this after demo initialization"
            task_id = task.id
            session.commit()
            files = session.scalar(select(func.count()).select_from(models.ProjectFile))
        self.engine.dispose()
        second = self.run_generator(apply=True)
        self.assertEqual(second["mode"], "unchanged")
        self.assertEqual(second["project_ids"], result["project_ids"])
        with Session(self.engine) as session:
            self.assertEqual(session.get(models.Task, task_id).description, "User changed this after demo initialization")
            self.assertEqual(session.scalar(select(func.count()).select_from(models.ProjectFile)), files)
        self.assertEqual(len(list(self.backups.iterdir())), 1)

    def test_prior_stage_tasks_and_historical_dates_match_project_progress(self):
        result = self.run_generator(apply=True)
        with Session(self.engine) as session:
            for pid in result["project_ids"]:
                project = session.get(models.Project, pid)
                current = compute_steps(session, project)["current_stage"]["key"]
                prop = session.get(models.Property, project.property_id)
                self.assertGreater(prop.lot_sqft, prop.sqft)
                source = session.scalar(select(models.PropertyFieldSource).where(
                    models.PropertyFieldSource.property_id == prop.id, models.PropertyFieldSource.field == "lot_sqft"))
                self.assertEqual(source.source, "demo")
                tasks = session.scalars(select(models.Task).where(models.Task.project_id == pid)).all()
                extra = [task for task in tasks if task.source == "adhoc"]
                self.assertEqual(len(extra), 16)
                self.assertTrue(all(task.stage_key == current and task.exec_status != "done" for task in extra))
                for task in tasks:
                    if task.source == "template" and int(task.stage_key[1:]) < int(current[1:]):
                        self.assertEqual(task.exec_status, "done")
                        self.assertIsNotNone(task.done_at)
                    events = session.scalars(select(models.TaskEvent).where(models.TaskEvent.task_id == task.id)).all()
                    self.assertTrue(all(event.created_at >= task.created_at for event in events))
                    self.assertEqual(task.updated_at, max(event.created_at for event in events))
                if project.list_date:
                    finals = session.scalars(select(models.Inspection).where(models.Inspection.project_id == pid, models.Inspection.is_final.is_(True))).all()
                    self.assertTrue(all(item.date < project.list_date for item in finals))
                    self.assertLess(project.construction_end, project.list_date)
            for link in session.scalars(select(models.SubmissionFile)).all():
                submission = session.get(models.TaskSubmission, link.submission_id)
                file = session.get(models.ProjectFile, link.file_id)
                self.assertLessEqual(file.uploaded_at, submission.submitted_at)
                if submission.decided_at:
                    self.assertLessEqual(submission.submitted_at, submission.decided_at)

    def test_handoff_event_text_contains_real_sequence_and_attachment_count(self):
        self.run_generator(apply=True)
        with Session(self.engine) as session:
            names = {user.id: user.display_name for user in session.scalars(select(models.User)).all()}
            events = session.scalars(select(models.TaskEvent).where(models.TaskEvent.kind.in_(["submitted", "returned", "confirmed"]))).all()
            self.assertEqual({event.kind for event in events}, {"submitted", "returned", "confirmed"})
            for event in events:
                after = json.loads(event.after_json)
                submission = session.get(models.TaskSubmission, after["submission_id"])
                description = _event_text(event, names)
                self.assertNotIn("None", description)
                self.assertIn(f"第 {submission.seq} 次", description)
                self.assertEqual(after["seq"], submission.seq)
                if event.kind == "submitted":
                    count = session.scalar(select(func.count()).select_from(models.SubmissionFile).where(models.SubmissionFile.submission_id == submission.id))
                    self.assertEqual(after["files"], count)
                    self.assertIn(f"{count} 个文件" if count else "只交了说明", description)

    def test_explicit_replacement_has_verified_backup_and_preserves_unlisted_account(self):
        result = self.run_generator(apply=True, replace_project_ids=[self.sentinel_id])
        backup = Path(result["backup"])
        self.assertTrue(json.loads((backup / "manifest.json").read_text())["restore_verified"])
        self.assertEqual((backup / "uploads" / "sentinel.txt").read_text(), "Sentinel attachment remains unchanged")
        with sqlite3.connect(backup / "database.sqlite3") as connection:
            self.assertEqual(connection.execute("SELECT name FROM projects WHERE id=?", [self.sentinel_id]).fetchone()[0], "Unrelated sentinel")
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM tasks").fetchone()[0], 0)
        with Session(self.engine) as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(models.Project)), 3)
        self.assertFalse((self.uploads / "sentinel.txt").exists())
        self.assertEqual(self.users_snapshot(), self.users_before)

    def test_failure_rolls_back_projects_and_only_removes_attempt_files(self):
        original = demo._make_project
        def failing(db, index, *args):
            if index == 1: raise RuntimeError("Synthetic injected failure")
            return original(db, index, *args)
        with patch.object(demo, "_make_project", side_effect=failing):
            with self.assertRaises(RuntimeError): self.run_generator(apply=True, replace_project_ids=[self.sentinel_id])
        with Session(self.engine) as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(models.Project)), 1)
            self.assertEqual(session.get(models.Project, self.sentinel_id).notes, "Keep untouched")
            self.assertEqual(session.scalar(select(func.count()).select_from(models.Task)), 0)
        self.assertEqual([path.name for path in self.uploads.rglob("*") if path.is_file()], ["sentinel.txt"])
        self.assertEqual(self.users_snapshot(), self.users_before)

    def test_bad_roles_admin_missing_roster_and_replace_range_fail_before_writes(self):
        invalid = [dict(row) for row in self.roster]
        invalid[0]["role"] = "D"
        with self.assertRaises(ValueError): demo.prepare_demo(self.database, self.uploads, invalid, self.admin_id, date(2026, 9, 24))
        with self.assertRaises(ValueError): demo.prepare_demo(self.database, self.uploads, self.roster[:-1], self.admin_id, date(2026, 9, 24))
        with self.assertRaises(ValueError): demo.prepare_demo(self.database, self.uploads, self.roster, 99999, date(2026, 9, 24))
        with self.assertRaises(ValueError): self.run_generator(apply=True, replace_project_ids=[99999])
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.users_snapshot(), self.users_before)

    def test_partial_scope_is_not_silently_rebuilt(self):
        result = self.run_generator(apply=True)
        with Session(self.engine) as session:
            project = session.get(models.Project, result["project_ids"][0])
            project.property.apn = "Changed marker"
            session.commit()
        with self.assertRaises(ValueError): self.run_generator(apply=True)

    def test_backup_failure_blocks_all_project_mutations(self):
        with patch.object(demo, "backup_and_verify", side_effect=ValueError("Synthetic backup failure")):
            with self.assertRaises(ValueError): self.run_generator(apply=True, replace_project_ids=[self.sentinel_id])
        with Session(self.engine) as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(models.Project)), 1)
        self.assertTrue((self.uploads / "sentinel.txt").exists())

    def test_replacement_rejects_physical_attachments_shared_outside_scope(self):
        with Session(self.engine) as session:
            prop = models.Property(address_std="Another synthetic sentinel")
            session.add(prop); session.flush()
            project = models.Project(property_id=prop.id, name="Outside approved scope", stage="lead")
            session.add(project); session.flush()
            session.add(models.ProjectFile(project_id=project.id, filename="shared-sentinel.txt", stored_path=str(self.uploads / "sentinel.txt")))
            session.commit()
        with self.assertRaises(ValueError): self.run_generator(apply=True, replace_project_ids=[self.sentinel_id])
        self.assertTrue((self.uploads / "sentinel.txt").exists())
        with Session(self.engine) as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(models.Project)), 2)


if __name__ == "__main__":
    unittest.main()
