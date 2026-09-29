"""KAN-29: actual account requests, evidence, intake, retries and historical compatibility."""
import json
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app import models
from app.routers import projects, steps, ops
from app.routers.tasks import ensure_member, ensure_tasks
from tests.test_tasks_assign import _TaskBase


class NodeConfirmationTests(_TaskBase):
    def setUp(self):
        super().setUp()
        for router in (projects.router, steps.router, ops.router):
            self.app.include_router(router)
        with Session(self.engine) as s:
            david = models.User(username='david', display_name='David', role_code='D', password_hash=s.get(models.User, self.uid['jessie']).password_hash)
            buyer = models.User(username='jeremy', display_name='Jeremy', role_code='采购', password_hash=david.password_hash)
            s.add_all([david, buyer]); s.flush()
            self.uid.update(david=david.id, jeremy=buyer.id)
            ensure_member(s, self.pid, buyer, None)
            s.commit()
        self.j = self.login('jessie')
        self.d = self.login('david')

    def evidence(self, key):
        with Session(self.engine) as s:
            p = s.get(models.Project, self.pid)
            docs = {'open_escrow': 'purchase_contract', 'close_escrow': 'closing_statement', 'start': 'permit', 'listing': 'listing_agreement'}
            if key in docs:
                s.add(models.ProjectFile(project_id=self.pid, filename='Synthetic.pdf', stored_path='/tmp/synthetic.pdf', doc_type=docs[key], stage='通用', source='demo'))
            if key == 'close_escrow': p.purchase_date = '2026-09-29'
            if key == 'start': p.construction_start = '2026-09-29'
            if key == 'final': s.add(models.Inspection(project_id=self.pid, name='Synthetic Final', date='2026-09-29', result='passed', is_final=True))
            s.commit()

    def confirm(self, key, client=None, version=None):
        task = self.task(self.j, key)
        return (client or self.j).post(f'/api/projects/{self.pid}/tasks/{task["id"]}/confirm', json={'version': version or task['version']})

    def test_all_five_require_evidence_and_one_actual_person(self):
        for key in ['open_escrow', 'close_escrow', 'start', 'final', 'listing']:
            with self.subTest(key=key):
                self.assertEqual(self.confirm(key).status_code, 409)
                self.evidence(key)
                t = self.task(self.j, key)
                self.assertEqual(t['exec_status'], 'pending_review')
                self.assertIn(t['id'], [x['id'] for x in self.j.get('/api/me/tasks').json()['reviewing']])
                self.assertEqual(self.confirm(key, self.login('jeremy')).status_code, 403)
                if key == 'listing': self.assertEqual(self.confirm(key, self.d).status_code, 403)
                r = self.confirm(key)
                self.assertEqual(r.status_code, 200, r.text)
                self.assertTrue(r.json()['satisfied'])
                self.assertEqual(r.json()['node_confirmation']['confirmation']['user_id'], self.uid['jessie'])
                self.assertEqual(self.confirm(key, version=t['version']).status_code, 200)
                self.assertNotIn(t['id'], [x['id'] for x in self.d.get('/api/me/tasks').json()['reviewing']])
                with Session(self.engine) as s:
                    self.assertEqual(s.scalar(select(func.count()).select_from(models.TaskEvent).where(models.TaskEvent.task_id == t['id'], models.TaskEvent.kind == 'node_confirmed')), 1)

    def test_latest_final_failure_invalidates_pending_and_preserves_confirmation(self):
        self.evidence('final')
        self.assertEqual(self.confirm('final').status_code, 200)
        with Session(self.engine) as s:
            s.add(models.Inspection(project_id=self.pid, name='New failure', date='2026-09-30', result='failed', is_final=True)); s.commit()
        t = self.task(self.j, 'final')
        self.assertFalse(t['satisfied'])
        self.assertTrue(t['node_confirmation']['needs_review'])
        self.assertEqual(self.confirm('final').status_code, 409)
        self.assertEqual(t['node_confirmation']['confirmation']['user_id'], self.uid['jessie'])
        with Session(self.engine) as s:
            s.add(models.Inspection(project_id=self.pid, name='Latest passed', date='2026-10-01', result='passed', is_final=True)); s.commit()
        self.assertEqual(self.task(self.j, 'final')['exec_status'], 'pending_review')
        self.assertEqual(self.confirm('final').status_code, 200)

    def test_pending_reverts_and_old_step_url_cannot_bypass(self):
        self.evidence('start')
        t = self.task(self.j, 'start')
        self.assertEqual(t['exec_status'], 'pending_review')
        with Session(self.engine) as s:
            s.get(models.Project, self.pid).construction_start = None; s.commit()
        self.assertEqual(self.task(self.j, 'start')['exec_status'], 'not_started')
        self.assertEqual(self.j.post(f'/api/projects/{self.pid}/steps/start', json={'done': True}).status_code, 409)
        for action, body in [('status', {'action':'start'}), ('assign', {'assignee_user_id': self.uid['jessie']}), ('submit',{})]:
            self.assertEqual(self.j.post(f'/api/projects/{self.pid}/tasks/{t["id"]}/{action}', json={'version':t['version'], **body}).status_code, 409)

    def test_midstage_intake_is_not_historical_completion_and_purchase_appears_for_buyer(self):
        payload = dict(name='Synthetic midstage', initial_stage_key='s3', address=dict(label='34 Synthetic Lane', street='34 Synthetic Lane', city='', state='', zip=''), create_analysis=False,
                       task_plan=[{'step_key':'purchase', 'assignee_user_id':self.uid['jeremy']}], join_assignees=True)
        r = self.j.post('/api/projects', json=payload)
        self.assertEqual(r.status_code, 201, r.text)
        p = r.json(); self.assertEqual(p['current_stage']['key'], 's3')
        self.assertTrue(p['group_position']['history_pending'])
        ts = self.j.get(f'/api/projects/{p["id"]}/steps').json()
        self.assertTrue(all(not i['done'] for st in ts['stages'][:2] for i in st['items']))
        with Session(self.engine) as s:
            self.assertEqual(s.scalar(select(func.count()).select_from(models.ProjectStep).where(models.ProjectStep.project_id == p['id'])), 0)
            self.assertIsNone(s.get(models.Project,p['id']).lead_heat)
        buyer = self.login('jeremy')
        tasks = buyer.get('/api/me/tasks').json()['assigned']
        self.assertTrue(any(t['project_id'] == p['id'] and t['step_key']=='purchase' for t in tasks))
        self.assertEqual(self.login('a2').get(f'/api/projects/{p["id"]}/tasks').status_code, 403)

    def test_stale_ui_identity_is_rejected_before_write(self):
        r = self.j.post('/api/projects', json=dict(name='Must not create', address=dict(label='x',street='x',city='',state='',zip='')), headers={'X-Session-User':str(self.uid['jeremy'])})
        self.assertEqual(r.status_code, 409)
        self.assertIn('SESSION_CHANGED', r.text)
        with Session(self.engine) as s: self.assertEqual(s.scalar(select(func.count()).select_from(models.Project)), 1)
