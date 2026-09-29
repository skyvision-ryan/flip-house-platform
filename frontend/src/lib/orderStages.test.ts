import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderStages, stageFacts, type ProcurementNode } from './orderStages.ts';
import { newOrder, newLine, type PurchaseOrder, type Delivery } from './purchaseOrders.ts';

// Synthetic legacy batch fixture; normal orders do not create delivery allocations.
const newDelivery = (index: number, address: string): Delivery => ({ id: crypto.randomUUID(), label: `第 ${index} 批`,
  method: 'unknown', replacement: false, allocations: [], destination: 'project', address, contact: '', store: '', expected_on: null,
  appointment: '', carrier: '', tracking_number: '', tracking_url: null, website_status: 'unknown', instructions: '' });


const nodes = [{ value: 'rough', label: '水电检查前' }, { value: 'final', label: 'Final前' }];
const materials: ProcurementNode[] = [{ id: 1, project_id: 1, wave: 'rough', name: '花洒' }, { id: 2, project_id: 1, wave: 'final', name: '地板' },
  { id: 3, project_id: 2, wave: 'rough', name: '其他房花洒' }];
function fixture(): PurchaseOrder {
  const document = newOrder();
  document.total = '150'; document.tax = '10';
  document.lines = [{ ...newLine(2), name: 'Floor A', quantity: '4', unit_price: '10' }, { ...newLine(1), name: 'Shower B', quantity: '1', unit_price: '100' }];
  document.deliveries = [{ ...newDelivery(1, 'Synthetic rough delivery'), expected_on: '2026-09-29', allocations: [{ line_id: document.lines[1].id, quantity: '1' }] }];
  return { id: 1, project_id: 1, project_name: 'Synthetic house', version: 1, updated_at: '', updated_by: '', document,
    summary: { lines: document.lines.map((l, i) => ({ id: l.id, material_id: l.material_id, name: l.name, quantity: l.quantity,
      received: i ? 1 : 0, damaged: 0, returned: 0, usable: i ? 1 : 0, remaining: i ? 0 : 4, amount: i ? 100 : 40 })),
    subtotal: 140, calculated_total: 150, difference: 0, refund: 0, missing: [], complete: false, attention: false } };
}

test('one real order spans nodes without duplicating products or tax', () => {
  const order = fixture(); const before = JSON.stringify(order);
  const groups = orderStages(order.document.lines, 1, materials, nodes);
  assert.deepEqual(groups.map(g => g.value), ['rough', 'final']);
  assert.deepEqual(groups.map(g => g.lines.map(l => l.material?.name)), [['花洒'], ['地板']]);
  assert.equal(JSON.stringify(order), before);
});
test('a received node is not blocked by the other node, and only its own delivery is shown', () => {
  const order = fixture(); const [rough, final] = orderStages(order.document.lines, 1, materials, nodes);
  assert.equal(stageFacts(order, rough).complete, true);
  assert.deepEqual(stageFacts(order, rough).dates, ['2026-09-29']);
  assert.equal(stageFacts(order, final).complete, false);
  assert.deepEqual(stageFacts(order, final).deliveries, []);
});
test('node follows the material assignment; foreign-house material is never silently grouped', () => {
  const order = fixture(); order.document.lines[1].material_id = 3;
  assert.equal(orderStages(order.document.lines, 1, materials, nodes)[1].value, 'unmapped');
  order.document.lines[1].material_id = 2;
  assert.equal(orderStages(order.document.lines, 1, materials, nodes).length, 1);
});
test('all cancelled quantities do not appear as received', () => {
  const order = fixture(); order.document.lines[1].cancelled_quantity = '1';
  const facts = stageFacts(order, orderStages(order.document.lines, 1, materials, nodes)[0]);
  assert.equal(facts.cancelled, true); assert.equal(facts.complete, false);
});
