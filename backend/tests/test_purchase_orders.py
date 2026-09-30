"""Real HTTP boundaries and lifecycle of orders rooted in the 37-row procurement list."""
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from zoneinfo import ZoneInfo
from decimal import Decimal
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4
from threading import Barrier

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app import models
from app.auth import hash_password
from app.db import get_db
from app import db as database
from app.dictionaries import PROCUREMENT_TEMPLATE
from app.purchase_orders import OrderDocument, order_summary, parse_order_text
from app.routers import auth, common, procurement, purchase_orders, tasks


class PurchaseOrderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.engine = create_engine(f"sqlite:///{self.temp.name}/orders.db", connect_args={"check_same_thread": False})
        self.addCleanup(self.engine.dispose)
        models.Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            prop = models.Property(address_std="100 Synthetic Order Test Road"); db.add(prop); db.flush()
            projects = [models.Project(property_id=prop.id, name=f"Order test {i}") for i in range(2)]
            db.add_all(projects); db.flush(); self.pid, self.other_pid = [p.id for p in projects]
            self.items = [m.id for m in procurement.ensure_procurement(db, self.pid)]
            self.other_items = [m.id for m in procurement.ensure_procurement(db, self.other_pid)]
            self.users = {}
            for name, role, member in [('buyer', '采购', True), ('second', '采购', True), ('outsider', '采购', False), ('finance', '财务', True), ('manager', 'J', True)]:
                user = models.User(username=name, email=f"{name}@example.com", display_name=name, role_code=role,
                                   password_hash=hash_password("Order-fixture-only-47!"))
                db.add(user); db.flush(); self.users[name] = user.id
                if member: db.add(models.ProjectMember(project_id=self.pid, user_id=user.id, active=True))
            purchase = next(t for t in tasks.ensure_tasks(db, self.pid, commit=False) if t.step_key == 'purchase')
            purchase.assignee_user_id = self.users['buyer']; purchase.reviewer_user_id = self.users['manager']; purchase.exec_status = 'in_progress'
            self.task_id = purchase.id
            db.commit()
        self.app = FastAPI()
        for router in (auth, procurement, purchase_orders, tasks): self.app.include_router(router.router)
        def isolated():
            with Session(self.engine, expire_on_commit=False) as db: yield db
        self.app.dependency_overrides[get_db] = isolated
        self.addCleanup(patch.stopall); patch.object(common, 'DEMO_MODE', False).start()
        self.clients = {}
        for name in self.users:
            client = TestClient(self.app); self.addCleanup(client.close)
            self.assertEqual(client.post('/api/auth/login', json={'email': f'{name}@example.com', 'password': 'Order-fixture-only-47!'}).status_code, 200)
            self.clients[name] = client
        self.client = self.clients['buyer']
        self.doc = {'vendor': 'Amazon', 'order_number': 'SYNTHETIC-001', 'ordered_on': '2026-09-01',
                    'tax': '1.20', 'shipping': '0', 'discount': '0', 'total': '61.20',
                    'lines': [{'id': 'lamp', 'material_id': self.items[0], 'name': 'Synthetic light', 'quantity': '6', 'unit_price': '10.00'}],
                    'deliveries': [{'id': 'first', 'label': 'First box', 'method': 'shipping', 'website_status': 'delivered',
                                    'allocations': [{'line_id': 'lamp', 'quantity': '4'}]},
                                   {'id': 'second', 'label': 'Second box', 'allocations': [{'line_id': 'lamp', 'quantity': '2'}]}]}

    def create(self, doc=None, **extra):
        return self.client.post(f'/api/projects/{self.pid}/purchase-orders', json={'document': doc or self.doc, 'request_key': str(uuid4()), **extra})

    def receive(self, order, delivery, quantity, damaged='0', **extra):
        body = {'request_key': str(uuid4()), 'expected_version': order['version'],
                'receipt': {'id': str(uuid4()), 'delivery_id': delivery, 'received_on': datetime.now(ZoneInfo("America/Los_Angeles")).date().isoformat(), 'location': 'Synthetic site',
                            'lines': [{'line_id': 'lamp', 'quantity': quantity, 'damaged_quantity': damaged}]}, **extra}
        return self.client.post(f"/api/purchase-orders/{order['id']}/receipts", json=body)

    def save(self, order, doc, **extra):
        return self.client.put(f"/api/purchase-orders/{order['id']}", json={'request_key': str(uuid4()), 'expected_version': order['version'], 'document': doc, **extra})

    def material(self, item_id=None):
        data = self.client.get(f'/api/projects/{self.pid}/procurement').json()
        return next(r for r in data['items'] if r['id'] == (item_id or self.items[0]))

    def test_37_rows_preserved_and_orders_drive_material_without_duplicate_edits(self):
        self.assertEqual(len(PROCUREMENT_TEMPLATE), 37)
        with Session(self.engine) as db:
            before = [(r.id, r.name, r.status) for r in db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == self.pid)).all()]
        response = self.create(); self.assertEqual(response.status_code, 201, response.text)
        order = response.json()
        self.assertEqual(self.material()['status'], 'ordered')
        self.assertEqual(self.material()['amount'], 60)
        self.assertEqual(self.material()['ordered_on'], '2026-09-01')
        self.assertEqual(self.material(self.items[1])['status'], 'pending_spec')
        self.assertFalse(order['summary']['complete'])
        self.assertEqual(float(order['summary']['lines'][0]['received']), 0)
        response = self.receive(order, 'first', '4', '1'); self.assertEqual(response.status_code, 200, response.text)
        order = response.json(); self.assertEqual(float(order['summary']['lines'][0]['remaining']), 3)
        self.assertEqual(self.material()['status'], 'exception')
        self.assertEqual(order['document']['receipts'][0]['confirmed_by'], self.users['buyer'])
        order = self.receive(order, 'second', '2').json()
        self.assertEqual(float(order['summary']['lines'][0]['remaining']), 1)
        doc = deepcopy(order['document']); doc['deliveries'].append({'id': 'replacement', 'label': 'Replacement', 'replacement': True,
            'allocations': [{'line_id': 'lamp', 'quantity': '1'}]})
        order = self.save(order, doc).json(); order = self.receive(order, 'replacement', '1').json()
        self.assertTrue(order['summary']['complete']); self.assertEqual(order['document']['total'], '61.20')
        self.assertEqual(self.material()['status'], 'received')
        self.assertEqual(self.material()['legacy_purchase']['status'], 'pending_spec')
        self.assertEqual(self.client.patch(f'/api/procurement/{self.items[0]}', json={'status': 'pending_spec'}).status_code, 409)
        tracking = self.client.get('/api/me/procurement-tracking').json()
        self.assertEqual(next(r for r in tracking['items'] if r['id'] == self.items[0])['status'], 'received')
        with Session(self.engine) as db:
            after = [(r.id, r.name, r.status) for r in db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == self.pid)).all()]
            self.assertEqual(before, after); self.assertEqual(db.query(models.Expense).count(), 0)

    def test_material_mandatory_cross_house_rejected_and_permissions(self):
        missing = deepcopy(self.doc); del missing['lines'][0]['material_id']
        self.assertEqual(self.create(missing).status_code, 422)
        wrong = deepcopy(self.doc); wrong['lines'][0]['material_id'] = self.other_items[0]
        self.assertEqual(self.create(wrong).status_code, 422)
        order = self.create().json()
        for who in ('outsider', 'finance'):
            client = self.clients[who]
            self.assertEqual(client.get(f"/api/purchase-orders/{order['id']}").status_code, 200 if who == "finance" else 403)
            self.assertEqual(client.post(f'/api/projects/{self.pid}/purchase-orders/preview', json={'text': 'Amazon'}).status_code, 403)
        self.assertEqual(self.clients['outsider'].get('/api/purchase-orders').json(), [])
        with TestClient(self.app) as anonymous:
            self.assertEqual(anonymous.get('/api/purchase-orders').status_code, 401)
        self.assertEqual(self.clients['second'].get(f"/api/purchase-orders/{order['id']}").status_code, 200)
        with Session(self.engine) as db:
            member = db.scalar(select(models.ProjectMember).where(models.ProjectMember.user_id == self.users['second']))
            member.active = False; db.commit()
        self.assertEqual(self.clients['second'].get(f"/api/purchase-orders/{order['id']}").status_code, 403)

    def test_finance_member_reads_same_facts_but_cannot_write(self):
        order = self.create().json()
        order = self.receive(order, 'first', '2').json()
        finance = self.clients['finance']
        for path in [f'/api/projects/{self.pid}/procurement', '/api/me/procurement-tracking', '/api/purchase-orders', f'/api/purchase-orders/{order["id"]}']:
            self.assertEqual(finance.get(path).status_code, 200, path)
        self.assertEqual(finance.get(f'/api/purchase-orders/{order["id"]}').json()['document'], order['document'])
        self.assertEqual(finance.get(f'/api/projects/{self.other_pid}/procurement').status_code, 403)
        self.assertEqual(finance.get(f'/api/purchase-orders?project_id={self.other_pid}').status_code, 403)
        before = finance.get(f'/api/purchase-orders/{order["id"]}').json()
        writes = [
            ('post', f'/api/projects/{self.pid}/purchase-orders', {'request_key': str(uuid4()), 'document':self.doc}),
            ('put', f'/api/purchase-orders/{order["id"]}', {'request_key': str(uuid4()), 'expected_version':order['version'], 'document':order['document']}),
            ('post', f'/api/purchase-orders/{order["id"]}/receipts', {'request_key': str(uuid4()), 'expected_version':order['version'], 'receipt':order['document']['receipts'][0]}),
            ('post', f'/api/purchase-orders/{order["id"]}/receipts/{order["document"]["receipts"][0]["id"]}/void', {'request_key': str(uuid4()), 'expected_version':order['version'], 'reason':'test'}),
            ('patch', f'/api/procurement/{self.items[0]}', {'note':'forbidden'}),
            ('post', f'/api/projects/{self.pid}/procurement', {'name':'forbidden','wave':'other'}),
        ]
        for method, path, body in writes:
            self.assertEqual(getattr(finance,method)(path,json=body).status_code,403,path)
        self.assertEqual(finance.get(f'/api/purchase-orders/{order["id"]}').json(),before)
        with Session(self.engine) as db:
            db.scalar(select(models.ProjectMember).where(models.ProjectMember.user_id==self.users['finance'])).active=False
            db.commit()
        self.assertEqual(finance.get(f'/api/purchase-orders/{order["id"]}').status_code,403)
        self.assertEqual(finance.get('/api/purchase-orders').json(),[])
        self.assertEqual(finance.get('/api/me/procurement-tracking').json()['items'],[])

    def test_repeated_requests_and_duplicate_order_and_stale_edit(self):
        body = {'request_key': str(uuid4()), 'document': self.doc}
        url = f'/api/projects/{self.pid}/purchase-orders'
        first = self.client.post(url, json=body); self.assertEqual(first.status_code, 201, first.text)
        order = first.json()
        self.assertEqual(self.client.post(url, json=body).json()['id'], order['id'])
        self.assertEqual(self.create().status_code, 409)
        doc = deepcopy(order['document']); doc['note'] = 'New buyer note'
        response = self.save(order, doc); self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.save(order, order['document']).status_code, 409)
        current = self.client.get(f"/api/purchase-orders/{order['id']}").json()
        self.assertEqual(current['document']['note'], 'New buyer note'); self.assertEqual(len(current['events']), 2)
        body['document'] = doc
        self.assertEqual(self.client.post(url, json=body).status_code, 409)

    def test_actual_receipts_immutable_overreceipt_and_retry(self):
        order = self.create().json()
        self.assertEqual(self.receive(order, 'first', '5').status_code, 422)
        self.assertEqual(self.receive(order, 'first', '2', '3').status_code, 422)
        key = str(uuid4()); receipt = {'id': 'receipt-one', 'delivery_id': 'first', 'received_on': datetime.now(ZoneInfo("America/Los_Angeles")).date().isoformat(),
            'location': 'Synthetic company', 'confirmed_by': 999, 'lines': [{'line_id': 'lamp', 'quantity': '2'}]}
        payload = {'request_key': key, 'expected_version': order['version'], 'receipt': receipt}
        url = f"/api/purchase-orders/{order['id']}/receipts"
        first = self.client.post(url, json=payload); self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(self.client.post(url, json=payload).json()['version'], first.json()['version'])
        current = first.json(); self.assertEqual(current['document']['receipts'][0]['confirmed_by'], self.users['buyer'])
        doc = deepcopy(current['document']); doc['receipts'] = []
        self.assertEqual(self.save(current, doc).status_code, 422)
        doc = deepcopy(current['document']); doc['lines'][0]['material_id'] = self.items[1]
        self.assertEqual(self.save(current, doc).status_code, 422)
        response = self.client.post(f"{url}/receipt-one/void", json={'request_key': str(uuid4()), 'expected_version': current['version'], 'reason': 'Quantity entered incorrectly'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(float(response.json()['summary']['lines'][0]['received']), 0)
        self.assertTrue(response.json()['document']['receipts'][0]['void_reason'])

    def test_money_unknown_zero_and_reconciliation(self):
        doc = deepcopy(self.doc); doc['total'] = '62.20'
        self.assertEqual(self.create(doc).status_code, 422)
        doc['reconciliation_note'] = 'Check vendor surcharge'
        response = self.create(doc); self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(float(response.json()['summary']['difference']), 1)
        doc = deepcopy(self.doc); doc['order_number'] = 'UNKNOWN'; doc['lines'][0].pop('unit_price'); doc['total'] = None
        response = self.create(doc); self.assertEqual(response.status_code, 201, response.text)
        self.assertIsNone(response.json()['summary']['subtotal'])
        doc = deepcopy(self.doc); doc['order_number'] = 'ZERO'; doc['lines'][0]['unit_price'] = '0'; doc['tax'] = '0'; doc['total'] = '0'
        self.assertEqual(float(self.create(doc).json()['summary']['subtotal']), 0)
        doc['total'] = '1.001'; self.assertEqual(self.create(doc).status_code, 422)
        exact = deepcopy(self.doc); exact['lines'][0]['quantity'] = '3'; exact['lines'][0]['unit_price'] = '0.10'; exact['deliveries'] = []; exact['tax'] = '0'; exact['total'] = '0.30'
        self.assertEqual(order_summary(OrderDocument.model_validate(exact))['difference'], Decimal('0'))

    def test_parser_vendor_examples_and_preview_never_writes(self):
        for vendor in ('Amazon', 'The Home Depot', 'Wayfair', 'Local Supply'):
            source = f'Vendor: {vendor}\nOrder #: SYNTHETIC-001\nOrder date: 2026-09-01\nSynthetic light\nQty: 6\nUnit price: $10.00\nTax: $1.20\nShipping: $0.00\nDiscount: $0.00\nOrder total: $61.20'
            result = self.client.post(f'/api/projects/{self.pid}/purchase-orders/preview', json={'text': source})
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()['draft']['lines'][0]['quantity'], '6')
            self.assertNotIn('receipts', result.json()['draft'])
        with Session(self.engine) as db: self.assertEqual(db.query(models.PurchaseOrder).count(), 0)
        order = self.create(source_text='Synthetic source text').json()
        parsed = self.client.post(f'/api/projects/{self.pid}/purchase-orders/preview', json={'text': 'Amazon\nOrder # SYNTHETIC-001\nDelivered'}).json()
        self.assertEqual(parsed['existing_order_id'], order['id']); self.assertTrue(parsed['warnings'])
        unknown = parse_order_text('Unknown free-form text\n$500\nQuantity: none')
        self.assertEqual(unknown['draft']['lines'], []); self.assertNotIn('total', unknown['draft'])
        self.assertEqual(order['events'][0]['source_text'], 'Synthetic source text')

    def test_restart_and_old_rows_preserved(self):
        order = self.create().json()
        self.engine.dispose(); models.Base.metadata.create_all(self.engine)
        current = self.client.get(f"/api/purchase-orders/{order['id']}").json()
        self.assertEqual(current['document'], order['document'])
        with Session(self.engine) as db:
            self.assertEqual(db.query(models.ProcurementItem).filter_by(project_id=self.pid).count(), 37)
            self.assertEqual(db.query(models.PurchaseOrderEvent).count(), 1)

    def test_returns_keep_history_and_refund_is_not_expense(self):
        order = self.create().json(); order = self.receive(order, 'first', '4', '1').json()
        doc = deepcopy(order['document']); doc['adjustments'] = [{'id': 'return', 'line_id': 'lamp', 'returned_quantity': '1',
            'returned_usable_quantity': '0', 'refund': '10.00', 'occurred_on': datetime.now(ZoneInfo("America/Los_Angeles")).date().isoformat(), 'reason': 'Broken item returned'}]
        response = self.save(order, doc); self.assertEqual(response.status_code, 200, response.text)
        current = response.json(); self.assertEqual(float(current['summary']['refund']), 10)
        doc = deepcopy(current['document']); doc['adjustments'] = []
        self.assertEqual(self.save(current, doc).status_code, 422)
        with Session(self.engine) as db: self.assertEqual(db.query(models.Expense).count(), 0)

    def test_one_platform_order_keeps_item_sellers_brands_prices_and_arrivals_separate(self):
        doc = deepcopy(self.doc)
        doc['lines'][0].update(vendor='Synthetic lighting seller', brand='Fixture lights', expected_on='2026-10-02')
        doc['lines'].append({'id': 'faucet', 'material_id': self.items[1], 'name': 'Synthetic faucet', 'quantity': '1',
            'unit_price': '25.00', 'vendor': 'Synthetic plumbing seller', 'brand': 'Fixture plumbing', 'expected_on': '2026-10-05'})
        doc['total'] = '86.20'
        response = self.create(doc); self.assertEqual(response.status_code, 201, response.text)
        order = response.json()
        restored = self.client.get(f"/api/purchase-orders/{order['id']}").json()['document']
        self.assertEqual(restored['vendor'], 'Amazon'); self.assertEqual(restored['order_number'], 'SYNTHETIC-001')
        self.assertEqual(restored['ordered_on'], '2026-09-01')
        self.assertEqual([line['vendor'] for line in restored['lines']], ['Synthetic lighting seller', 'Synthetic plumbing seller'])
        self.assertEqual([line['brand'] for line in restored['lines']], ['Fixture lights', 'Fixture plumbing'])
        self.assertEqual([line['expected_on'] for line in restored['lines']], ['2026-10-02', '2026-10-05'])
        self.assertEqual([line['unit_price'] for line in restored['lines']], ['10.00', '25.00'])
        self.assertEqual(self.material()['expected_on'], '2026-10-02')
        self.assertEqual(self.material(self.items[1])['expected_on'], '2026-10-05')

    def test_two_buyers_concurrently_edit_only_one_commits(self):
        order = self.create().json(); barrier = Barrier(2)
        def edit(who):
            doc = deepcopy(order['document']); doc['note'] = who
            barrier.wait(timeout=10)
            return self.clients[who].put(f"/api/purchase-orders/{order['id']}", json={
                'request_key': str(uuid4()), 'expected_version': order['version'], 'document': doc})
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(edit, ('buyer', 'second')))
        self.assertEqual(sorted(r.status_code for r in results), [200, 409])
        current = self.client.get(f"/api/purchase-orders/{order['id']}").json()
        winner = next(r.json() for r in results if r.status_code == 200)
        self.assertEqual(current['document'], winner['document'])
        self.assertEqual(len(current['events']), 2)

    def test_additive_upgrade_preserves_old_materials_and_history(self):
        from sqlalchemy import text
        # Simulate the five absent nullable columns of a pre-order database.
        with self.engine.begin() as conn:
            conn.execute(text("UPDATE procurement_items SET note='Original selection notes' WHERE id=:id"), {'id': self.items[0]})
            for column in ('required_quantity', 'unit', 'needed_on', 'budget_amount', 'use_location'):
                conn.execute(text(f'ALTER TABLE procurement_items DROP COLUMN {column}'))
        with patch.object(database, 'engine', self.engine): database.init_db()
        with Session(self.engine) as db:
            rows = db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == self.pid)).all()
            self.assertEqual(len(rows), 37)
            self.assertEqual(rows[0].note, 'Original selection notes')
            self.assertIsNone(rows[0].required_quantity)
        self.assertEqual(self.create().status_code, 201)

    def test_multiple_orders_demand_returns_voids_and_cancel_recalculate_same_material(self):
        first = self.create().json()
        first = self.receive(first, 'first', '4').json(); first = self.receive(first, 'second', '2').json()
        self.assertEqual(self.material()['status'], 'received')
        # Increasing demand recalculates immediately; no manual status update.
        response = self.client.patch(f'/api/procurement/{self.items[0]}', json={'required_quantity': 8, 'unit': '件'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.material()['status'], 'pending_order')
        doc = deepcopy(self.doc); doc['order_number'] = 'SECOND'; doc['lines'][0]['quantity'] = '2'
        doc['deliveries'] = [{'id': 'first', 'label': 'Additional', 'allocations': [{'line_id': 'lamp', 'quantity': '2'}]}]
        doc['total'] = '21.20'
        second = self.create(doc).json(); self.assertEqual(self.material()['status'], 'ordered')
        second = self.receive(second, 'first', '2').json(); self.assertEqual(self.material()['status'], 'received')
        self.assertEqual(self.material()['amount'], 80)
        # A return reopens the same material and retains its original history.
        doc = deepcopy(second['document']); doc['adjustments'] = [{'id': 'return', 'line_id': 'lamp', 'returned_quantity': '1',
            'returned_usable_quantity': '1', 'refund': '10', 'occurred_on': '2026-09-28', 'reason': 'Return fixture'}]
        second = self.save(second, doc).json(); self.assertEqual(self.material()['status'], 'ordered')
        # All-cancelled orders never count as purchasing completed.
        third_doc = deepcopy(self.doc); third_doc['order_number'] = 'CANCELLED'; third_doc['lines'][0]['material_id'] = self.items[1]
        third_doc['lines'][0]['cancelled_quantity'] = '6'; third_doc['deliveries'] = []
        self.assertEqual(self.create(third_doc).status_code, 201)
        self.assertEqual(self.material(self.items[1])['status'], 'pending_order')

    def test_project_procurement_evidence_uses_the_same_receipt_projection(self):
        from app.steps import _evidence
        with Session(self.engine) as db:
            for item in db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == self.pid)):
                if item.id != self.items[0]: item.status = 'na'
            db.commit()
        order = self.create().json()
        with Session(self.engine) as db:
            self.assertFalse(_evidence('procurement:critical', db.get(models.Project, self.pid))[0])

        order = self.receive(order, 'first', '4').json(); order = self.receive(order, 'second', '2').json()
        with Session(self.engine) as db:
            self.assertTrue(_evidence('procurement:critical', db.get(models.Project, self.pid))[0])
        receipt = order['document']['receipts'][0]
        response = self.client.post(f"/api/purchase-orders/{order['id']}/receipts/{receipt['id']}/void", json={
            'request_key': str(uuid4()), 'expected_version': order['version'], 'reason': 'Wrong receipt corrected'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.material()['status'], 'ordered')
        with Session(self.engine) as db:
            self.assertFalse(_evidence('procurement:critical', db.get(models.Project, self.pid))[0])

    def test_project_deletion_cannot_orphan_order_history(self):
        from app.routers.projects import delete_project
        self.create()
        with Session(self.engine) as db:
            with self.assertRaises(HTTPException) as error:
                delete_project(self.pid, db=db, actor='负责人')
            self.assertEqual(error.exception.status_code, 409)
            self.assertIsNotNone(db.get(models.Project, self.pid))




    def test_assignment_allows_purchasing_without_start_and_keeps_member_permissions(self):
        with Session(self.engine) as db:
            task = db.get(models.Task, self.task_id); task.assignee_user_id = None; task.exec_status = 'not_started'; db.commit()
        self.assertEqual(self.create().status_code, 409)
        url = f'/api/projects/{self.pid}/tasks/{self.task_id}'
        manager = self.clients['manager']; task = manager.get(url).json()
        self.assertEqual(manager.post(url + '/assign', json={'version': task['version'], 'assignee_user_id': self.users['finance']}).status_code, 400)
        task = manager.post(url + '/assign', json={'version': task['version'], 'assignee_user_id': self.users['buyer']}).json()
        self.assertEqual(task['exec_status'], 'in_progress')
        self.assertEqual(self.clients['second'].post(f'/api/projects/{self.pid}/purchase-orders', json={'document': self.doc, 'request_key': str(uuid4())}).status_code, 201)
        for action, payload in [('status', {'action': 'start'}), ('submit', {'note': 'unused'}), ('confirm', {})]:
            self.assertEqual(manager.post(url + '/' + action, json={'version': task['version'], **payload}).status_code, 409)
        self.assertEqual(self.clients['outsider'].get('/api/me/procurement-tracking').json()['tasks'], [])
        changed = manager.post(url + '/assign', json={'version': task['version'], 'assignee_user_id': self.users['second'], 'reason': 'Synthetic handover'}).json()
        self.assertEqual(changed['exec_status'], 'in_progress')
        self.assertEqual(changed['assignee']['id'], self.users['second'])
        self.assertEqual(len(self.clients['second'].get('/api/purchase-orders').json()), 1)

    def test_direct_receipts_damage_replacement_progress_and_scope_addition_preserve_history(self):
        url = f'/api/projects/{self.pid}/tasks/{self.task_id}'
        with Session(self.engine) as db:
            for r in db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == self.pid)):
                if r.id != self.items[0]: r.status = 'na'
            task = db.get(models.Task, self.task_id); task.exec_status = 'done'
            db.add(models.TaskSubmission(task_id=task.id, project_id=self.pid, seq=1, decision='confirmed', submitted_by_user_id=self.users['buyer']))
            db.commit(); db.refresh(task); version = task.version
        doc = deepcopy(self.doc); doc['deliveries'] = []; doc['lines'][0]['expected_on'] = '2026-09-25'
        doc['lines'][0]['website_status'] = 'delivered'
        order = self.create(doc).json(); self.assertEqual(self.material()['status'], 'ordered')
        self.assertEqual(self.receive(order, None, '7').status_code, 422)
        order = self.receive(order, None, '6', '1').json()
        self.assertEqual(self.material()['status'], 'exception')
        self.assertEqual(self.client.get(url).json()['procurement_progress']['total'], 1)
        order = self.receive(order, None, '1').json()
        task = self.client.get(url).json(); self.assertEqual(task['exec_status'], 'done')
        self.assertEqual(task['procurement_progress']['ready'], 1)
        self.assertEqual(task['submissions'][0]['decision'], 'confirmed')
        self.assertEqual(task['version'], version)
        self.assertEqual(self.receive(order, None, '1').status_code, 422)
        last = order['document']['receipts'][-1]
        order = self.client.post(f"/api/purchase-orders/{order['id']}/receipts/{last['id']}/void", json={'request_key':str(uuid4()), 'expected_version':order['version'], 'reason':'Synthetic correction'}).json()
        self.assertEqual(self.client.get(url).json()['exec_status'], 'in_progress')
        order = self.receive(order, None, '1').json()
        body = {'name':'Synthetic new need','wave':'other','request_key':str(uuid4())}
        endpoint = f'/api/projects/{self.pid}/procurement'
        added = self.client.post(endpoint,json=body).json()
        self.assertEqual(self.client.post(endpoint,json=body).json()['created_item_id'], added['created_item_id'])
        self.assertEqual(self.client.post(endpoint,json={**body,'name':'Changed'}).status_code,409)
        task = self.client.get(url).json(); self.assertEqual(task['procurement_progress']['total'],2)
        self.assertEqual(task['exec_status'],'in_progress'); self.assertEqual(task['version'],version)
        with Session(self.engine) as db:
            self.assertEqual(db.get(models.Task,self.task_id).exec_status,'done')
            self.assertEqual(db.get(models.Task,self.task_id).requirement_version,1)
        changed = deepcopy(order['document']); changed['refunded'] = '10.00'
        order = self.save(order,changed).json(); self.assertEqual(Decimal(str(order['summary']['refund'])),Decimal('10.00'))
        changed['refunded']='10000'; self.assertEqual(self.save(order,changed).status_code,422)

    def test_bulk_not_needed_atomic_versions_and_order_guard(self):
        endpoint=f'/api/projects/{self.pid}/procurement/not-needed'
        rows=self.client.get(f'/api/projects/{self.pid}/procurement').json()['items']
        body={'items':[{'id':r['id'],'updated_at':r['updated_at']} for r in rows[:5]],'reason':'Synthetic not needed'}
        self.assertEqual(self.clients['outsider'].post(endpoint,json=body).status_code,403)
        invalid=deepcopy(body);invalid['items'][0]['id']='bad'
        self.assertEqual(self.client.post(endpoint,json=invalid).status_code,422)
        bad=deepcopy(body);bad['items'][-1]['updated_at']='stale'
        self.assertEqual(self.client.post(endpoint,json=bad).status_code,409)
        self.assertTrue(all(r['status']=='pending_spec' for r in self.client.get(f'/api/projects/{self.pid}/procurement').json()['items']))
        self.assertEqual(self.client.post(endpoint,json=body).status_code,200)
        progress=self.client.get(f'/api/projects/{self.pid}/tasks/{self.task_id}').json()['procurement_progress']
        self.assertEqual((progress['total'],progress['ready'],progress['excluded']),(32,0,5))
        self.create();row=self.material()
        self.assertEqual(self.client.post(endpoint,json={'items':[{'id':row['id'],'updated_at':row['updated_at']}],'reason':'No hiding ordered items'}).status_code,409)

    def test_concurrent_new_need_is_idempotent_without_task_mutation(self):
        endpoint=f'/api/projects/{self.pid}/procurement'; body={'name':'Synthetic extra','wave':'other','request_key':str(uuid4())}
        with Session(self.engine) as db: original_version = db.get(models.Task,self.task_id).version
        barrier=Barrier(2); validate=procurement._validated
        def together(*args,**kwargs):
            result=validate(*args,**kwargs);barrier.wait(timeout=10);return result
        with patch.object(procurement,'_validated',together):
            with ThreadPoolExecutor(max_workers=2) as pool:
                responses=[f.result() for f in [pool.submit(self.client.post,endpoint,json=body) for _ in range(2)]]
        self.assertEqual([r.status_code for r in responses],[201,201],[r.text for r in responses])
        self.assertEqual(responses[0].json()['created_item_id'],responses[1].json()['created_item_id'])
        self.assertEqual(len(self.client.get(f'/api/projects/{self.pid}/procurement').json()['items']),38)
        with Session(self.engine) as db:
            self.assertEqual(db.get(models.Task,self.task_id).version,original_version)

    def test_house_overview_money_permission_and_damage_gap(self):
        doc = deepcopy(self.doc); doc['deliveries'] = []
        doc['lines'][0]['expected_on'] = '2026-08-01'
        self.assertEqual(self.create(doc).status_code, 422)
        doc['lines'][0]['expected_on'] = '2026-09-25'
        order = self.create(doc).json()
        order = self.receive(order, None, '6', '1').json()
        def house(client):
            payload = client.get('/api/me/workbench').json()
            return next(p for p in payload['projects'] if p['project_id'] == self.pid)
        overview = house(self.clients['manager'])['procurement']
        self.assertEqual(Decimal(overview['spent']), Decimal('61.20'))
        self.assertEqual(len(overview['problems']), 1)
        self.assertIn('破损待补齐 1', overview['problems'][0]['note'])
        self.assertIsNone(house(self.clients['finance'])['procurement'])
        changed = deepcopy(order['document']); changed['refunded'] = '10'
        order = self.save(order, changed).json()
        self.assertEqual(Decimal(house(self.clients['manager'])['procurement']['spent']), Decimal('51.20'))
        self.receive(order, None, '1')
        self.assertEqual(house(self.clients['manager'])['procurement']['problems'], [])
        unknown = deepcopy(doc); unknown['total'] = None; unknown['order_number'] = 'SYNTHETIC-UNKNOWN'
        self.assertEqual(self.create(unknown).status_code, 201)
        overview = house(self.clients['manager'])['procurement']
        self.assertEqual(overview['missing_totals'], 1)
        self.assertEqual(overview['order_count'], 2)

    def assert_attention_surfaces(self, expected_ids):
        project = self.client.get(f'/api/projects/{self.pid}/procurement').json()['items']
        workspace = self.client.get('/api/me/procurement-tracking').json()['items']
        overview = next(p for p in self.clients['manager'].get('/api/me/workbench').json()['projects'] if p['project_id'] == self.pid)['procurement']
        project_reasons = {r['id']: r['attention_reasons'] for r in project if r['attention_reasons']}
        workspace_reasons = {r['id']: r['attention_reasons'] for r in workspace if r['project_id'] == self.pid and r['attention_reasons']}
        self.assertEqual(set(project_reasons), set(expected_ids))
        self.assertEqual(workspace_reasons, project_reasons)
        self.assertEqual({r['id']: r['note'] for r in overview['problems']}, {key: '；'.join(value) for key, value in project_reasons.items()})
        return project_reasons

    def test_attention_web_delivery_partial_damage_replacement_and_void_agree_across_surfaces(self):
        doc = deepcopy(self.doc); doc['deliveries'] = []
        doc['lines'][0].update(website_status='delivered', expected_on='2026-09-25')
        order = self.create(doc).json()
        reasons = self.assert_attention_surfaces([self.items[0]])
        self.assertIn('网站送达待确认', reasons[self.items[0]])
        order = self.receive(order, None, '2').json()
        self.assert_attention_surfaces([self.items[0]])
        order = self.receive(order, None, '4', '1').json()
        reasons = self.assert_attention_surfaces([self.items[0]])
        self.assertIn('破损待补齐 1', '；'.join(reasons[self.items[0]]))
        order = self.receive(order, None, '1').json()
        self.assert_attention_surfaces([])
        last = order['document']['receipts'][-1]
        response = self.client.post(f"/api/purchase-orders/{order['id']}/receipts/{last['id']}/void", json={
            'request_key':str(uuid4()), 'expected_version':order['version'], 'reason':'Synthetic correction'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assert_attention_surfaces([self.items[0]])

    def test_attention_each_line_eta_pickup_and_manual_issue_use_current_facts_only(self):
        with Session(self.engine) as db:
            row = db.get(models.ProcurementItem, self.items[0]); row.follow_up = 'Old superseded followup'; db.commit()
        doc = deepcopy(self.doc); doc['deliveries'] = []
        doc['lines'][0]['expected_on'] = '2026-09-25'
        order = self.create(doc).json()
        later = deepcopy(doc); later['order_number'] = 'SYNTHETIC-LATER'; later['lines'][0]['expected_on'] = '2099-01-01'
        later_order = self.create(later).json()
        reasons = self.assert_attention_surfaces([self.items[0]])
        self.assertEqual(reasons[self.items[0]], ['预计日期已过，待核实'])
        order = self.receive(order, None, '6').json()
        self.assert_attention_surfaces([])
        changed = deepcopy(later_order['document']); changed['lines'][0]['website_status'] = 'ready_pickup'
        later_order = self.save(later_order, changed).json()
        self.assertEqual(self.assert_attention_surfaces([self.items[0]])[self.items[0]], ['待取货'])
        changed = deepcopy(later_order['document']); changed['lines'][0]['issue_note'] = 'Synthetic wrong color'
        later_order = self.save(later_order, changed).json()
        later_order = self.receive(later_order, None, '6').json()
        self.assertEqual(self.assert_attention_surfaces([self.items[0]])[self.items[0]], ['Synthetic wrong color'])
        changed = deepcopy(later_order['document']); changed['lines'][0]['issue_note'] = ''
        self.assertEqual(self.save(later_order, changed).status_code, 200)
        self.assert_attention_surfaces([])

    def test_attention_shared_legacy_delivery_only_flags_unreceived_material(self):
        doc = deepcopy(self.doc)
        doc['total'] = '63.20'
        doc['lines'].append({'id':'floor', 'material_id':self.items[1], 'name':'Synthetic floor', 'quantity':'2', 'unit_price':'1'})
        doc['deliveries'] = [{'id':'shared', 'label':'Synthetic shared box', 'website_status':'delivered', 'allocations':[{'line_id':'lamp','quantity':'6'},{'line_id':'floor','quantity':'2'}]}]
        response = self.create(doc); self.assertEqual(response.status_code, 201, response.text)
        order = response.json()
        self.assert_attention_surfaces(self.items[:2])
        order = self.receive(order, 'shared', '6').json()
        self.assert_attention_surfaces([self.items[1]])
        changed = deepcopy(order['document']); changed['deliveries'][0]['website_status'] = 'exception'
        order = self.save(order, changed).json()
        self.assertEqual(self.assert_attention_surfaces([self.items[1]])[self.items[1]], ['物流异常'])

    def test_attention_legacy_rows_keep_followups_but_clear_stale_shipping_when_received_or_na(self):
        with Session(self.engine) as db:
            row = db.get(models.ProcurementItem, self.items[0]); row.status = 'ordered'; row.shipment_status = 'delivered'; row.expected_on = '2026-09-01'
            other = db.get(models.ProcurementItem, self.items[1]); other.status = 'ordered'; other.expected_on = '2026-09-01'
            db.commit()
        reasons = self.assert_attention_surfaces(self.items[:2])
        self.assertEqual(reasons[self.items[0]], ['网站送达待确认'])
        self.assertEqual(reasons[self.items[1]], ['预计日期已过，待核实'])
        with Session(self.engine) as db:
            row = db.get(models.ProcurementItem, self.items[0]); row.status = 'received'
            other = db.get(models.ProcurementItem, self.items[1]); other.status = 'na'; other.follow_up = 'Historical followup'
            db.commit()
        self.assert_attention_surfaces([])
        with Session(self.engine) as db:
            row = db.get(models.ProcurementItem, self.items[0]); row.follow_up = 'Synthetic missing accessory'; db.commit()
        self.assertEqual(self.assert_attention_surfaces([self.items[0]])[self.items[0]], ['Synthetic missing accessory'])

    def test_worklist_selection_is_shared_and_does_not_change_completion_or_history(self):
        url = f'/api/projects/{self.pid}/procurement'
        initial_payload = self.client.get(url).json()
        initial = initial_payload['items']
        self.assertEqual(len(initial), 37)
        self.assertFalse(any(i['in_worklist'] for i in initial))
        with Session(self.engine) as db:
            task = db.get(models.Task, self.task_id)
            original_task = (task.version, task.exec_status, task.requirement_version)
        picked = [initial[0], next(i for i in initial if i['wave'] != initial[0]['wave'])]
        body = {'items': [{'id': i['id'], 'updated_at': i['updated_at'], 'selected': True} for i in picked]}
        saved = self.client.post(url + '/worklist', json=body)
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()['summary'], initial_payload['summary'])
        shared = self.clients['second'].get('/api/me/procurement-tracking').json()['items']
        self.assertEqual({i['id'] for i in shared if i['in_worklist']}, {i['id'] for i in picked})
        with Session(self.engine) as db:
            task = db.get(models.Task, self.task_id)
            self.assertEqual((task.version, task.exec_status, task.requirement_version), original_task)
            from app.procurement_workflow import purchase_progress
            self.assertEqual(purchase_progress(db, self.pid)['total'], 37)
            self.assertFalse(purchase_progress(db, self.pid)['complete'])
        current = self.material(picked[0]['id'])
        self.assertEqual(self.client.post(url + '/worklist', json={'items': [{'id': current['id'], 'updated_at': current['updated_at'], 'selected': False}]}).status_code, 200)
        self.assertFalse(self.material(picked[0]['id'])['in_worklist'])
        custom = self.client.post(url, json={'name': 'Synthetic extra shelf', 'wave': 'other', 'request_key': str(uuid4())}).json()
        self.assertTrue(next(i for i in custom['items'] if i['id'] == custom['created_item_id'])['in_worklist'])

    def test_worklist_rejects_unauthorized_stale_and_hidden_order_facts_atomically(self):
        url = f'/api/projects/{self.pid}/procurement/worklist'
        first, second = [self.material(i) for i in self.items[:2]]
        body = {'items': [{'id': i['id'], 'updated_at': i['updated_at'], 'selected': True} for i in [first, second]]}
        for name in ['outsider', 'finance']:
            self.assertEqual(self.clients[name].post(url, json=body).status_code, 403)
        wrong_house = deepcopy(body); wrong_house['items'][0]['id'] = self.other_items[0]
        self.assertEqual(self.client.post(url, json=wrong_house).status_code, 422)
        stale = deepcopy(body); stale['items'][1]['updated_at'] = 'stale'
        self.assertEqual(self.client.post(url, json=stale).status_code, 409)
        self.assertFalse(self.material()['in_worklist'])  # first update was rolled back
        with Session(self.engine) as db:
            db.get(models.Task, self.task_id).assignee_user_id = None; db.commit()
        self.assertEqual(self.client.post(url, json=body).status_code, 409)
        with Session(self.engine) as db:
            db.get(models.Task, self.task_id).assignee_user_id = self.users['buyer']; db.commit()
        self.assertEqual(self.create().status_code, 201)
        ordered = self.material()
        self.assertTrue(ordered['in_worklist'])
        self.assertEqual(self.client.post(url, json={'items': [{'id': ordered['id'], 'updated_at': ordered['updated_at'], 'selected': False}]}).status_code, 409)
        # Legacy requirements remain visible on first load; explicit selection can be changed.
        self.client.patch(f"/api/procurement/{second['id']}", json={'specification': 'Synthetic existing size'})
        self.assertTrue(self.material(second['id'])['in_worklist'])

    def test_material_purchase_writes_are_rejected_by_submitted_keys_atomically(self):
        from app.schemas import LEGACY_PURCHASE_FIELDS
        # Unlinked and linked materials have the same boundary, including explicit clears.
        for linked in (False, True):
            if linked: self.assertEqual(self.create().status_code, 201)
            before = self.material()
            for key in LEGACY_PURCHASE_FIELDS:
                for value in (None, '', False):
                    with self.subTest(linked=linked, field=key, value=value):
                        response = self.client.patch(f'/api/procurement/{self.items[0]}', json={key: value, 'note': 'Must not save'})
                        self.assertEqual(response.status_code, 422, response.text)
                        self.assertIn('订单管理', response.text)
                        self.assertEqual(self.material(), before)
            for change in ({'retailer': 'New vendor'}, {'order_number': 'NEW'}, {'amount': 123.45}, {'quantity': 3},
                           {'status': 'ordered'}, {'status': 'received'}):
                response = self.client.patch(f'/api/procurement/{self.items[0]}', json={**change, 'required_quantity': 9})
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual(self.material(), before)
            # Old clients must not round-trip a full read model as an editable request.
            response = self.client.patch(f'/api/procurement/{self.items[0]}', json={**before, 'note': 'Must not save full object'})
            self.assertEqual(response.status_code, 422, response.text)
            self.assertIn('订单管理', response.text)
            self.assertEqual(self.material(), before)
            # Other read-only/unknown properties cannot disappear silently either.
            self.assertEqual(self.client.patch(f'/api/procurement/{self.items[0]}', json={'order_managed': False}).status_code, 422)
        with Session(self.engine) as db:
            self.assertIsNone(db.get(models.ProcurementItem, self.items[0]).note)
            self.assertIsNone(db.get(models.ProcurementItem, self.items[0]).required_quantity)

    def test_material_creation_rejects_purchase_fields_before_any_rows_or_idempotency_write(self):
        from app.schemas import LEGACY_PURCHASE_FIELDS
        endpoint = f'/api/projects/{self.pid}/procurement'
        for field in LEGACY_PURCHASE_FIELDS:
            for value in (None, '', False):
                response = self.client.post(endpoint, json={'name': 'Must not be created', 'request_key': str(uuid4()), field: value})
                self.assertEqual(response.status_code, 422, response.text)
                self.assertIn('订单管理', response.text)
        for status in ('ordered', 'received'):
            self.assertEqual(self.client.post(endpoint, json={'name': 'Forbidden', 'status': status}).status_code, 422)
        with Session(self.engine) as db:
            self.assertEqual(len(list(db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == self.pid)))), 37)
            self.assertEqual(len(list(db.scalars(select(models.ProcurementRequest)))), 0)
        response = self.client.post(endpoint, json={'name': 'Extra requirement', 'required_quantity': 2, 'budget_amount': 0,
            'needed_on': '2026-10-01', 'unit': 'boxes', 'specification': 'Synthetic size', 'use_location': 'Kitchen', 'note': 'Need dimensions'})
        self.assertEqual(response.status_code, 201, response.text)
        row = next(i for i in response.json()['items'] if i['id'] == response.json()['created_item_id'])
        self.assertEqual(row['status'], 'pending_spec'); self.assertEqual(row['budget_amount'], 0)
        self.assertIsNone(row['amount']); self.assertIsNone(row['quantity'])

    def test_orders_override_legacy_purchase_display_without_overwriting_or_counting_it_twice(self):
        legacy = {'retailer': 'Legacy vendor', 'order_number': 'OLD-ONLY', 'amount': 999.99, 'quantity': 12,
                  'status': 'received', 'received_on': '2026-08-01', 'ordered_on': '2026-07-01',
                  'tracking_number': 'OLD-TRACK', 'follow_up': 'Old note'}
        with Session(self.engine) as db:
            row = db.get(models.ProcurementItem, self.items[0])
            for key, value in legacy.items(): setattr(row, key, value)
            db.commit()
        self.assertEqual(self.material()['amount'], 999.99)
        document = deepcopy(self.doc); document['deliveries'] = []
        order = self.create(document).json()
        for key, value in legacy.items(): self.assertEqual(self.material()['legacy_purchase'][key], value)
        self.assertEqual(self.material()['status'], 'ordered')
        self.assertEqual(self.client.patch(f'/api/procurement/{self.items[0]}', json={'note': 'New dimensions', 'budget_amount': 80, 'required_quantity': 6, 'unit': order['document']['lines'][0]['unit']}).status_code, 200)
        partial = self.receive(order, None, '2'); self.assertEqual(partial.status_code, 200, partial.text)
        self.assertEqual(self.material()['status'], 'ordered')
        complete = self.receive(partial.json(), None, '4'); self.assertEqual(complete.status_code, 200, complete.text)
        self.assertEqual(self.material()['status'], 'received')
        with Session(self.engine) as db:
            from app.procurement_workflow import purchase_overview
            overview = purchase_overview(db, self.pid)
            self.assertEqual(Decimal(overview['spent']), Decimal('61.20'))
            self.assertEqual(overview['ready'], 1)
            row = db.get(models.ProcurementItem, self.items[0])
            self.assertEqual({key: getattr(row, key) for key in legacy}, legacy)

    def test_editing_order_preserves_legacy_split_deliveries_receipts_and_replacements(self):
        order = self.create().json()
        order = self.receive(order, 'first', '4').json()
        document = deepcopy(order['document'])
        document['deliveries'].append({'id': 'replacement', 'label': 'Old replacement', 'replacement': True,
            'allocations': [{'line_id': 'lamp', 'quantity': '1'}]})
        order = self.save(order, document).json()
        before = deepcopy(order['document'])
        edit = deepcopy(before); edit['note'] = 'Requirement checked; keep history'
        saved = self.save(order, edit)
        self.assertEqual(saved.status_code, 200, saved.text)
        for field in ('deliveries', 'receipts', 'adjustments'):
            self.assertEqual(saved.json()['document'][field], before[field])

    def test_bulk_and_template_endpoints_do_not_silently_accept_purchase_fields(self):
        row = self.material()
        entry = {'id': row['id'], 'updated_at': row['updated_at']}
        base = f'/api/projects/{self.pid}/procurement'
        for suffix, body in [
            ('/init', {'amount': 1}),
            ('/not-needed', {'items': [entry], 'reason': 'Must not apply', 'amount': 1}),
            ('/not-needed', {'items': [{**entry, 'amount': None}], 'reason': 'Must not apply'}),
            ('/worklist', {'items': [{**entry, 'selected': True}], 'retailer': ''}),
            ('/worklist', {'items': [{**entry, 'selected': True, 'status': 'received'}]}),
        ]:
            response = self.client.post(base + suffix, json=body)
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(self.material(), row)

    def test_collaborator_edits_receives_without_handover_and_unauthorized_writes_fail(self):
        order = self.create().json()
        original_owner = self.clients['manager'].get(f'/api/projects/{self.pid}/tasks/{self.task_id}').json()['assignee']['id']
        collaborator = self.clients['second']
        row = collaborator.get(f'/api/projects/{self.pid}/procurement').json()['items'][0]
        changed = collaborator.patch(f'/api/procurement/{row["id"]}', json={'note':'共同采购需求核对','expected_updated_at':row['updated_at']})
        self.assertEqual(changed.status_code,200,changed.text)
        document = deepcopy(order['document']); document['note'] = 'Collaborator followup'
        response = collaborator.put(f'/api/purchase-orders/{order["id"]}', json={'request_key':str(uuid4()),'expected_version':order['version'],'document':document})
        self.assertEqual(response.status_code,200,response.text); order=response.json()
        body = {'request_key':str(uuid4()),'expected_version':order['version'],
                'receipt':{'id':str(uuid4()),'received_on':datetime.now(ZoneInfo('America/Los_Angeles')).date().isoformat(),'location':'Synthetic site','lines':[{'line_id':'lamp','quantity':'1','damaged_quantity':'0'}]}}
        for name in ('outsider','finance'):
            denied=self.clients[name].post(f'/api/purchase-orders/{order["id"]}/receipts',json=body)
            self.assertEqual(denied.status_code,403,denied.text)
        received=collaborator.post(f'/api/purchase-orders/{order["id"]}/receipts',json=body)
        self.assertEqual(received.status_code,200,received.text)
        self.assertEqual(received.json()['summary']['lines'][0]['usable'],1)
        self.assertEqual(self.clients['manager'].get(f'/api/projects/{self.pid}/tasks/{self.task_id}').json()['assignee']['id'],original_owner)
        self.assertEqual(self.clients['buyer'].get(f'/api/purchase-orders/{order["id"]}').json()['document'],received.json()['document'])

    def test_default_initialization_preserves_existing_orders_receipts_and_events(self):
        from app.routers import projects
        self.app.include_router(projects.router)
        order = self.create().json(); self.assertEqual(self.receive(order,'first','2').status_code,200)
        before = self.client.get(f'/api/purchase-orders/{order["id"]}').json()
        rows = self.client.get(f'/api/projects/{self.pid}/procurement').json()
        response = self.clients['manager'].post('/api/projects',json={'name':'New unrelated house', 'address':{'label':'Synthetic New Road','street':'Synthetic New Road','city':'','state':'CA','zip':''},'create_analysis':False})
        self.assertEqual(response.status_code,201,response.text)
        self.assertEqual(self.client.post(f'/api/projects/{self.pid}/procurement/init').json(),rows)
        self.assertEqual(self.client.get(f'/api/purchase-orders/{order["id"]}').json(),before)
