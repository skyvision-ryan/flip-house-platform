"""A-01: independent field, actual identity history, project scope and legacy persistence."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
from unittest.mock import patch
from uuid import uuid4
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from app import db, models
from app.routers import projects, steps, common
from tests.test_tasks_assign import _TaskBase


class ProjectCompanyTests(_TaskBase):
    def setUp(self):
        super().setUp()
        self.app.include_router(projects.router);self.app.include_router(steps.router)
        self.j=self.login('jessie')
        self.company='Synthetic Holding LLC / Original'

    def create(self):
        r=self.j.post('/api/projects',json={'name':'Company fixture','holding_company':self.company,
             'address':{'label':'Company synthetic lane','street':'Company synthetic lane','city':'Los Angeles','state':'CA','zip':'90001'},
             'owner':{'name':'Public-record Owner'},'request_key':str(uuid4())})
        self.assertEqual(r.status_code,201,r.text)
        return r.json()

    def test_create_edit_history_owner_order_unchanged_and_relogin(self):
        p=self.create();pid=p['id']
        self.assertEqual(p['holding_company'],self.company)
        with Session(self.engine) as s:
            material=s.scalar(select(models.ProcurementItem.id).where(models.ProcurementItem.project_id==pid))
            original=json.dumps({'vendor':'Synthetic Vendor','order_number':'SYN-KEEP','ordered_on':'2026-10-01','purchasing_entity':'Order company original','total':'1','lines':[{'id':'line','material_id':material,'name':'Synthetic item','quantity':'1','unit_price':'1'}]})
            order=models.PurchaseOrder(project_id=pid,vendor_key='synthetic',number_key='syn-keep',request_key=str(uuid4()),fingerprint='fixture',document=original,created_by=self.uid['jessie'],updated_by=self.uid['jessie'])
            s.add(order);s.commit();oid=order.id
        changed=self.j.patch(f'/api/projects/{pid}',json={'holding_company':'Second company $123 / \u539f\u6587'})
        self.assertEqual(changed.status_code,200,changed.text)
        self.assertEqual(changed.json()['created_at'],p['created_at'])
        after=changed.json()['holding_company']
        self.assertEqual(self.login('jessie').get(f'/api/projects/{pid}').json()['holding_company'],after)
        with Session(self.engine) as s:
            self.assertEqual(s.get(models.PurchaseOrder,oid).document,original)
            self.assertEqual(s.get(models.PurchaseOrder,oid).version,1)
            self.assertEqual(s.get(models.Project,pid).property.owner.name,'Public-record Owner')
        events=self.j.get(f'/api/projects/{pid}/updates').json()
        ev=next(x for x in events if x['kind']=='project_company')
        self.assertEqual(ev['actor_user_id'],self.uid['jessie']);self.assertEqual(ev['actor_name'],'Jessie')
        self.assertEqual(ev['changes'],{'before':self.company,'after':after})
        self.assertEqual(self.j.patch(f'/api/projects/{pid}',json={'holding_company':' '}).json()['holding_company'],None)
        self.assertEqual(len([x for x in self.j.get(f'/api/projects/{pid}/updates').json() if x['kind']=='project_company']),3)
        self.assertEqual(self.j.patch(f'/api/projects/{pid}',json={'holding_company':'x'*301}).status_code,422)

    def test_project_read_scope_history_and_edit_role(self):
        p=self.create();pid=p['id'];outsider=self.login('a2');member=self.login('a')
        with patch.object(common,'DEMO_MODE',False):
            self.assertEqual(outsider.get('/api/projects').json(),[])
            self.assertEqual(outsider.get('/api/updates').json(),[])
            self.assertEqual(outsider.get(f'/api/projects/{pid}').status_code,403)
            self.assertEqual(outsider.get(f'/api/projects/{pid}/updates').status_code,403)
            self.assertEqual(outsider.patch(f'/api/projects/{pid}',json={'holding_company':'intruder'}).status_code,403)
            self.assertEqual(member.get(f'/api/projects/{self.pid}').status_code,200)
            self.assertEqual(member.patch(f'/api/projects/{self.pid}',json={'holding_company':'not allowed'}).status_code,403)
        self.assertIsNone(self.j.get(f'/api/projects/{self.pid}').json()['holding_company'])

    def test_old_schema_adds_null_without_guessing_and_is_idempotent(self):
        with Session(self.engine) as s:
            p=s.get(models.Project,self.pid);p.property.owner=models.Owner(name='Not a holding company')
            s.add(models.ProjectUpdate(project_id=self.pid,actor='J',kind='project',text='Original history'));s.commit();created=p.created_at
        with self.engine.begin() as c:
            c.execute(text('ALTER TABLE projects DROP COLUMN holding_company'))
            ddl=c.scalar(text("SELECT sql FROM sqlite_master WHERE name='project_updates'"))
            legacy='\n'.join(line for line in ddl.splitlines() if 'actor_user_id' not in line and 'changes_json' not in line)
            # Removing the last foreign key may leave a trailing comma.
            legacy=legacy.replace(', \n)', '\n)').replace(',\n)', '\n)')
            columns='id,project_id,actor,kind,text,created_at'
            c.execute(text(f'CREATE TABLE legacy_updates AS SELECT {columns} FROM project_updates'))
            c.execute(text('DROP TABLE project_updates'));c.execute(text(legacy))
            c.execute(text(f'INSERT INTO project_updates ({columns}) SELECT {columns} FROM legacy_updates'));c.execute(text('DROP TABLE legacy_updates'))
        with patch.object(db,'engine',self.engine):db.init_db();db.init_db()
        with Session(self.engine) as s:
            self.assertIsNone(s.get(models.Project,self.pid).holding_company)
            self.assertEqual(s.get(models.Project,self.pid).created_at,created)
            old=s.scalar(select(models.ProjectUpdate));self.assertEqual(old.text,'Original history');self.assertIsNone(old.actor_user_id)

    def test_new_process_startup_retains_company(self):
        p=self.create()
        with tempfile.TemporaryDirectory(prefix='company-restart-') as folder:
            with self.engine.connect() as source, sqlite3.connect(str(Path(folder)/'app.db')) as dest:
                source.connection.driver_connection.backup(dest)
            code='''from fastapi.testclient import TestClient
from app.main import app
with TestClient(app) as c:
 r=c.post('/api/auth/login',json={'username':'jessie','password':'Task-fixture-only-73!'})
 assert r.status_code==200,r.text
 p=c.get('/api/projects/PROJECT_ID')
 assert p.status_code==200,p.text
 print(p.json()['holding_company'])
'''.replace('PROJECT_ID',str(p['id']))
            env={**os.environ,'DATA_DIR':folder,'DB_URL':f'sqlite:///{folder}/app.db','SEED_DEMO':'0','DEMO_MODE':'0','COOKIE_SECURE':'0','SECRET_KEY':'synthetic-company-restart'}
            for _ in range(2):
                r=subprocess.run([sys.executable,'-c',code],cwd=Path(__file__).resolve().parents[1],env=env,capture_output=True,text=True)
                self.assertEqual(r.returncode,0,r.stdout+r.stderr);self.assertIn(self.company,r.stdout)
