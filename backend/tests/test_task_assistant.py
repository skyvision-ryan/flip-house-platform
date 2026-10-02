"""A-12/A-34: one task, distinct identities, atomic membership, independent notes."""
from unittest.mock import patch
from uuid import uuid4
from sqlalchemy import select, func, text
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError
from app import models, db
from app.routers.projects import router as projects_router
from app.routers.files import router as files_router
from app.routers.purchase_orders import router as orders_router
from tests.test_tasks_assign import _TaskBase


class AssistantTests(_TaskBase):
    def setUp(self):
        super().setUp()
        self.app.include_router(projects_router); self.app.include_router(files_router); self.app.include_router(orders_router)
        with Session(self.engine) as s:
            t = models.Task(project_id=self.pid, source='adhoc', stage_key='s1', title='Synthetic task', reviewer_user_id=self.uid['jessie'])
            s.add(t); s.commit(); self.tid = t.id
        self.j = self.login('jessie'); self.url = f'/api/projects/{self.pid}/tasks/{self.tid}'

    def current(self):
        return self.j.get(self.url).json()

    def assign(self, **changes):
        return self.j.post(self.url+'/assign', json={'version': self.current()['version'], **changes})

    def counts(self):
        with Session(self.engine) as s:
            return tuple(s.scalar(select(func.count()).select_from(m)) for m in (models.Task, models.ProjectMember, models.TaskEvent, models.TaskSubmission, models.TaskNote))

    def test_same_task_and_permissions_notes_without_submission(self):
        r = self.assign(assignee_user_id=self.uid['a2'], assistant_user_id=self.uid['b'], join_project=False)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['reviewer']['id'], self.uid['jessie'])
        a, b = self.login('a2'), self.login('b')
        self.assertEqual([t['id'] for t in a.get('/api/me/tasks').json()['assigned']], [self.tid])
        self.assertEqual([t['id'] for t in b.get('/api/me/tasks').json()['assisting']], [self.tid])
        self.assertEqual(b.get('/api/me/tasks').json()['assigned'], [])
        self.assertEqual(b.get(self.url).json()['id'], self.tid)
        before = self.counts()
        for suffix, body in (('status', {'action':'start'}), ('submit', {'note':'not allowed'}), ('assign', {'assignee_user_id':self.uid['b']}), ('confirm', {}), ('return', {'reason':'not allowed'})):
            response = b.post(self.url+'/'+suffix, json={'version':r.json()['version'], **body})
            self.assertEqual(response.status_code, 403, (suffix,response.text))
        self.assertEqual(self.counts(), before)
        started = a.post(self.url+'/status', json={'version':r.json()['version'], 'action':'start'}).json()
        body = {'request_key':str(uuid4()), 'text':'B original note / 36 in'}
        noted = b.post(self.url+'/notes', json=body)
        self.assertEqual(noted.status_code, 200, noted.text)
        self.assertEqual(noted.json()['version'], started['version'])
        self.assertEqual(noted.json()['exec_status'], 'in_progress')
        note = noted.json()['notes'][0]
        self.assertEqual((note['author']['id'],note['text']), (self.uid['b'],body['text']))
        self.assertTrue(note['created_at'])
        counts = self.counts()
        self.assertEqual(b.post(self.url+'/notes', json=body).status_code, 200)
        self.assertEqual(b.post(self.url+'/notes', json={**body,'text':'different'}).status_code,409)
        self.assertEqual(self.counts(), counts)
        self.assertEqual(noted.json()['submissions'], [])
        submitted = a.post(self.url+'/submit', json={'version':started['version'], 'note':'A delivers'})
        self.assertEqual(submitted.status_code,200,submitted.text)
        self.assertEqual(b.get(self.url).json()['submissions'][0]['note'],'A delivers')
        self.assertEqual(b.post(self.url+'/confirm', json={'version':submitted.json()['version']}).status_code,403)
        self.assertEqual(self.j.post(self.url+'/confirm', json={'version':submitted.json()['version']}).status_code,200)

    def test_pair_accounts_and_stale_are_atomic(self):
        with Session(self.engine) as s:
            s.get(models.User,self.uid['b']).active=False; s.commit()
        before=self.counts()
        for changes in ({'assignee_user_id':self.uid['a2'],'assistant_user_id':self.uid['a2']}, {'assistant_user_id':self.uid['a2']}, {'assignee_user_id':self.uid['a2'],'assistant_user_id':self.uid['b']}, {'assignee_user_id':self.uid['a2'],'assistant_user_id':99999}):
            self.assertEqual(self.assign(**changes).status_code,400)
            self.assertEqual(self.counts(),before)
        stale=self.current()['version']
        self.assertEqual(self.assign(assignee_user_id=self.uid['a']).status_code,200)
        before=self.counts()
        r=self.j.post(self.url+'/assign',json={'version':stale,'assignee_user_id':self.uid['a2'],'assistant_user_id':self.uid['jessie'],'reason':'change'})
        self.assertEqual(r.status_code,409); self.assertEqual(self.counts(),before)

    def test_losing_transaction_rolls_back_both_members_and_events(self):
        before=self.counts(); original=Session.commit
        def conflict(s):
            if any(isinstance(x,models.ProjectMember) and x.user_id==self.uid['b'] for x in s.new):
                s.flush(); raise StaleDataError('optimistic lock loss after flush')
            return original(s)
        with patch.object(Session,'commit',conflict):
            result=self.assign(assignee_user_id=self.uid['a2'],assistant_user_id=self.uid['b'])
        self.assertEqual(result.status_code,409,result.text)
        self.assertEqual(self.counts(),before)
        self.assertIsNone(self.current()['assignee']); self.assertIsNone(self.current()['assistant'])

    def test_replace_remove_preserves_wait_review_and_membership(self):
        self.assign(assignee_user_id=self.uid['a'],assistant_user_id=self.uid['b'])
        with Session(self.engine) as s:
            t=s.get(models.Task,self.tid);t.exec_status='waiting';t.wait_reason='Original wait';t.wait_until='2026-11-01'
            s.add(models.TaskSubmission(task_id=t.id,project_id=self.pid,seq=1,note='Original delivery',submitted_by_user_id=self.uid['a'],decision='returned',decided_by_user_id=self.uid['jessie'],decision_reason='Original review'));s.commit()
        before=self.current()
        self.assertEqual(self.assign(assistant_user_id=self.uid['a2']).status_code,400)
        r=self.assign(assistant_user_id=self.uid['a2'],reason='B leave')
        self.assertEqual(r.status_code,200,r.text)
        for key in ('assignee','reviewer','exec_status','wait_reason','wait_until','submissions','created_at'):
            self.assertEqual(r.json()[key],before[key],key)
        self.assertEqual(self.login('b').get('/api/me/tasks').json()['assisting'],[])
        self.assertEqual(self.assign(assistant_user_id=None,reason='Done helping').status_code,200)
        members=self.j.get(f'/api/projects/{self.pid}/members').json()['members']
        self.assertTrue({self.uid['b'],self.uid['a2']}.issubset({m['id'] for m in members}))
        change=next(e for e in self.j.get(self.url+'/events').json() if e['kind']=='assistant_changed' and e['reason']=='B leave')
        self.assertEqual(change['before']['assistant_user_id'],self.uid['b'])
        self.assertEqual(change['after']['assistant_user_id'],self.uid['a2'])
        self.assertEqual(change['actor']['id'],self.uid['jessie'])
        self.assertIn(str(self.uid['b']),change['participant_names'])

    def test_assistant_alone_never_sets_reviewer_or_money_permission(self):
        with Session(self.engine) as s:
            t=s.get(models.Task,self.tid);t.assignee_user_id=self.uid['a'];t.reviewer_user_id=None;s.commit()
        r=self.assign(assistant_user_id=self.uid['b'])
        self.assertEqual(r.status_code,200,r.text); self.assertIsNone(r.json()['reviewer'])
        b=self.login('b')
        self.assertEqual(b.patch(f'/api/projects/{self.pid}',json={'purchase_price':100}).status_code,403)

    def test_preplan_auto_join_retry_and_invalid_pair(self):
        body={'name':'Synthetic preplan','address':{'label':'12 Test St, LA, CA','street':'12 Test St','city':'Los Angeles','state':'CA','zip':'90001'},'request_key':str(uuid4()),'task_plan':[{'step_key':'view','assignee_user_id':self.uid['a2'],'assistant_user_id':self.uid['b']}], 'join_assignees':False}
        response=self.j.post('/api/projects',json=body)
        self.assertEqual(response.status_code,201,response.text)
        pid=response.json()['id'];plan=self.j.get(f'/api/projects/{pid}/tasks').json()['tasks']
        self.assertEqual(len(plan),31)
        row=next(t for t in plan if t['step_key']=='view')
        self.assertEqual((row['assignee']['id'],row['assistant']['id']),(self.uid['a2'],self.uid['b']))
        self.assertEqual(len(self.j.get(f'/api/projects/{pid}/members').json()['members']),3)
        before=self.counts()
        self.assertEqual(self.j.post('/api/projects',json=body).json()['id'],pid);self.assertEqual(self.counts(),before)
        bad={**body,'request_key':str(uuid4()),'task_plan':[{'step_key':'view','assistant_user_id':self.uid['a']}]}
        self.assertEqual(self.j.post('/api/projects',json=bad).status_code,400);self.assertEqual(self.counts(),before)
        for _ in range(2):
            self.j.get('/api/me/tasks');self.j.get('/api/me/workbench');self.j.get(self.url)
        self.assertEqual(self.counts(),before)

    def test_sensitive_file_and_procurement_are_not_granted_by_assisting(self):
        r=self.assign(assignee_user_id=self.uid['jessie'],assistant_user_id=self.uid['a2'])
        with Session(self.engine) as s:
            f=models.ProjectFile(project_id=self.pid,filename='loan.pdf',stored_path='synthetic-missing',mime='application/pdf',doc_type='loan_doc',uploaded_by='J')
            s.add(f);s.flush()
            sub=models.TaskSubmission(task_id=self.tid,project_id=self.pid,seq=1,submitted_by_user_id=self.uid['jessie'],note='Authorized delivery')
            s.add(sub);s.flush();s.add(models.SubmissionFile(submission_id=sub.id,file_id=f.id));s.commit();fid=f.id
        helper=self.login('a2')
        self.assertEqual(helper.get(f'/api/files/{fid}/download').status_code,403)
        self.assertEqual(helper.get(self.url).json()['submissions'][0]['files'],[])
        self.assertEqual(len(self.j.get(self.url).json()['submissions'][0]['files']),1)
        t=self.task(self.j,'purchase')
        r=self.j.post(f"/api/projects/{self.pid}/tasks/{t['id']}/assign",json={'version':t['version'],'assignee_user_id':self.uid['jessie'],'assistant_user_id':self.uid['a2']})
        self.assertEqual(r.status_code,200,r.text)
        result=helper.post(f'/api/projects/{self.pid}/purchase-orders/preview',json={'text':'Synthetic order'})
        self.assertEqual(result.status_code,403,result.text)

    def test_legacy_upgrade_preserves_rows_and_second_start_is_idempotent(self):
        with Session(self.engine) as s:
            t=s.get(models.Task,self.tid);t.assignee_user_id=self.uid['a'];t.wait_reason='Legacy wait';s.commit()
            original=(t.id,t.assignee_user_id,t.reviewer_user_id,t.created_at,t.version,t.wait_reason)
        with self.engine.begin() as c:
            ddl=c.scalar(text("SELECT sql FROM sqlite_master WHERE name='tasks'"))
            legacy='\n'.join(line for line in ddl.splitlines() if 'assistant_user_id' not in line)
            columns=','.join(col.name for col in models.Task.__table__.columns if col.name!='assistant_user_id')
            c.execute(text(f'CREATE TABLE legacy_tasks AS SELECT {columns} FROM tasks'))
            c.execute(text('DROP TABLE tasks'))
            c.execute(text(legacy))
            c.execute(text(f'INSERT INTO tasks ({columns}) SELECT {columns} FROM legacy_tasks'))
            c.execute(text('DROP TABLE legacy_tasks'))
            c.execute(text('DROP TABLE task_notes'))
        with patch.object(db,'engine',self.engine):
            db.init_db();db.init_db()
        with Session(self.engine) as s:
            t=s.get(models.Task,self.tid)
            self.assertEqual((t.id,t.assignee_user_id,t.reviewer_user_id,t.created_at,t.version,t.wait_reason),original)
            self.assertIsNone(t.assistant_user_id)
            self.assertEqual(s.scalar(select(func.count()).select_from(models.TaskNote)),0)
