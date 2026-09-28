import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newOrder, newLine, importDocument, reconcile, orderAttention, type PurchaseOrder, type Delivery } from './purchaseOrders.ts';

// Synthetic legacy batch fixture; normal orders do not create delivery allocations.
const newDelivery = (index: number, address: string): Delivery => ({ id: crypto.randomUUID(), label: `第 ${index} 批`,
  method: 'unknown', replacement: false, allocations: [], destination: 'project', address, contact: '', store: '', expected_on: null,
  appointment: '', carrier: '', tracking_number: '', tracking_url: null, website_status: 'unknown', instructions: '' });


test('unknown line amounts and charges never silently become zero', () => {
  const doc = newOrder(); doc.lines = [{ ...newLine(1), name: 'Fixture', quantity: '3', unit_price: '0.10' }];
  assert.equal(reconcile(doc).subtotal, 0.3);
  assert.equal(reconcile(doc).calculated, null);
  Object.assign(doc, { tax: '0', shipping: '0', discount: '0', total: '0.30' });
  assert.equal(reconcile(doc).difference, 0);
  doc.lines.push({ ...newLine(2), name: 'Unknown' });
  assert.equal(reconcile(doc).subtotal, null);
  assert.equal(reconcile(doc).missing, 1);
  doc.lines[1].amount = '0'; assert.equal(reconcile(doc).subtotal, 0.3);
});
test('imports retain separate line identities and require material mapping', () => {
  const draft = importDocument({ draft: { vendor: 'Wayfair', order_number: 'SYNTHETIC', lines: [{ name: 'Light' }, { name: 'Light' }] }, evidence: [], warnings: [], existing_order_id: null });
  assert.notEqual(draft.lines[0].id, draft.lines[1].id);
  assert.equal(draft.lines[0].material_id, 0);
  assert.deepEqual(draft.receipts, []);
});
test('website delivery and partial receipts remain actionable; a complete batch clears delivery alert', () => {
  const doc = newOrder(); const line = { ...newLine(1), name: 'Lamp', quantity: '6' }; doc.lines = [line];
  doc.deliveries = [{ ...newDelivery(1, 'Synthetic site'), website_status: 'delivered', allocations: [{ line_id: line.id, quantity: '6' }] }];
  const order = { document: doc, summary: { missing: [], difference: 0, lines: [] } } as unknown as PurchaseOrder;
  assert(orderAttention(order, '2026-09-28').some(s => s.includes('送达待确认')));
  doc.receipts = [{ id: 'r', delivery_id: doc.deliveries[0].id, received_on: '2026-09-28', location: 'Synthetic site', lines: [{ line_id: line.id, quantity: '4', damaged_quantity: '0' }], note: '', confirmed_by: 1, confirmed_name: 'Fixture', recorded_at: '', void_reason: '' }];
  assert(orderAttention(order, '2026-09-28').some(s => s.includes('送达待确认')));
  doc.receipts[0].lines[0].quantity = '6'; assert.equal(orderAttention(order, '2026-09-28').length, 0);
  doc.receipts[0].void_reason = 'Incorrect entry'; assert(orderAttention(order, '2026-09-28').length > 0);
});
test('pickup without tracking and past due followup have meaningful actions', () => {
  const doc = newOrder(); doc.follow_up = 'Call store'; doc.follow_up_on = '2026-09-27';
  doc.deliveries = [{ ...newDelivery(1, 'Synthetic store'), method: 'pickup', website_status: 'ready_pickup' }];
  const order = { document: doc, summary: { missing: [], difference: 0, lines: [] } } as unknown as PurchaseOrder;
  const reasons = orderAttention(order, '2026-09-28');
  assert(reasons.some(r => r.includes('到期跟进'))); assert(reasons.some(r => r.includes('待取货')));
});
