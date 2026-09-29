import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { procurementChanges, procurementDraft, procurementError, deliveryLabel, projectTab, procurementNeedsAttention } from './procurement.ts';

test('requirement requests contain only changed requirement fields, never legacy purchase facts', () => {
  const original = procurementDraft({ name: 'Synthetic sink', status: 'received', amount: 0, ordered_on: '2026-09-22', expected_on: '2026-09-27' });
  assert.equal('amount' in original, false);
  assert.deepEqual(procurementChanges({ ...original, note: 'Confirm dimensions' }, original), { note: 'Confirm dimensions' });
  assert.deepEqual(procurementChanges({ ...original, budget_amount: '0', required_quantity: '3' }, original), { required_quantity: 3, budget_amount: 0 });
  const legacy = { ...original, amount: '', received_on: '2026-09-25', retailer: 'Legacy merchant' };
  assert.deepEqual(procurementChanges(legacy, original), {});
  assert.equal(procurementError(original), null);
});
test('invalid requirement dates, budgets, quantities and unsafe reference URLs cannot be submitted', () => {
  const base = procurementDraft({ name: 'Synthetic material' });
  assert.equal(procurementError(base), null);
  for (const change of [{ name: ' ' }, { budget_amount: '-1' }, { budget_amount: 'NaN' }, { budget_amount: '1.001' }, { budget_amount: '1e20' }, { required_quantity: '0' }, { product_url: 'javascript:alert(1)' }, { needed_on: '2026-02-30' }]) {
    assert.notEqual(procurementError({ ...base, ...change }), null, JSON.stringify(change));
  }
  assert.equal(procurementError({ ...base, budget_amount: '0', product_url: 'https://example.com/item' }), null);
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

test('material attention uses server reasons without reclassifying statuses', () => {
  assert.equal(procurementNeedsAttention({attention_reasons: ['网站送达待确认']}), true);
  assert.equal(procurementNeedsAttention({attention_reasons: []}), false);
});
