"""Upgrade a synthetic d2eb676-shaped database twice without rewriting old rows."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from app import db, models, task_activity


class WorkbenchMigrationTests(unittest.TestCase):
    def test_incremental_tables_and_baseline_preserve_original_rows_idempotently(self):
        with tempfile.TemporaryDirectory() as temp:
            engine = create_engine('sqlite:///' + str(Path(temp) / 'old.db'))
            self.addCleanup(engine.dispose)
            old = [t for t in models.Base.metadata.sorted_tables if t.name not in {'workflow_baselines', 'task_workflow_transitions'}]
            models.Base.metadata.create_all(engine, tables=old)
            with Session(engine) as s:
                u = models.User(username='synthetic', display_name='Original Name', role_code='J', password_hash='original-synthetic-hash')
                prop = models.Property(address_std='100 Synthetic Migration Street'); s.add_all([u, prop]); s.flush()
                p = models.Project(property_id=prop.id, name='Original house', holding_company='Original Holdings LLC', created_at='2026-01-01T01:02:03')
                s.add(p); s.flush()
                t = models.Task(project_id=p.id, title='Original task', source='adhoc', stage_key='s1', assignee_user_id=u.id,
                                reviewer_user_id=u.id, exec_status='waiting', wait_reason='Original wait', version=7)
                s.add(t); s.flush()
                s.execute(text("INSERT INTO task_events(task_id,project_id,kind,created_at,reason) VALUES(:t,:p,'waiting','2026-01-01T01:02:03','Original history')"), {'t': t.id, 'p': p.id})
                s.commit()
            def snapshot():
                with engine.connect() as conn:
                    return {table.name: conn.execute(text('SELECT * FROM "'+table.name+'"')).fetchall() for table in old}
            before = snapshot()
            with patch.object(db, 'engine', engine):
                db.init_db(); db.init_db()
            with Session(engine) as s:
                task_activity.initialize(s); baseline = s.get(models.WorkflowBaseline, 'state_changes').started_at
                task_activity.initialize(s)
                self.assertEqual(s.get(models.WorkflowBaseline, 'state_changes').started_at, baseline)
                self.assertEqual(list(s.scalars(text('SELECT id FROM task_workflow_transitions'))), [])
            self.assertEqual(snapshot(), before)
