"""Evidence ports, automatic task display, transactional signals and unchanged gates."""
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app import db, models
from app.auth import hash_password
from app.dictionaries import STAGE_CHECKLIST
from app.routers import auth, files, ops, projects, steps, tasks, analyses
from app.task_evidence import capture_evidence, commit_evidence, completion_mode

class TaskEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
        self.addCleanup(self.engine.dispose); db.Base.metadata.create_all(self.engine)
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        uploads=patch('app.routers.files.UPLOAD_DIR',Path(self.tmp.name));uploads.start();self.addCleanup(uploads.stop)
        with Session(self.engine) as s:
            for name, role in [('lead','J'),('site','L'),('permit','Permit/设计'),('stranger','Permit/设计')]:
                s.add(models.User(username=name,display_name=name,role_code=role,password_hash=hash_password('synthetic-evidence-pass')))
            s.flush()
            for n in range(2):
                prop=models.Property(address_std=f'{n} Synthetic Evidence Avenue');s.add(prop);s.flush()
                p=models.Project(name=prop.address_std,property_id=prop.id,stage='lead');s.add(p);s.flush();tasks.ensure_tasks(s,p.id)
            for uid in [1,2,3]: tasks.ensure_member(s,1,s.get(models.User,uid),None)
            for task in s.scalars(select(models.Task).where(models.Task.project_id==1)):
                task.assignee_user_id=3 if task.step_key in ['permit_apply','permit_issued'] else 2 if task.step_key=='view' else 1
            s.commit()
        app=FastAPI()
        for module in [auth,files,ops,projects,steps,tasks,analyses]:app.include_router(module.router)
        def session_override():
            with Session(self.engine,expire_on_commit=False,autoflush=False) as s:yield s
        app.dependency_overrides[db.get_db]=session_override
        self.app=app;self.lead=self.login('lead');self.site=self.login('site');self.permit=self.login('permit')

    def login(self,name):
        c=TestClient(self.app);self.addCleanup(c.close)
        self.assertEqual(c.post('/api/auth/login',json={'username':name,'password':'synthetic-evidence-pass'}).status_code,200)
        return c

    def task(self,key,pid=1,client=None):
        rows=(client or self.lead).get(f'/api/projects/{pid}/tasks').json()['tasks']
        return next(t for t in rows if t['step_key']==key)

    def upload(self,kind,step=None,pid=1,photo=False,client=None,content=None):
        data={'doc_type':kind}
        if step:data['step_key']=step
        if photo:
            stream=io.BytesIO();Image.new('RGB',(12,12)).save(stream,format='PNG');blob=stream.getvalue()
        else:blob=b'SYNTHETIC document'
        return (client or self.lead).post(f'/api/projects/{pid}/files',data=data,files={'file':('synthetic.png' if photo else 'synthetic.txt',content if content is not None else blob,'image/png' if photo else 'text/plain')})

    def signals(self,client=None):return (client or self.lead).get('/api/me/tasks').json()['signals']

    def test_all_template_rules_are_explicit_and_procurement_and_gates_excluded(self):
        with Session(self.engine) as s:
            rows=s.scalars(select(models.Task).where(models.Task.project_id==1)).all()
            modes={t.step_key:completion_mode(t) for t in rows}
        ordinary=[i for stage in STAGE_CHECKLIST for i in stage['items'] if not i.get('gate') and i['key']!='purchase']
        self.assertEqual(len(ordinary),23)
        self.assertEqual(sum(m=='record' for m in modes.values()),4)
        self.assertTrue(all(modes[i['key']] in {'record','evidence','review'} for i in ordinary))
        self.assertEqual(modes['purchase'],'review');self.assertEqual(modes['open_escrow'],'review')

    def test_risk_is_recorded_not_resolved_no_reviewer_and_loss_notifies_once(self):
        t=self.task('screen');self.assertFalse(t['satisfied']);self.assertIsNone(t['reviewer'])
        self.assertEqual(self.lead.patch('/api/projects/1',json={'risks':'   '}).status_code,200)
        self.assertFalse(self.task('screen')['satisfied']);self.assertEqual(self.signals(),[])
        res=self.lead.patch('/api/projects/1',json={'risks':'Synthetic unresolved foundation risk'})
        self.assertEqual(res.status_code,200,res.text)
        t=self.task('screen');self.assertEqual(t['exec_status'],'pending_review');self.assertIsNone(t['done_at'])
        self.assertEqual(self.signals()[0]['kind'],'evidence_satisfied')
        count=len(self.signals())
        self.lead.patch('/api/projects/1',json={'risks':'Synthetic unresolved foundation risk'})
        self.assertEqual(len(self.signals()),count)
        self.lead.patch('/api/projects/1',json={'risks':None})
        self.assertEqual(self.task('screen')['exec_status'],'not_started')
        self.assertEqual(self.signals()[0]['kind'],'evidence_missing')
        self.assertEqual(self.lead.post(f'/api/projects/1/tasks/{t["id"]}/submit',json={'version':t['version'],'note':'pretend done','file_ids':[]}).status_code,409)

    def test_site_visit_requires_real_image_linked_to_the_correct_project_and_task(self):
        self.assertEqual(self.upload('photo','view',photo=True,content=b'not a real image',client=self.site).status_code,422)
        self.assertEqual(self.upload('photo','view',photo=False,client=self.site).status_code,422)
        self.assertEqual(self.upload('photo','progress',photo=True).status_code,201)
        self.assertFalse(self.task('view')['satisfied'])
        self.upload('photo','view',pid=2,photo=True)
        self.assertFalse(self.task('view')['satisfied'])
        res=self.upload('photo','view',photo=True,client=self.site);self.assertEqual(res.status_code,201,res.text)
        self.assertEqual(self.task('view')['exec_status'],'pending_review')
        self.assertEqual(self.task('progress')['completion_mode'],'record')
        self.assertEqual(self.task('progress')['exec_status'],'in_progress')
        self.lead.delete(f'/api/files/{res.json()["id"]}')
        self.assertFalse(self.task('view')['satisfied'])

    def test_permit_application_is_not_issued_and_home_inspection_is_not_city_final(self):
        res=self.upload('permit_application','permit_apply',client=self.permit);self.assertEqual(res.status_code,201,res.text)
        self.assertEqual(self.task('permit_apply')['exec_status'],'pending_review')
        self.assertFalse(self.task('permit_issued')['satisfied'])
        self.upload('inspection')
        self.assertTrue(self.task('home_inspection')['satisfied']);self.assertFalse(self.task('final')['satisfied'])
        self.upload('permit','permit_issued',client=self.permit)
        self.assertTrue(self.task('permit_issued')['satisfied']);self.assertFalse(self.task('start')['satisfied'])
        before=self.task('permit_issued')['submissions']
        t=self.task('permit_issued')
        res=self.lead.post(f'/api/projects/1/tasks/{t["id"]}/confirm',json={'version':t['version']})
        self.assertEqual(res.status_code,409);self.assertEqual(self.task('permit_issued')['submissions'],before)

    def test_heic_photo_is_accepted_without_rewriting_original_bytes(self):
        stream=io.BytesIO();Image.new('RGB',(12,12)).save(stream,format='HEIF')
        original=stream.getvalue()
        res=self.site.post('/api/projects/1/files',data={'doc_type':'photo','step_key':'view'},
            files={'file':('synthetic.heic',original,'application/octet-stream')})
        self.assertEqual(res.status_code,201,res.text)
        self.assertTrue(self.task('view')['satisfied'])
        downloaded=self.site.get(f'/api/files/{res.json()["id"]}/download')
        self.assertEqual(downloaded.content,original)

    def test_each_file_port_distinguishes_template_document_types(self):
        rows=[item for st in STAGE_CHECKLIST for item in st['items'] if not item.get('gate') and item['evidence'].startswith('file:')]
        for item in rows:
            with self.subTest(step=item['key']):
                kind=item['evidence'].split(':')[1]
                self.assertFalse(self.task(item['key'])['satisfied'])
                res=self.upload(kind,item['key']);self.assertEqual(res.status_code,201,res.text)
                self.assertEqual(self.task(item['key'])['exec_status'],'pending_review')
                self.lead.delete(f'/api/files/{res.json()["id"]}')
                self.assertFalse(self.task(item['key'])['satisfied'])

    def test_utilities_need_all_three_accounts_and_inspections_require_passed(self):
        for kind in ['water','electric']:
            res=self.lead.put(f'/api/projects/1/utilities/{kind}',json={'status':'on'})
            self.assertEqual(res.status_code,200,res.text)
        self.assertFalse(self.task('utilities_on')['satisfied'])
        self.lead.put('/api/projects/1/utilities/gas',json={'status':'on'})
        self.assertTrue(self.task('utilities_on')['satisfied']);self.assertFalse(self.task('services_off')['satisfied'])
        for kind in ['water','electric','gas']:self.lead.put(f'/api/projects/1/utilities/{kind}',json={'status':'off'})
        self.assertTrue(self.task('services_off')['satisfied'])
        response=self.permit.post('/api/projects/1/inspections',json={'name':'Synthetic rough inspection','result':'failed','is_final':False})
        self.assertEqual(response.status_code,201,response.text);self.assertFalse(self.task('inspections')['satisfied'])
        self.permit.patch(f'/api/inspections/{response.json()[0]["id"]}',json={'result':'passed'})
        self.assertTrue(self.task('inspections')['satisfied']);self.assertFalse(self.task('final')['satisfied'])

    def test_signals_scope_next_assignment_and_reads_do_not_write(self):
        self.lead.patch('/api/projects/1',json={'risks':'Synthetic recorded risk'})
        signal=self.signals()[0];self.assertEqual(signal['project_id'],1)
        self.assertIsNotNone(signal['next']['assignee']);self.assertNotEqual(signal['next']['title'],'房屋采购')
        stranger=self.login('stranger');self.assertEqual(self.signals(stranger),[])
        self.assertEqual(stranger.get('/api/me/workbench').json()['recent_handoffs'],[])
        handoff=self.lead.get('/api/me/workbench').json()['recent_handoffs'][0]
        self.assertEqual(handoff['task_display']['template_key'],self.task('screen')['template_key'])
        with Session(self.engine) as s:
            before=s.scalar(select(func.count()).select_from(models.TaskEvent))
            rows=[(t.id,t.updated_at,t.reviewer_user_id) for t in s.scalars(select(models.Task))]
        self.signals();self.task('screen');self.signals()
        with Session(self.engine) as s:
            self.assertEqual(s.scalar(select(func.count()).select_from(models.TaskEvent)),before)
            self.assertEqual(rows,[(t.id,t.updated_at,t.reviewer_user_id) for t in s.scalars(select(models.Task))])

    def test_failed_evidence_transaction_rolls_back_facts_state_and_events(self):
        with Session(self.engine) as s:
            before=capture_evidence(s,1);p=s.get(models.Project,1);p.risks='must roll back'
            with patch.object(s,'commit',side_effect=RuntimeError('synthetic failure')):
                with self.assertRaises(RuntimeError):commit_evidence(s,1,before,'J')
            s.rollback()
        self.assertFalse(self.task('screen')['satisfied']);self.assertEqual(self.signals(),[])

    def test_price_analysis_manual_choice_and_legacy_audit_are_not_mixed(self):
        response=self.lead.patch('/api/projects/1',json={'purchase_price':321000})
        self.assertEqual(response.status_code,200,response.text);self.assertEqual(self.task('price')['exec_status'],'pending_review')
        self.assertFalse(self.task('analysis')['satisfied'])
        response=self.lead.post('/api/projects/1/analyses',json={})
        self.assertEqual(response.status_code,201,response.text);self.assertTrue(self.task('analysis')['satisfied'])
        self.lead.delete(f'/api/analyses/{response.json()["id"]}')
        self.assertFalse(self.task('analysis')['satisfied'])
        response=self.lead.post('/api/projects/1/steps/agent',json={'done':True})
        self.assertEqual(response.status_code,409,response.text);self.assertFalse(self.task('agent')['satisfied'])
        # A historical review must not be erased or treated as present-day evidence.
        with Session(self.engine) as s:
            t=s.scalar(select(models.Task).where(models.Task.project_id==1,models.Task.step_key=='screen'))
            t.exec_status='done';t.done_at='2025-01-02T12:00:00';t.reviewer_user_id=1
            s.add(models.TaskSubmission(task_id=t.id,project_id=1,seq=1,decision='confirmed',note='Legacy original',decided_by_user_id=1))
            s.commit();tid=t.id;stamp=t.updated_at
        response=self.task('screen');self.assertEqual(response['exec_status'],'not_started')
        self.assertEqual(response['submissions'][0]['note'],'Legacy original')
        with Session(self.engine) as s:
            t=s.get(models.Task,tid);self.assertEqual((t.exec_status,t.done_at,t.reviewer_user_id,t.updated_at),('done','2025-01-02T12:00:00',1,stamp))

    def test_competing_evidence_writes_emit_one_signal_and_survive_reopening(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        import sqlite3
        path=Path(self.tmp.name)/'concurrent.db'
        raw=self.engine.raw_connection()
        target=sqlite3.connect(path);raw.driver_connection.backup(target);target.close();raw.close()
        engine=create_engine(f'sqlite:///{path}',connect_args={'check_same_thread':False})
        barrier=Barrier(2)
        def save(note):
            with Session(engine,autoflush=False) as s:
                before=capture_evidence(s,1);barrier.wait(timeout=10)
                s.get(models.Project,1).risks=note
                commit_evidence(s,1,before,'J')
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(save,['Synthetic A','Synthetic B']))
        finally:engine.dispose()
        reopened=create_engine(f'sqlite:///{path}')
        try:
            with Session(reopened) as s:
                self.assertIn(s.get(models.Project,1).risks,{'Synthetic A','Synthetic B'})
                events=s.scalars(select(models.TaskEvent).where(models.TaskEvent.kind=='evidence_satisfied')).all()
                self.assertEqual(len(events),1)
                self.assertTrue(s.get(models.TaskEvidenceVersion,events[0].task_id).met)
        finally:reopened.dispose()
