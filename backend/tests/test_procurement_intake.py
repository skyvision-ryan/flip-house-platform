"""New-house defaults and atomic purchase assignment; never migrate old houses."""
from unittest.mock import patch
from sqlalchemy import select
from sqlalchemy.orm import Session
from app import models
from app.dictionaries import PROCUREMENT_TEMPLATE
from app.routers import projects, procurement
from tests.test_tasks_assign import _TaskBase


class ProcurementIntakeTests(_TaskBase):
    def setUp(self):
        super().setUp()
        self.app.include_router(projects.router)
        self.app.include_router(procurement.router)
        with Session(self.engine) as s:
            s.get(models.User, self.uid['a']).role_code = '采购'
            s.commit()
        self.body = dict(name='Synthetic new house', address=dict(label='999 Synthetic Intake Road', street='999 Synthetic Intake Road', city='', state='CA', zip=''),
                         create_analysis=False, request_key='04c54e01-9c44-4efb-b9a0-05b649a5e001',
                         task_plan=[dict(step_key='purchase', assignee_user_id=self.uid['a'])])

    def counts(self):
        with Session(self.engine) as s:
            return {m.__tablename__: s.query(m).count() for m in (models.Project, models.Property, models.ProjectMember,
                models.Task, models.TaskEvent, models.ProcurementItem, models.ProjectCreation)}

    def test_new_template_visible_and_purchase_membership_atomic_idempotent(self):
        j = self.login('jessie')
        # An extra active template entry proves the implementation doesn't pin a count.
        template = [*PROCUREMENT_TEMPLATE, dict(name='Synthetic future template', wave='other')]
        with patch.object(procurement, 'PROCUREMENT_TEMPLATE', template):
            response = j.post('/api/projects', json=self.body)
        self.assertEqual(response.status_code, 201, response.text)
        pid = response.json()['id']; counts = self.counts()
        buyer = self.login('a')
        rows = buyer.get(f'/api/projects/{pid}/procurement').json()['items']
        self.assertEqual([r['name'] for r in rows], [t['name'] for t in template])
        self.assertTrue(all(r['in_worklist'] and r['status'] == 'pending_spec' and r['amount'] is None for r in rows))
        self.assertEqual(j.post('/api/projects', json=self.body).json()['id'], pid)
        self.assertEqual(self.counts(), counts)
        self.assertEqual(buyer.post(f'/api/projects/{pid}/procurement/init').json()['items'], rows)
        with Session(self.engine) as s:
            self.assertEqual({m.user_id for m in s.scalars(select(models.ProjectMember).where(models.ProjectMember.project_id == pid))}, {self.uid['jessie'], self.uid['a']})
            self.assertEqual(s.scalar(select(models.Task).where(models.Task.project_id == pid, models.Task.step_key == 'purchase')).assignee_user_id, self.uid['a'])
        self.assertEqual(self.login('a2').get(f'/api/projects/{pid}/procurement').status_code, 403)

    def test_late_assignment_failure_rolls_back_new_member_and_template(self):
        from app.routers.tasks import ensure_member
        before = self.counts()
        def fail_after_member(*args):
            ensure_member(*args)
            if args[2].id == self.uid['a']:
                raise RuntimeError('fail after joining purchase owner')
        with patch('app.routers.tasks.ensure_member', side_effect=fail_after_member):
            with self.assertRaises(RuntimeError):
                self.login('jessie').post('/api/projects', json=self.body)
        self.assertEqual(self.counts(), before)
        self.assertEqual(self.login('jessie').post('/api/projects', json=self.body).status_code, 201)

    def test_existing_requirements_exclusions_and_legacy_facts_are_untouched(self):
        with Session(self.engine) as s:
            s.add_all([models.ProcurementItem(project_id=self.pid, name='Manual existing', wave='other', note='Keep', worklist_selected=False),
                       models.ProcurementItem(project_id=self.pid, name='Excluded', wave='other', status='na', note='本房不需要：现场保留'),
                       models.ProcurementItem(project_id=self.pid, name='Old purchase', wave='other', amount=123, status='received', received_on='2026-08-01')])
            s.commit()
        client = self.login('jessie'); path = f'/api/projects/{self.pid}/procurement'
        before = client.get(path).json()
        self.assertEqual(client.post('/api/projects', json=self.body).status_code, 201)
        self.assertEqual(client.post(path + '/init').json(), before)
        with Session(self.engine) as s:
            procurement.ensure_procurement(s, self.pid, select_all=True)
        self.assertEqual(client.get(path).json(), before)
        tracking = client.get('/api/me/procurement-tracking').json()
        self.assertEqual(tracking['projects'][0]['name'], 'Synthetic new house')

    def test_wrong_role_and_inactive_account_cannot_be_purchase_owner(self):
        client = self.login('jessie'); before = self.counts()
        bad = {**self.body, 'task_plan':[dict(step_key='purchase', assignee_user_id=self.uid['b'])]}
        self.assertEqual(client.post('/api/projects', json=bad).status_code, 400)
        with Session(self.engine) as s:
            s.get(models.User, self.uid['a']).active = False; s.commit()
        self.assertEqual(client.post('/api/projects', json=self.body).status_code, 400)
        self.assertEqual(self.counts(), before)

    def test_exclude_restore_keeps_reason_and_restores_worklist_and_progress(self):
        client=self.login('jessie')
        pid=client.post('/api/projects',json=self.body).json()['id']
        path=f'/api/projects/{pid}/procurement'
        row=client.get(path).json()['items'][0]
        response=client.post(path+'/not-needed',json={'reason':'现场保留旧设备','items':[{'id':row['id'],'updated_at':row['updated_at']}]})
        self.assertEqual(response.status_code,200,response.text)
        excluded=response.json()['items'][0]
        self.assertFalse(excluded['in_worklist'])
        task=next(t for t in client.get('/api/me/procurement-tracking').json()['tasks'] if t['project_id']==pid)
        self.assertEqual(task['procurement_progress']['excluded'],1)
        self.assertEqual(task['procurement_progress']['total'],len(PROCUREMENT_TEMPLATE)-1)
        # Old houses may have explicitly hidden the excluded row.
        with Session(self.engine) as s:
            s.get(models.ProcurementItem,row['id']).worklist_selected=False;s.commit()
        response=client.patch(f'/api/procurement/{row["id"]}',json={'status':'pending_spec'})
        self.assertEqual(response.status_code,200,response.text)
        restored=response.json()['items'][0]
        self.assertTrue(restored['in_worklist']);self.assertEqual(restored['note'],excluded['note'])
        task=next(t for t in client.get('/api/me/procurement-tracking').json()['tasks'] if t['project_id']==pid)
        self.assertEqual(task['procurement_progress']['total'],len(PROCUREMENT_TEMPLATE))
