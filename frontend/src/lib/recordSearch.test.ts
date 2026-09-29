import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesRecord } from './recordSearch.ts';

test('record lookup matches multiple terms across existing labels without changing source values', () => {
  const values = ['Home Depot', '镜前灯', '2026-09-29', 120];
  assert.equal(matchesRecord(' ＨＯＭＥ  镜前灯 ', values), true);
  assert.equal(matchesRecord('home 地板', values), false);
  assert.equal(matchesRecord('', values), true);
  assert.deepEqual(values, ['Home Depot', '镜前灯', '2026-09-29', 120]);
});
test('unknown values do not masquerade as recorded zero in searches', () => {
  assert.equal(matchesRecord('0', [null, undefined]), false);
  assert.equal(matchesRecord('null', [null]), false);
  assert.equal(matchesRecord('0', [0]), true);
});
