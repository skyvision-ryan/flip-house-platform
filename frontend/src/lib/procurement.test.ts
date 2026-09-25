import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { procurementChanges, procurementDraft, procurementError, deliveryLabel, projectTab, trackingFlag, trackingReason, procurementWorkGroup } from './procurement.ts';

test('note edits preserve business dates and zero is distinct from missing amount', () => {
  const original = procurementDraft({ name: 'Synthetic sink', amount: 0, ordered_on: '2026-09-22', expected_on: '2026-09-27' });
  assert.equal(original.amount, '0');
  assert.deepEqual(procurementChanges({ ...original, note: 'Call vendor' }, original), { note: 'Call vendor' });
  assert.deepEqual(procurementChanges({ ...original, amount: '' }, original), { amount: null });
  assert.deepEqual(procurementChanges({ ...original, received_on: '2026-09-25' }, original), { received_on: '2026-09-25' });
});
test('invalid dates, addresses, money and unsafe URLs cannot be submitted', () => {
  const base = procurementDraft({ name: 'Synthetic material' });
  assert.equal(procurementError(base), null);
  for (const change of [{ name: ' ' }, { amount: '-1' }, { amount: 'NaN' }, { amount: '1.001' }, { amount: '1e20' }, { quantity: '0' }, { product_url: 'javascript:alert(1)' }, { ordered_on: '2026-02-30' }, { ordered_on: '2026-09-25', expected_on: '2026-09-22' }, { delivery_type: 'custom', delivery_address: '' }]) {
    assert.notEqual(procurementError({ ...base, ...change }), null, JSON.stringify(change));
  }
  assert.equal(procurementError({ ...base, amount: '0', product_url: 'https://example.com/item', delivery_type: 'custom', delivery_address: 'Test warehouse' }), null);
});
test('procurement comparison defaults to A and all layouts share populated fields', () => {
  const preview = JSON.parse(readFileSync(new URL('../../../backend/app/design_previews/procurement.json', import.meta.url), 'utf8'));
  assert.equal(preview.default_design, 'A');
  assert.deepEqual(preview.designs.map((d: { id: string }) => d.id), ['A', 'B', 'C']);
  assert(preview.role_description.includes('同一岗位'));
  for (const row of preview.records) {
    assert(row.procurement);
    assert(deliveryLabel(row.procurement) !== '未填地点');
    assert.equal(procurementError(procurementDraft({ ...row.procurement, name: row.title })), null);
  }
});

test('project procurement bookmarks resolve independently of budget permission', () => {
  const buyer = { money: false, procurement: true, analysis: false, data: true };
  const assistant = { ...buyer, procurement: false };
  assert.equal(projectTab('budget', 'procurement', buyer), 'procurement');
  assert.equal(projectTab('budget', null, buyer), 'procurement');
  assert.equal(projectTab('budget', 'procurement', { ...buyer, money: true }), 'procurement');
  assert.equal(projectTab('budget', null, { ...buyer, money: true }), 'budget');
  assert.equal(projectTab('procurement', null, assistant), 'overview');
  assert.equal(projectTab('unknown', null, buyer), 'overview');
});

test('tracking priorities distinguish site receipt from website status and estimates', () => {
  const today = '2026-09-25';
  assert.equal(trackingFlag({ status: 'ordered', expected_on: '2026-09-24' }, today), 'attention');
  assert.equal(trackingReason({ status: 'ordered', expected_on: '2026-09-24' }, today), '预计日期已过，待核实');
  assert.equal(trackingFlag({ status: 'ordered', shipment_status: 'delivered' }, today), 'attention');
  assert.equal(trackingFlag({ status: 'ordered', expected_on: '2026-09-28' }, today), 'upcoming');
  assert.equal(trackingFlag({ status: 'ordered', expected_on: '2026-09-29' }, today), 'unverified');
  assert.equal(trackingFlag({ status: 'received', expected_on: '2026-09-24' }, today), 'other');
  assert.equal(trackingFlag({ status: 'received', follow_up: 'Check missing part' }, today), 'attention');
  assert.equal(trackingFlag({ status: 'na', follow_up: 'Old note' }, today), 'other');
});

test('work categories aggregate lifecycle records without treating delivery estimates as receipts', () => {
  const cases: [object, string][] = [
    [{ status: 'pending_spec' }, 'selection'], [{ status: 'pending_order' }, 'ordering'],
    [{ status: 'ordered', expected_on: '2026-09-01' }, 'tracking'],
    [{ status: 'ordered', shipment_status: 'delivered' }, 'receiving'],
    [{ status: 'ordered', shipment_status: 'out_for_delivery' }, 'receiving'],
    [{ status: 'received' }, 'closed'], [{ status: 'received', follow_up: 'Missing part' }, 'exceptions'],
    [{ status: 'exception' }, 'exceptions'], [{ status: 'na', follow_up: 'Old note' }, 'closed'],
  ];
  for (const [item, group] of cases) assert.equal(procurementWorkGroup(item), group);
});
