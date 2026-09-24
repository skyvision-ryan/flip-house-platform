import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterFinanceRecords, financePreviewTotals } from './financeDesign.ts';
import type { SpecialistPreview } from './roleDesigns.ts';

const preview = JSON.parse(readFileSync(new URL('../../../backend/app/design_previews/sabrina.json', import.meta.url), 'utf8')) as SpecialistPreview;

test('unverified invoice remains separate from registered expenses and budget', () => {
  assert.deepEqual(financePreviewTotals(preview.records), { planned: 21900, registered: 11470, unregistered: 980, remaining: 10430 });
  const unpaid = filterFinanceRecords(preview, '', '待付款核实');
  assert.equal(unpaid.length, 1);
  assert.deepEqual(financePreviewTotals(unpaid), { planned: 1100, registered: 0, unregistered: 980, remaining: 1100 });
});

test('over-budget category stays negative rather than appearing as available cash', () => {
  const cabinet = filterFinanceRecords(preview, 'Studio Cabinets');
  assert.equal(cabinet.length, 1);
  assert.deepEqual(financePreviewTotals(cabinet), { planned: 6500, registered: 6800, unregistered: 0, remaining: -300 });
});

test('house status and case-insensitive search jointly determine displayed totals', () => {
  const cedar = filterFinanceRecords(preview, '  CEDAR  ', '全部', 'cedar');
  assert.equal(cedar.length, 2);
  assert.equal(financePreviewTotals(cedar).registered, 10000);
  const missing = filterFinanceRecords(preview, '', '凭证待补', 'pine');
  assert.equal(missing.length, 1);
  assert.equal(financePreviewTotals(missing).registered, 420);
  assert.deepEqual(filterFinanceRecords(preview, 'Cabinets', '全部', 'oak'), []);
  assert.deepEqual(financePreviewTotals([]), { planned: 0, registered: 0, unregistered: 0, remaining: 0 });
});

test('currency aggregation avoids floating-point residue', () => {
  const rows = [{ ...preview.records[0], amount: 0.1, planned: 0.2 }, { ...preview.records[1], amount: 0.2, planned: 0.2 }];
  assert.deepEqual(financePreviewTotals(rows), { planned: 0.4, registered: 0.3, unregistered: 0, remaining: 0.1 });
});
