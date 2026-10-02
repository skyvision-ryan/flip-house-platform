"""A-28: LA date boundaries, stable ordering, scoped counts and read-only queries."""
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app import models
from app.project_dates import creation_instant, is_new_today, prioritize_new, created_now
from app.routers import projects, dashboard, common
from tests.test_tasks_assign import _TaskBase


class ProjectDateTests(TestCase):
    def test_la_midnight_dst_and_legacy_unknown(self):
        before = datetime.fromisoformat('2026-10-02T06:59:59+00:00')
        after = datetime.fromisoformat('2026-10-02T07:00:00+00:00')
        self.assertTrue(is_new_today('2026-10-01T23:59:59-07:00', before))
        self.assertFalse(is_new_today('2026-10-01T23:59:59-07:00', after))
        self.assertTrue(is_new_today('2026-10-02T00:00:00-07:00', after))
        # Both occurrences of the repeated fall-back hour belong to the same LA day.
        for value in ['2026-11-01T01:30:00-07:00', '2026-11-01T01:30:00-08:00']:
            self.assertTrue(is_new_today(value, datetime.fromisoformat('2026-11-01T20:00:00+00:00')))
        for value in [None, '', 'bad', '2026-10-02T07:00:00', '2026-10-02']:
            self.assertIsNone(creation_instant(value)); self.assertFalse(is_new_today(value, after))
        self.assertIsNotNone(creation_instant(created_now()))

    def test_same_instant_id_desc_and_old_order_preserved(self):
        rows = [SimpleNamespace(id=i, created_at=t) for i,t in [(1,'2026-09-01T07:00:00Z'),(2,'2026-10-02T00:00:00-07:00'),(3,'2026-10-02T07:00:00Z'),(4,'2026-09-02T07:00:00Z')]]
        self.assertEqual([p.id for p in prioritize_new(rows, datetime.fromisoformat('2026-10-02T08:00:00Z'))], [3,2,1,4])


class NewTodayApiTests(_TaskBase):
    def setUp(self):
        super().setUp()
        self.app.include_router(projects.router); self.app.include_router(dashboard.router)
        self.j = self.login('jessie')
        self.now = created_now()
        with Session(self.engine) as s:
            s.get(models.Project,self.pid).created_at = '2026-01-01T00:00:00Z'
            for i in range(100):
                prop=models.Property(address_std=f'Synthetic old address {i}')
                s.add(prop);s.flush()
                s.add(models.Project(property_id=prop.id,name=f'Old {i}',created_at='2026-01-01T00:00:00Z',updated_at='9999-01-01T00:00:00'))
            s.flush()
            self.fresh=[]
            for i in range(2):
                prop=models.Property(address_std=f'Synthetic new address {i}')
                s.add(prop);s.flush()
                p=models.Project(property_id=prop.id,name=f'Fresh {i}',created_at=self.now,updated_at='2000-01-01T00:00:00')
                s.add(p);s.flush();self.fresh.append(p.id)
            s.commit()

    def snapshot(self):
        with Session(self.engine) as s:
            return tuple(s.scalar(select(func.count()).select_from(t)) for t in [models.ProjectMember, models.Task, models.TaskEvent, models.ProjectUpdate])

    def test_100_projects_today_first_queries_and_no_get_writes(self):
        before=self.snapshot()
        rows=self.j.get('/api/projects').json()
        self.assertEqual(len(rows),103)
        self.assertEqual([p['id'] for p in rows[:2]],self.fresh[::-1])
        self.assertEqual([p['id'] for p in self.j.get('/api/projects?new_today=true').json()],self.fresh[::-1])
        self.assertEqual(self.j.get('/api/projects?new_today=true&q=Old').json(),[])
        self.assertEqual(len(self.j.get('/api/projects?new_today=true&stage=lead').json()),2)
        self.assertEqual(self.j.get('/api/projects?new_today=true&stage=portfolio').json(),[])
        wb=self.j.get('/api/me/workbench').json()
        self.assertEqual([p['project_id'] for p in wb['projects'][:2]],self.fresh[::-1])
        filtered=self.j.get('/api/me/workbench?new_today=true').json()
        self.assertEqual(filtered['counts']['projects'],2)
        self.assertTrue(all(p['created_today'] for p in filtered['projects']))
        self.assertEqual(self.snapshot(),before)
        # Editing an old project's company cannot change its creation instant or badge.
        changed=self.j.patch(f'/api/projects/{self.pid}',json={'holding_company':'Old house new company'})
        self.assertEqual(changed.status_code,200,changed.text)
        self.assertFalse(changed.json()['created_today'])
        self.assertEqual(changed.json()['created_at'],'2026-01-01T00:00:00Z')

    def test_membership_scope_filters_and_counts_never_expose_hidden_projects(self):
        a=self.login('a'); outsider=self.login('a2')
        with patch.object(common,'DEMO_MODE',False):
            for client, total in [(a,1),(outsider,0)]:
                self.assertEqual(len(client.get('/api/projects').json()),total)
                self.assertEqual(client.get('/api/projects?new_today=true').json(),[])
                self.assertEqual(client.get('/api/me/workbench?new_today=true').json()['counts']['projects'],0)
                self.assertEqual(client.get('/api/dashboard/summary').json()['total'],total)
                widgets=client.get('/api/dashboard/widgets').json()
                self.assertEqual(sum(row['count'] for row in widgets['funnel']),total)
                self.assertNotIn('Fresh',str(client.get('/api/dashboard/role').json()))
                self.assertEqual(client.get(f'/api/projects/{self.fresh[0]}').status_code,403)
