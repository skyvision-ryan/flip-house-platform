import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requiredNumberError } from './format.ts';
test('required financial input distinguishes blank from actual zero and rejects nonfinite amounts', () => {
  for (const value of ['', '  ', 'NaN', 'Infinity', '12abc']) assert.ok(requiredNumberError(value));
  for (const value of ['0', '0.00', '12.34', '-12.34', ' 100 ']) assert.equal(requiredNumberError(value), undefined);
});
