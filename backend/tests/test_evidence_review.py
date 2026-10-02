"""Synthetic receipts, exact-version reviews, invalidation, permissions and concurrency."""
import json
import sqlite3
import unittest
from pathlib import Path
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from fastapi.testclient import TestClient
from sqlalchemy import select,func,create_engine,delete
from sqlalchemy.orm import Session
from app import models,db,evidence_review,task_activity
from app.auth import hash_password
from tests import test_task_evidence as fixture


class EvidenceReviewTests(unittest.TestCase):
    login=fixture.TaskEvidenceTests.login
    task=fixture.TaskEvidenceTests.task
    upload=fixture.TaskEvidenceTests.upload
    signals=fixture.TaskEvidenceTests.signals

    def setUp(self):
        fixture.TaskEvidenceTests.setUp(self)
        with Session(self.engine) as s:
            s.add(models.User(username='cody',display_name='Synthetic Cody',role_code='项目助理',password_hash=hash_password('synthetic-evidence-pass')))
            s.add(models.User(username='david',display_name='Synthetic David',role_code='D',password_hash=hash_password('synthetic-evidence-pass')))
            s.commit();task_activity.initialize(s)
        self.cody=self.login('cody')

    def mark(self,key='view',client=None,body=None):
        t=self.task(key)
        return (client or self.cody).post(f'/api/projects/1/tasks/{t["id"]}/evidence-review',json=body or self.body(t))

    def body(self,t):
        state=t['evidence_review'];return {'version':t['version'],'revision':state['revision'],'fingerprint':state['fingerprint'],'request_key':str(uuid4())}

    def feed(self,client=None,**params):
        r=(client or self.cody).get('/api/me/completed-tasks',params=params);self.assertEqual(r.status_code,200,r.text);return r.json()

    def count(self):
        return next(p['activity_count'] for p in self.cody.get('/api/me/workbench').json()['projects'] if p['project_id']==1)

    def test_evidence_met_requires_review_and_all_read_surfaces_share_current_completion(self):
        self.upload('photo','view',photo=True,client=self.site)
        t=self.task('view');self.assertEqual(t['exec_status'],'pending_review');self.assertTrue(t['satisfied']);self.assertTrue(t['actions']['mark_evidence'])
        phase=self.lead.get('/api/projects/1/steps').json()['current_stage']
        self.assertIn('view',[i['key'] for i in self.lead.get('/api/projects/1/steps').json()['next_up']])
        self.assertFalse(next(i for st in self.lead.get('/api/projects/1/steps').json()['stages'] for i in st['items'] if i['key']=='view')['done'])
        self.assertFalse(self.feed()['items'])
        r=self.mark();self.assertEqual(r.status_code,200,r.text)
        done=r.json();self.assertEqual(done['exec_status'],'done');self.assertIn('+00:00',done['done_at'])
        self.assertEqual(done['evidence_review']['receipt']['reviewer']['display_name'],'Synthetic Cody')
        step=next(i for st in self.lead.get('/api/projects/1/steps').json()['stages'] for i in st['items'] if i['key']=='view')
        self.assertTrue(step['done']);self.assertTrue(step['condition_met']);self.assertEqual(step['review_state'],'reviewed')
        self.assertEqual(phase,self.lead.get('/api/projects/1/steps').json()['current_stage'])
        self.assertNotIn('view',[i['key'] for i in self.lead.get('/api/projects/1/steps').json()['next_up']])
        self.assertEqual(self.task('view',client=self.site)['exec_status'],'done')
        self.assertEqual(self.feed()['items'][0]['task']['id'],t['id'])
        self.assertNotIn(t['id'],[r['id'] for r in self.cody.get('/api/me/tasks').json()['reviewing']])

    def test_replacement_invalidates_still_satisfied_evidence_once_and_notes_do_not(self):
        first=self.upload('photo','view',photo=True,client=self.site).json();self.assertEqual(self.mark().status_code,200)
        before=self.count();self.assertEqual(before,2)
        self.upload('photo','progress',photo=True)
        self.assertEqual(self.task('view')['exec_status'],'done');self.assertEqual(self.count(),before)
        t=self.task('view');self.site.post(f'/api/projects/1/tasks/{t["id"]}/notes',json={'request_key':str(uuid4()),'text':'Original untranslatable note'})
        self.assertEqual(self.task('view')['exec_status'],'done');self.assertEqual(self.count(),before)
        self.upload('photo','view',photo=True,client=self.site)
        t=self.task('view');self.assertTrue(t['satisfied']);self.assertEqual(t['evidence_review']['state'],'recheck');self.assertEqual(t['exec_status'],'pending_review');self.assertIsNotNone(t['evidence_review']['receipt']['invalidated_at'])
        self.assertFalse(self.feed()['items']);self.assertEqual(self.count(),before+1)
        self.assertEqual(self.mark().status_code,200)
        self.lead.delete(f'/api/files/{first["id"]}')
        self.assertEqual(self.task('view')['evidence_review']['state'],'recheck')
        with Session(self.engine) as s:
            receipts=s.scalars(select(models.TaskEvidenceReview).order_by(models.TaskEvidenceReview.id)).all()
            self.assertEqual(len(receipts),2);self.assertTrue(all(r.invalidated_at for r in receipts))

    def test_restoring_same_facts_does_not_resurrect_an_old_review(self):
        self.lead.patch('/api/projects/1',json={'risks':'Original risk'})
        self.assertEqual(self.mark('screen').status_code,200)
        old=self.task('screen')['evidence_review']['fingerprint']
        self.lead.patch('/api/projects/1',json={'risks':'Changed risk'})
        self.lead.patch('/api/projects/1',json={'risks':'Original risk'})
        t=self.task('screen');self.assertEqual(t['evidence_review']['fingerprint'],old);self.assertEqual(t['evidence_review']['state'],'recheck');self.assertNotEqual(t['exec_status'],'done')

    def test_helper_scope_financial_and_missing_evidence_cannot_be_bypassed(self):
        t=self.task('view');missing=self.mark('view',body=self.body(t));self.assertEqual(missing.status_code,409)
        self.upload('photo','view',photo=True,client=self.site)
        t=self.task('view');self.assertEqual(self.mark(client=self.site).status_code,403)
        # The same user as helper still gains no review permission.
        with Session(self.engine) as s:
            task=s.get(models.Task,t['id']);task.assistant_user_id=3;s.commit()
        self.assertEqual(self.mark(client=self.permit).status_code,403)
        self.assertEqual(self.permit.post(f'/api/projects/1/tasks/{t["id"]}/status',json={'version':t['version'],'action':'start'}).status_code,403)
        self.lead.patch('/api/projects/1',json={'purchase_price':200000})
        finance=self.task('price');self.assertFalse(self.task('price',client=self.cody)['actions']['mark_evidence']);self.assertIsNone(self.task('price',client=self.cody)['evidence_review']['facts'])
        self.assertEqual(self.mark('price',body=self.body(finance)).status_code,403)
        self.assertEqual(self.mark('price',client=self.lead).status_code,200)
        self.assertNotIn(finance['id'],[r['task']['id'] for r in self.feed()['items']])
        stranger=self.login('stranger');photo=self.upload('photo','view',photo=True).json()
        for path in ['/api/projects/1/steps','/api/projects/1/files',f'/api/files/{photo["id"]}/download']:
            self.assertEqual(stranger.get(path).status_code,403,path)
        self.assertEqual(stranger.get('/api/me/completed-tasks').json()['total'],0)
        self.assertEqual(stranger.post(f'/api/projects/1/tasks/{t["id"]}/evidence-review',json=self.body(self.task('view'))).status_code,403)

    def test_repeat_and_stale_versions_do_not_overwrite_and_old_ticks_are_blocked(self):
        self.upload('photo','view',photo=True,client=self.site);t=self.task('view');body=self.body(t)
        self.assertEqual(self.mark(body=body).status_code,200)
        count=self.count();self.assertEqual(self.mark(body=body).status_code,200);self.assertEqual(self.count(),count)
        other={**body,'request_key':str(uuid4())};self.assertEqual(self.mark(body=other).status_code,409)
        self.assertEqual(self.lead.post('/api/projects/1/steps/view',json={'done':True}).status_code,409)
        self.assertEqual(self.lead.post('/api/projects/1/steps/agent',json={'done':True}).status_code,409)
        self.upload('photo','view',photo=True,client=self.site)
        self.assertEqual(self.mark(body=body).status_code,409);self.assertNotEqual(self.task('view')['exec_status'],'done')

    def test_return_exits_current_feed_and_preserves_receipt_and_reason(self):
        self.upload('photo','view',photo=True,client=self.site);self.assertEqual(self.mark().status_code,200)
        t=self.task('view');path=f'/api/projects/1/tasks/{t["id"]}/evidence-review/reopen'
        self.assertEqual(self.cody.post(path,json={'version':t['version']}).status_code,400)
        returned=self.cody.post(path,json={'version':t['version'],'reason':'Original return reason'})
        self.assertEqual(returned.status_code,200,returned.text);self.assertFalse(self.feed()['items'])
        self.assertEqual(self.mark().status_code,200)
        with Session(self.engine) as s:
            old=s.scalar(select(models.TaskEvidenceReview).order_by(models.TaskEvidenceReview.id));self.assertEqual(old.invalidation_reason,'Original return reason')
            self.assertEqual(s.scalar(select(func.count()).select_from(models.TaskEvidenceReview)),2)

    def test_baseline_upgrade_is_idempotent_and_never_invents_today_events(self):
        with Session(self.engine) as s:
            p=s.get(models.Project,1);p.risks='Historical fact';s.commit()
            original={t.id:(t.exec_status,t.reviewer_user_id,t.assignee_user_id,t.assistant_user_id,t.version,t.created_at,t.updated_at) for t in s.scalars(select(models.Task))}
            before=s.scalar(select(func.count()).select_from(models.TaskEvent))
            report=evidence_review.initialize(s,dry_run=True);self.assertGreater(report['new_versions'],0);self.assertEqual(report['old_rows_changed'],0)
            applied=evidence_review.initialize(s);self.assertEqual(report,applied)
            self.assertEqual(evidence_review.initialize(s)['new_versions'],0)
            self.assertEqual(s.scalar(select(func.count()).select_from(models.TaskEvent)),before)
            self.assertEqual(s.scalar(select(func.count()).select_from(models.TaskEvidenceReview)),0)
            self.assertEqual(original,{t.id:(t.exec_status,t.reviewer_user_id,t.assignee_user_id,t.assistant_user_id,t.version,t.created_at,t.updated_at) for t in s.scalars(select(models.Task))})
            self.assertEqual(self.task('screen')['exec_status'],'pending_review')
        with Session(self.engine) as s:
            counts=[s.scalar(select(func.count()).select_from(model)) for model in [models.TaskEvent,models.TaskEvidenceVersion,models.TaskEvidenceReview,models.ProjectMember]]
        for _ in range(2):self.task('screen');self.feed();self.cody.get('/api/me/workbench')
        with Session(self.engine) as s:self.assertEqual(counts,[s.scalar(select(func.count()).select_from(model)) for model in [models.TaskEvent,models.TaskEvidenceVersion,models.TaskEvidenceReview,models.ProjectMember]])

    def test_concurrent_mark_claims_one_receipt_and_one_transition_then_retry_is_idempotent(self):
        self.upload('photo','view',photo=True,client=self.site);t=self.task('view');body=self.body(t)
        path=Path(self.tmp.name)/'reviews.db'
        raw=self.engine.raw_connection();target=sqlite3.connect(path);raw.driver_connection.backup(target);target.close();raw.close()
        engine=create_engine(f'sqlite:///{path}',connect_args={'check_same_thread':False,'timeout':20})
        def session_override():
            with Session(engine,autoflush=False,expire_on_commit=False) as s:yield s
        self.app.dependency_overrides[db.get_db]=session_override
        a,b=self.login('cody'),self.login('lead');barrier=Barrier(2)
        url=f'/api/projects/1/tasks/{t["id"]}/evidence-review'
        def mark(client):barrier.wait(timeout=10);return client.post(url,json=body)
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(mark,[a,b]))
            self.assertEqual(sorted(r.status_code for r in results),[200,409],[(r.status_code,r.text) for r in results])
            self.assertEqual(a.post(url,json=body).status_code,200)
            with Session(engine) as s:
                self.assertEqual(s.scalar(select(func.count()).select_from(models.TaskEvidenceReview)),1)
                self.assertEqual(s.scalar(select(func.count()).select_from(models.TaskWorkflowTransition).where(models.TaskWorkflowTransition.kind=='evidence_reviewed')),1)
        finally:engine.dispose()

    def test_completed_feed_includes_closed_projects_paginates_and_scopes_current_results(self):
        self.upload('photo','view',photo=True);self.assertEqual(self.mark().status_code,200)
        self.lead.patch('/api/projects/1',json={'risks':'Synthetic risk'})
        self.assertEqual(self.mark('screen').status_code,200)
        with Session(self.engine) as session:
            session.get(models.Project,1).sale_date='2026-09-30'
            session.commit()
        page=self.feed(limit=1);self.assertEqual(page['total'],2);self.assertIsNotNone(page['next_cursor'])
        next_page=self.feed(limit=1,until=page['until'],cursor=page['next_cursor'])
        self.assertEqual(next_page['total'],2);self.assertNotEqual(page['items'][0]['task']['id'],next_page['items'][0]['task']['id'])
        self.assertEqual(self.feed(search='Not this property')['total'],0)
        self.assertEqual(self.feed(stage_key='s3')['total'],0)
        self.assertEqual(self.feed(self.login('stranger'))['total'],0)
        task=self.task('view');self.cody.post(f'/api/projects/1/tasks/{task["id"]}/evidence-review/reopen',json={'version':task['version'],'reason':'Reopen original result'})
        self.assertEqual(self.feed()['total'],1)

    def test_dual_milestone_keeps_roles_partial_history_effective_count_and_conflict(self):
        task=self.task('offer');path=f'/api/projects/1/tasks/{task["id"]}/confirm'
        self.assertFalse(self.task('offer',client=self.cody)['actions']['confirm_node'])
        self.assertEqual(self.cody.post(path,json={'version':task['version'],'confirm_as':'D'}).status_code,403)
        before=self.count()
        first=self.lead.post(path,json={'version':task['version'],'confirm_as':'J'})
        self.assertEqual(first.status_code,200,first.text);self.assertEqual(self.count(),before)
        self.assertNotEqual(first.json()['exec_status'],'done')
        self.assertEqual(self.lead.post(path,json={'version':task['version'],'confirm_as':'D'}).status_code,403)
        david=self.login('david')
        self.assertEqual(david.post(path,json={'version':task['version'],'confirm_as':'D'}).status_code,409)
        second=david.post(path,json={'version':first.json()['version'],'confirm_as':'D'})
        self.assertEqual(second.status_code,200,second.text);self.assertEqual(second.json()['exec_status'],'done');self.assertEqual(self.count(),before+1)
        self.assertEqual(david.post(path,json={'version':second.json()['version'],'confirm_as':'D'}).status_code,200)
        self.assertEqual(self.count(),before+1)
        self.assertEqual(self.feed()['items'][0]['task']['id'],task['id'])
        cancelled=david.post('/api/projects/1/steps/offer',json={'done':False,'confirm_as':'D','version':second.json()['version']})
        self.assertEqual(cancelled.status_code,200,cancelled.text);self.assertFalse(self.feed()['items']);self.assertEqual(self.count(),before+1)
        with Session(self.engine) as session:
            kinds=list(session.scalars(select(models.TaskEvent.kind).where(models.TaskEvent.task_id==task['id'])))
            self.assertEqual(kinds.count('node_confirmed'),1);self.assertIn('node_partial_confirmed',kinds);self.assertIn('node_reopened',kinds)

    def test_utilities_get_is_pure_and_unrelated_account_details_preserve_review(self):
        with Session(self.engine) as session:before=session.scalar(select(func.count()).select_from(models.UtilityAccount))
        for _ in range(2):self.assertEqual(len(self.lead.get('/api/projects/1/utilities').json()),3)
        with Session(self.engine) as session:self.assertEqual(session.scalar(select(func.count()).select_from(models.UtilityAccount)),before)
        for kind in ('water','electric','gas'):
            self.assertEqual(self.lead.put(f'/api/projects/1/utilities/{kind}',json={'status':'on','company':'Synthetic provider'}).status_code,200)
        self.assertEqual(self.mark('utilities_on').status_code,200)
        count=self.count()
        self.lead.put('/api/projects/1/utilities/water',json={'status':'on','company':'Updated provider','blocker':'Unrelated original note'})
        self.assertEqual(self.task('utilities_on')['exec_status'],'done');self.assertEqual(self.count(),count)
        self.lead.put('/api/projects/1/utilities/water',json={'status':'pending'})
        self.assertEqual(self.task('utilities_on')['evidence_review']['state'],'recheck');self.assertEqual(self.count(),count+1)

    def test_historical_file_links_do_not_invent_the_facts_seen_by_a_reviewer(self):
        file=self.upload('photo','view',photo=True).json();task=self.task('view')
        with Session(self.engine) as session:
            row=session.get(models.Task,task['id']);row.exec_status='done'
            sub=models.TaskSubmission(task_id=row.id,project_id=1,seq=1,decision='confirmed',decided_by_user_id=1,decided_at='2026-09-30T13:00:00',note='Original review')
            session.add(sub);session.flush();session.add(models.SubmissionFile(submission_id=sub.id,file_id=file['id']));session.commit()
            session.execute(delete(models.TaskEvidenceVersion).where(models.TaskEvidenceVersion.task_id==row.id));session.commit()
            report=evidence_review.initialize(session)
            self.assertEqual(report['historical_reviews_verified'],0);self.assertEqual(report['historical_reviews_unverified'],1)
            self.assertEqual(session.get(models.TaskSubmission,sub.id).note,'Original review')
            self.assertEqual(session.get(models.TaskSubmission,sub.id).decided_at,'2026-09-30T13:00:00')
        self.assertEqual(self.task('view')['exec_status'],'pending_review');self.assertFalse(self.feed()['items'])
