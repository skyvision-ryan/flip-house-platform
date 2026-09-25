"""Purchase item lifecycle, account/project boundaries and private image storage."""
from datetime import date
from io import BytesIO
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import db, models
from app.auth import hash_password
from app.routers import auth, budget, common, procurement


class ProcurementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='purchase-tests-')
        self.addCleanup(self.temp.cleanup)
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        self.addCleanup(self.engine.dispose)
        db.Base.metadata.create_all(self.engine)
        self.ids = {}
        with Session(self.engine) as session:
            prop = models.Property(address_std='100 Synthetic Test Road')
            session.add(prop); session.flush()
            project = models.Project(property_id=prop.id, name='Synthetic test house')
            session.add(project); session.flush(); self.pid = project.id
            for name, role in [('buyer1', '采购'), ('buyer2', '采购'), ('outsider', '采购'), ('assistant', '项目助理'), ('finance', '财务'), ('planner', 'J'), ('director', 'D'), ('admin', '负责人')]:
                user = models.User(username=name, email=f'{name}@example.com', display_name=name, role_code=role,
                                   is_admin=name=='admin', password_hash=hash_password('Procurement-fixture-47!'))
                session.add(user); session.flush(); self.ids[name] = user.id
                if name != 'outsider':
                    session.add(models.ProjectMember(project_id=self.pid, user_id=user.id, role_snapshot=role))
            item = models.ProcurementItem(project_id=self.pid, wave='long_lead', name='Synthetic sink')
            session.add(item); session.commit(); self.item = item.id
        app = FastAPI()
        for router in (auth, procurement, budget): app.include_router(router.router)
        def isolated():
            with Session(self.engine, expire_on_commit=False) as session: yield session
        app.dependency_overrides[db.get_db] = isolated
        self.addCleanup(patch.stopall)
        patch.object(common, 'DEMO_MODE', False).start()
        patch.object(procurement, 'UPLOAD_DIR', Path(self.temp.name)).start()
        self.clients = {}
        for name in self.ids:
            client = TestClient(app); self.addCleanup(client.close)
            self.assertEqual(client.post('/api/auth/login', json={'email': f'{name}@example.com', 'password': 'Procurement-fixture-47!'}).status_code, 200)
            self.clients[name] = client
        self.anon = TestClient(app); self.addCleanup(self.anon.close)

    def rows(self, user='buyer1'):
        result = self.clients[user].get(f'/api/projects/{self.pid}/procurement')
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()['items']

    def update(self, body, user='buyer1', expected=200):
        result = self.clients[user].patch(f'/api/procurement/{self.item}', json=body)
        self.assertEqual(result.status_code, expected, result.text)
        return result

    def test_both_buyers_share_fields_but_keep_actual_updater_and_financial_scope(self):
        before = self.rows()[0]
        values = {'note': 'Confirm site dimensions', 'ordered_on': '2026-09-22', 'expected_on': '2026-09-27',
                  'delivery_type': 'project', 'amount': 239.95, 'quantity': 2, 'specification': '30 inch',
                  'product_url': 'https://example.com/sink', 'status': 'ordered', 'expected_updated_at': before['updated_at']}
        self.update(values)
        item = self.rows('buyer2')[0]
        self.assertEqual(item['updated_by_user_id'], self.ids['buyer1'])
        self.assertEqual(item['delivery_address'], '100 Synthetic Test Road')
        self.update({'delivery_address': 'Spoofed project address'})
        self.assertEqual(self.rows()[0]['delivery_address'], '100 Synthetic Test Road')
        item = self.rows('buyer2')[0]
        self.assertEqual(item['amount'], 239.95)
        self.assertIsNone(item['received_on'])
        self.update({'note': 'Vendor called back', 'expected_updated_at': item['updated_at']}, 'buyer2')
        after = self.rows()[0]
        self.assertEqual(after['updated_by_user_id'], self.ids['buyer2'])
        for key in ('ordered_on', 'expected_on', 'amount', 'quantity', 'delivery_address'):
            self.assertEqual(after[key], item[key])
        with Session(self.engine) as session:
            self.assertEqual(session.query(models.Expense).count(), 0)
        for who in ('buyer1', 'buyer2'):
            self.assertEqual(self.clients[who].get(f'/api/projects/{self.pid}/budget-summary').status_code, 403)

    def test_tracking_uses_member_scope_and_manual_check_keeps_business_dates(self):
        self.update({'status': 'ordered', 'retailer': 'Amazon', 'order_number': 'DEMO-001',
                     'order_url': 'https://example.com/order', 'tracking_url': 'https://example.com/tracking',
                     'carrier': 'Synthetic carrier', 'tracking_number': 'DEMO-TRACK', 'shipment_status': 'delivered',
                     'follow_up': 'Verify delivery at site', 'expected_on': '2026-09-28'})
        # Shipping-site delivery never marks on-site receipt or the procurement status.
        row = self.rows()[0]
        self.assertEqual(row['status'], 'ordered'); self.assertIsNone(row['received_on']); self.assertIsNone(row['checked_at'])
        self.update({'mark_checked': True, 'expected_updated_at': row['updated_at']}, 'buyer2')
        after = self.rows()[0]
        self.assertIsNotNone(after['checked_at']); self.assertEqual(after['checked_by_user_id'], self.ids['buyer2'])
        self.assertEqual(after['expected_on'], '2026-09-28'); self.assertIsNone(after['received_on'])
        for who in ('buyer1', 'buyer2', 'planner', 'director', 'admin'):
            response = self.clients[who].get('/api/me/procurement-tracking')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['source'], 'manual')
            self.assertEqual([item['id'] for item in response.json()['items']], [self.item])
            self.assertEqual(response.json()['items'][0]['project_name'], 'Synthetic test house')
        self.assertEqual(self.clients['outsider'].get('/api/me/procurement-tracking').json()['items'], [])
        self.assertEqual(self.clients['outsider'].get('/api/me/procurement-tracking').json()['projects'], [])
        project = self.clients['buyer1'].get('/api/me/procurement-tracking').json()['projects'][0]
        self.assertEqual(project, {'id': self.pid, 'name': 'Synthetic test house', 'address': '100 Synthetic Test Road'})
        for who in ('assistant', 'finance'):
            self.assertEqual(self.clients[who].get('/api/me/procurement-tracking').status_code, 403)
        self.assertEqual(self.anon.get('/api/me/procurement-tracking').status_code, 401)
        self.update({'tracking_url': 'javascript:alert(1)'}, expected=422)
        self.update({'shipment_status': 'fake'}, expected=422)

    def test_zero_clearing_and_address_type_changes(self):
        self.update({'amount': 0, 'note': 'free sample', 'delivery_type': 'custom', 'delivery_address': 'Synthetic warehouse'})
        self.assertEqual(self.rows()[0]['amount'], 0)
        self.update({'amount': None, 'note': None, 'delivery_type': 'company'})
        row = self.rows()[0]
        self.assertIsNone(row['amount']); self.assertIsNone(row['note']); self.assertIsNone(row['delivery_address'])
        self.update({'delivery_type': 'custom'}, expected=422)
        self.update({'delivery_type': None})
        self.assertIsNone(self.rows()[0]['delivery_address'])

    def test_bad_values_leave_data_unchanged(self):
        for body in ({'amount': -1}, {'amount': 1.999}, {'quantity': 0}, {'ordered_on': '2026-02-30'},
                     {'ordered_on': '2026-09-25', 'expected_on': '2026-09-22'},
                     {'ordered_on': '2026-09-25', 'received_on': '2026-09-22'},
                     {'product_url': 'javascript:alert(1)'}, {'delivery_type': 'unknown'}, {'name': '  '}):
            self.update(body, expected=422)
        self.update({'status': None}, expected=400)
        row = self.rows()[0]
        self.assertIsNone(row['amount']); self.assertIsNone(row['ordered_on'])

    def test_stale_save_does_not_overwrite_colleague(self):
        revision = self.rows()[0]['updated_at']
        self.update({'note': 'First buyer', 'expected_updated_at': revision})
        self.update({'note': 'Stale second buyer', 'expected_updated_at': revision}, 'buyer2', expected=409)
        self.assertEqual(self.rows()[0]['note'], 'First buyer')

    def test_membership_role_and_anonymous_boundaries(self):
        for who in ('outsider', 'assistant', 'finance'):
            client = self.clients[who]
            self.assertEqual(client.get(f'/api/projects/{self.pid}/procurement').status_code, 403)
            self.assertEqual(client.patch(f'/api/procurement/{self.item}', json={'note': 'denied'}).status_code, 403)
            self.assertEqual(client.post(f'/api/projects/{self.pid}/procurement/init').status_code, 403)
            self.assertEqual(client.post(f'/api/projects/{self.pid}/procurement', json={'name': 'Denied'}).status_code, 403)
        for who in ('planner', 'director', 'admin'): self.rows(who)
        self.assertEqual(self.anon.get(f'/api/projects/{self.pid}/procurement').status_code, 401)
        self.assertEqual(self.anon.patch(f'/api/procurement/{self.item}', json={'note': 'denied'}).status_code, 401)
        with Session(self.engine) as session:
            member = session.scalar(select(models.ProjectMember).where(models.ProjectMember.user_id == self.ids['buyer2']))
            member.active = False; session.commit()
        self.assertEqual(self.clients['buyer2'].get(f'/api/projects/{self.pid}/procurement').status_code, 403)

    def test_create_recommendation_and_status_never_infer_actual_dates(self):
        result = self.clients['buyer1'].post(f'/api/projects/{self.pid}/procurement', json={'name': 'Another material', 'wave': 'other', 'expected_on': '2026-10-01'})
        self.assertEqual(result.status_code, 201, result.text)
        new = next(item for item in result.json()['items'] if item['id'] == result.json()['created_item_id'])
        self.assertEqual(new['status'], 'pending_spec')
        with Session(self.engine) as session:
            self.assertEqual(session.query(models.Task).count(), 0)
        self.assertIsNone(new['received_on']); self.assertIsNone(new['ordered_on'])
        self.update({'status': 'received'})
        self.assertIsNone(self.rows()[0]['received_on'])
        first = self.clients['buyer1'].post(f'/api/projects/{self.pid}/procurement/init').json()['items']
        second = self.clients['buyer2'].post(f'/api/projects/{self.pid}/procurement/init').json()['items']
        self.assertEqual(first, second)

    def test_full_image_upload_read_remove_and_scope(self):
        raw = BytesIO(); Image.new('RGB', (640, 480), 'white').save(raw, 'PNG'); content = raw.getvalue()
        result = self.clients['buyer1'].post(f'/api/procurement/{self.item}/images', files={'file': ('synthetic.png', content, 'image/png')})
        self.assertEqual(result.status_code, 201, result.text)
        image_id = result.json()['id']; path = f'/api/procurement-images/{image_id}'
        self.assertEqual(len(self.rows('buyer2')[0]['images']), 1)
        downloaded = self.clients['buyer2'].get(path)
        self.assertEqual(downloaded.content, content)
        self.assertEqual(downloaded.headers['content-type'], 'image/png')
        for who in ('outsider', 'assistant', 'finance'):
            self.assertEqual(self.clients[who].get(path).status_code, 403)
            self.assertEqual(self.clients[who].delete(path).status_code, 403)
            self.assertEqual(self.clients[who].post(f'/api/procurement/{self.item}/images', files={'file': ('x.png', content, 'image/png')}).status_code, 403)
        self.assertEqual(self.anon.get(path).status_code, 401)
        with Session(self.engine) as session: stored = Path(session.get(models.ProcurementImage, image_id).stored_path)
        self.assertTrue(stored.exists())
        self.assertEqual(self.clients['buyer2'].delete(path).status_code, 204)
        self.assertFalse(stored.exists()); self.assertEqual(self.clients['buyer1'].get(path).status_code, 404)

    def test_reject_spoofed_svg_and_oversized_images(self):
        for payload, expected in [(b'<svg onload="alert(1)"></svg>', 422), (b'x' * (8 * 1024 * 1024 + 1), 413)]:
            result = self.clients['buyer1'].post(f'/api/procurement/{self.item}/images', files={'file': ('fake.png', payload, 'image/png')})
            self.assertEqual(result.status_code, expected)
        self.assertEqual(self.rows()[0]['images'], [])

    def test_old_schema_upgrade_preserves_rows_and_is_repeatable(self):
        old = create_engine(f'sqlite:///{self.temp.name}/legacy.db')
        self.addCleanup(old.dispose)
        with old.begin() as connection:
            connection.execute(text('CREATE TABLE procurement_items (id INTEGER PRIMARY KEY, project_id INTEGER, name VARCHAR, wave VARCHAR, status VARCHAR, note VARCHAR, sort_order INTEGER, updated_by VARCHAR, updated_at VARCHAR)'))
            connection.execute(text("INSERT INTO procurement_items VALUES (1, 1, 'Old material', 'other', 'ordered', 'Keep note', 0, 'J', '2026-09-20')"))
        with patch.object(db, 'engine', old):
            db.init_db(); db.init_db()
        with Session(old) as session:
            row = session.get(models.ProcurementItem, 1)
            self.assertEqual((row.name, row.note, row.status), ('Old material', 'Keep note', 'ordered'))
            self.assertIsNone(row.ordered_on); self.assertIsNone(row.amount); self.assertEqual(row.images, [])
