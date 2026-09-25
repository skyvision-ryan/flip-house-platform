"""KAN-75 块6：预安排与房屋同一事务；失败和重试不留半套项目。"""
from unittest.mock import patch
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app import db, models
from app.routers.projects import router
from tests.test_tasks_assign import _TaskBase


class ProjectPreplanTests(_TaskBase):
    def setUp(self):
        super().setUp()
        self.app.include_router(router)
        def sessions():
            with Session(self.engine, autoflush=False, expire_on_commit=False) as s:
                yield s
        self.app.dependency_overrides[db.get_db] = sessions
        self.body = dict(name='LA 预安排测试', address=dict(label='12 Plan St, Los Angeles, CA', street='12 Plan St', city='Los Angeles', state='CA', zip='90001'),
                         create_analysis=True, request_key=str(uuid4()), join_assignees=True,
                         task_plan=[dict(step_key='screen', assignee_user_id=self.uid['a'], due_at='2026-09-25'),
                                    dict(step_key='design_final', assignee_user_id=self.uid['a']),
                                    dict(step_key='view', due_at='2026-09-26')])

    def counts(self):
        with Session(self.engine) as s:
            return {m.__tablename__: s.scalar(select(func.count()).select_from(m)) for m in
                    (models.Property, models.Project, models.Task, models.ProjectMember, models.TaskEvent, models.ProjectCreation, models.DealAnalysis, models.ProcurementItem)}

    def test_create_all_tasks_preassign_future_and_keep_stage(self):
        j = self.login('jessie')
        r = j.post('/api/projects', json=self.body)
        self.assertEqual(r.status_code, 201, r.text)
        p = r.json()
        self.assertEqual(p['current_stage']['key'], 's1')
        self.assertIsNone(p['purchase_price'])
        self.assertIsNone(p['target_arv'])
        pid = p['id']
        tasks = j.get(f'/api/projects/{pid}/tasks').json()['tasks']
        self.assertEqual(len(tasks), 24)
        self.assertEqual(sum(t['assignee'] is not None for t in tasks), 2)
        self.assertTrue(all(t['exec_status'] == 'not_started' for t in tasks))
        future = next(t for t in tasks if t['step_key'] == 'design_final')
        self.assertEqual(future['reviewer']['id'], self.uid['jessie'])
        self.assertEqual(next(t for t in tasks if t['step_key'] == 'view')['due_at'], '2026-09-26')
        with Session(self.engine) as s:
            self.assertEqual(s.scalar(select(func.count()).select_from(models.ProjectMember).where(models.ProjectMember.project_id == pid)), 2)
            self.assertEqual(s.scalar(select(func.count()).select_from(models.TaskEvent).where(models.TaskEvent.project_id == pid, models.TaskEvent.kind == 'member_added')), 1)
            self.assertEqual(s.scalar(select(func.count()).select_from(models.ProjectStep).where(models.ProjectStep.project_id == pid)), 0)
        self.assertEqual(sum(t['project_id'] == pid for t in self.login('a').get('/api/me/tasks').json()['assigned']), 2)
        self.assertEqual(self.login('a2').get('/api/me/tasks').json()['assigned'], [])

    def test_retry_returns_same_project_after_new_session_and_rejects_changed_payload(self):
        j = self.login('jessie')
        first = j.post('/api/projects', json=self.body)
        self.assertEqual(first.status_code, 201, first.text)
        counts = self.counts()
        retry = self.login('jessie').post('/api/projects', json=self.body)
        self.assertEqual(retry.status_code, 201, retry.text)
        self.assertEqual(first.json()['id'], retry.json()['id'])
        self.assertEqual(self.counts(), counts)
        self.assertEqual(j.post('/api/projects', json={**self.body, 'name': 'Changed'}).status_code, 409)
        self.assertEqual(self.counts(), counts)

    def test_invalid_plan_never_leaves_partial_project(self):
        j = self.login('jessie')
        cases = [([{'step_key': 'open_escrow'}], True), ([{'step_key': 'screen'}, {'step_key': 'screen'}], True),
                 ([{'step_key': 'screen', 'assignee_user_id': 99999}], True), (self.body['task_plan'], False),
                 ([{'step_key': 'view', 'due_at': '2026-02-30'}], True)]
        before = self.counts()
        for plan, join in cases:
            with self.subTest(plan=plan):
                r = j.post('/api/projects', json={**self.body, 'task_plan': plan, 'join_assignees': join})
                self.assertIn(r.status_code, (400, 422), r.text)
                self.assertEqual(self.counts(), before)
        with Session(self.engine) as s:
            s.get(models.User, self.uid['a']).active = False
            s.commit()
        self.assertEqual(j.post('/api/projects', json=self.body).status_code, 400)
        self.assertEqual(self.counts(), before)

    def test_late_failure_rolls_back_property_analysis_procurement_and_tasks(self):
        j = self.login('jessie')
        before = self.counts()
        with patch('app.routers.tasks.ensure_member', side_effect=RuntimeError('injected failure')):
            with self.assertRaises(RuntimeError):
                j.post('/api/projects', json=self.body)
        self.assertEqual(self.counts(), before)
        self.assertEqual(j.post('/api/projects', json=self.body).status_code, 201)

    def test_zero_assignments_still_creates_all_ordinary_tasks(self):
        j = self.login('jessie')
        r = j.post('/api/projects', json={**self.body, 'task_plan': [], 'join_assignees': False})
        self.assertEqual(r.status_code, 201, r.text)
        ts = j.get(f"/api/projects/{r.json()['id']}/tasks").json()['tasks']
        self.assertEqual(len(ts), 24)
        self.assertTrue(all(t['assignee'] is None for t in ts))

    def test_plan_and_candidates_require_real_authorized_account(self):
        anon = TestClient(self.app)
        self.addCleanup(anon.close)
        self.assertEqual(anon.post('/api/projects', json=self.body).status_code, 401)
        self.assertEqual(anon.get('/api/projects/creation-members').status_code, 401)
        a = self.login('a')
        self.assertEqual(a.post('/api/projects', json=self.body).status_code, 403)
        self.assertEqual(a.get('/api/projects/creation-members').status_code, 403)
        r = self.login('jessie').get('/api/projects/creation-members')
        self.assertEqual(r.status_code, 200, r.text)
        self.assertNotIn('email', r.json()[0])
