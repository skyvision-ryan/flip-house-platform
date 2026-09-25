import assert from 'node:assert/strict';
import test from 'node:test';
import { fileRegistrationPatch } from './fileRegistration.ts';

const draft = { doc_type: 'insurance', uploaded_by: '项目助理', doc_date: '2026-09-24', counterparty: 'Synthetic insurer', expires_at: '2027-09-24', amount: '' };

test('assistant and designer edit registration without protected metadata or hidden amount', () => {
  const result = fileRegistrationPatch(draft, false, false);
  assert.deepEqual(result, { doc_date: draft.doc_date, counterparty: draft.counterparty, expires_at: draft.expires_at });
  for (const key of ['doc_type', 'uploaded_by', 'amount', 'step_key']) assert.equal(Object.hasOwn(result, key), false);
});

test('finance can update an invoice amount without changing its type or uploader', () => {
  const result = fileRegistrationPatch({ ...draft, doc_type: 'invoice', uploaded_by: '财务', amount: '0' }, false, true);
  assert.equal(result.amount, 0);
  assert.equal(Object.hasOwn(result, 'doc_type'), false);
  assert.equal(Object.hasOwn(result, 'uploaded_by'), false);
});

test('coordinator retains metadata and explicit empty amount changes', () => {
  const result = fileRegistrationPatch(draft, true, true);
  assert.equal(result.doc_type, 'insurance');
  assert.equal(result.uploaded_by, '项目助理');
  assert.equal(result.amount, null);
  assert.equal(fileRegistrationPatch({ ...draft, amount: '125.50' }, true, true).amount, 125.5);
});

test('clearing editable registration fields preserves explicit nulls', () => {
  const result = fileRegistrationPatch({ ...draft, doc_date: '', counterparty: '', expires_at: '' }, false, false);
  assert.deepEqual(result, { doc_date: null, counterparty: null, expires_at: null });
});
