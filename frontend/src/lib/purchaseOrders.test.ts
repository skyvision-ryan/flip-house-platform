import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newOrder, newLine, importDocument, reconcile, orderAttention, refundedAfterAdjustment, adjustmentRefundTotal, orderTitle, lineStatus, nextExpected, arrivalChip, sortOrdersForList, type PurchaseOrder, type Delivery, type OrderSummary } from './purchaseOrders.ts';

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
test('per-line refunds total automatically; a manual order total is raised only when it would undercut the records', () => {
  const doc = newOrder(); const line = { ...newLine(1), name: 'Lamp', quantity: '2' }; doc.lines = [line];
  const first = { id: 'a', line_id: line.id, returned_quantity: '1', returned_usable_quantity: '1', refund: '10.00', occurred_on: '2026-10-01', reason: 'Wrong size' };
  const second = { ...first, id: 'b', refund: '4.50' };
  assert.deepEqual(refundedAfterAdjustment(doc, first), { refunded: null, raised: false });
  doc.adjustments = [first]; doc.refunded = '12.00';
  assert.deepEqual(refundedAfterAdjustment(doc, second), { refunded: '14.50', raised: true });
  doc.refunded = '20.00';
  assert.deepEqual(refundedAfterAdjustment(doc, second), { refunded: '20.00', raised: false });
  assert.equal(adjustmentRefundTotal([first, { ...second, refund: null }]), 10);
});

const fact = (id: string, patch: Partial<OrderSummary['lines'][number]> = {}): OrderSummary['lines'][number] => ({ id, material_id: 1, name: id, quantity: '4', received: '0', damaged: '0', returned: '0', usable: '0', remaining: '4', amount: null, ...patch });
const fixtureOrder = (lines: { expected_on: string | null; remaining: string | null; cancelled?: string }[], patch: Partial<PurchaseOrder> = {}): PurchaseOrder => {
  const doc = newOrder();
  doc.lines = lines.map((l, i) => ({ ...newLine(1), id: `l${i}`, name: `Line ${i}`, quantity: '4', cancelled_quantity: l.cancelled ?? '0', expected_on: l.expected_on }));
  const summary = { missing: [], difference: 0, subtotal: null, calculated_total: null, refund: 0, attention: false, complete: lines.every(l => l.remaining === '0'),
    lines: lines.map((l, i) => fact(`l${i}`, { remaining: l.remaining, received: l.remaining === '0' ? '4' : '0', usable: l.remaining === '0' ? '4' : '0' })) };
  return { id: 1, project_id: 1, project_name: 'Fixture', version: 1, document: doc, summary, updated_at: '2026-10-01T10:00:00', updated_by: 'Fixture', ...patch };
};
test('order title falls back to merchant and order number', () => {
  assert.equal(orderTitle({ title: '  Kitchen lights  ', vendor: 'Amazon', order_number: '1' }), 'Kitchen lights');
  assert.equal(orderTitle({ title: '', vendor: 'Amazon', order_number: '111-222' }), 'Amazon · 111-222');
  assert.equal(orderTitle({ vendor: 'Home Depot', order_number: 'W9' }), 'Home Depot · W9');
});
test('line status reads the receiving summary, never the merchant website status', () => {
  const line = { quantity: '4', cancelled_quantity: '0' };
  assert.equal(lineStatus(fact('a'), line), 'pending');
  assert.equal(lineStatus(fact('a', { received: '1', usable: '1', remaining: '3' }), line), 'partial');
  assert.equal(lineStatus(fact('a', { received: '4', usable: '4', remaining: '0' }), line), 'received');
  assert.equal(lineStatus(fact('a', { received: '4', returned: '4', usable: '0', remaining: '4' }), line), 'returned');
  assert.equal(lineStatus(fact('a', { remaining: '0' }), { quantity: '4', cancelled_quantity: '4' }), 'cancelled');
  assert.equal(lineStatus(fact('a', { quantity: null, remaining: null }), { quantity: null, cancelled_quantity: '0' }), 'pending');
});
test('next expected arrival ignores received and cancelled lines and includes open delivery batches', () => {
  const order = fixtureOrder([{ expected_on: '2026-10-03', remaining: '0' }, { expected_on: '2026-10-09', remaining: '2' }, { expected_on: '2026-10-05', remaining: '4', cancelled: '4' }]);
  assert.equal(nextExpected(order), '2026-10-09');
  order.document.deliveries = [{ ...newDelivery(1, 'Site'), expected_on: '2026-10-07', allocations: [{ line_id: 'l1', quantity: '2' }] }];
  assert.equal(nextExpected(order), '2026-10-07');
  order.document.receipts = [{ id: 'r', delivery_id: order.document.deliveries[0].id, received_on: '2026-10-06', location: 'Site', lines: [{ line_id: 'l1', quantity: '2', damaged_quantity: '0' }], note: '', confirmed_by: 1, confirmed_name: 'Fixture', recorded_at: '', void_reason: '' }];
  assert.equal(nextExpected(order), '2026-10-09');
  assert.equal(nextExpected(fixtureOrder([{ expected_on: '2026-10-03', remaining: '0' }])), null);
  assert.equal(nextExpected(fixtureOrder([{ expected_on: null, remaining: '4' }])), null);
});
test('arrival chip says due today or how many days overdue, only while something is outstanding', () => {
  assert.deepEqual(arrivalChip(fixtureOrder([{ expected_on: '2026-10-09', remaining: '2' }]), '2026-10-09'), { kind: 'today' });
  assert.deepEqual(arrivalChip(fixtureOrder([{ expected_on: '2026-10-01', remaining: '2' }]), '2026-10-09'), { kind: 'overdue', days: 8 });
  assert.equal(arrivalChip(fixtureOrder([{ expected_on: '2026-10-12', remaining: '2' }]), '2026-10-09'), null);
  assert.equal(arrivalChip(fixtureOrder([{ expected_on: '2026-10-01', remaining: '0' }]), '2026-10-09'), null);
});
test('order list puts outstanding dated orders first by arrival, then undated, then received orders', () => {
  const orders = [
    fixtureOrder([{ expected_on: '2026-10-03', remaining: '0' }], { id: 1, updated_at: '2026-10-05T00:00:00' }),
    fixtureOrder([{ expected_on: null, remaining: '2' }], { id: 2, updated_at: '2026-10-02T00:00:00' }),
    fixtureOrder([{ expected_on: '2026-10-12', remaining: '2' }], { id: 3 }),
    fixtureOrder([{ expected_on: '2026-10-08', remaining: '2' }], { id: 4 }),
    fixtureOrder([{ expected_on: null, remaining: '2' }], { id: 5, updated_at: '2026-10-04T00:00:00' }),
  ];
  assert.deepEqual(sortOrdersForList(orders).map(o => o.id), [4, 3, 5, 2, 1]);
});
