import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderFormErrors, receiptFormErrors, adjustmentFormErrors, procurementReturnTo, procurementSaveError } from './procurementForm.ts';
import { newOrder, newLine, type Receipt, type Adjustment } from './purchaseOrders.ts';
test('unknown and zero costs stay distinct; malformed order inputs have field feedback', () => {
  const doc = newOrder(); doc.vendor = 'Synthetic shop'; doc.order_number = 'TEST-1';
  doc.lines = [{...newLine(1), name:'Synthetic item', quantity:'2'}];
  assert.deepEqual(orderFormErrors(doc, 'rough'), {});
  doc.total = '0'; doc.lines[0].unit_price = '0'; assert.deepEqual(orderFormErrors(doc, 'rough'), {});
  doc.lines[0].quantity = '-1'; doc.lines[0].expected_on = '2026-02-30'; doc.vendor = ' ';
  const errors = orderFormErrors(doc, ''); assert.ok(errors.stage && errors.vendor && errors[`${doc.lines[0].id}.date`] && errors[`${doc.lines[0].id}.quantity`]);
  doc.lines[0].quantity = null; assert.equal(orderFormErrors(doc)[`${doc.lines[0].id}.quantity`], undefined);
});
test('receipt feedback distinguishes no receipt, invalid damaged quantity and valid partial receipt', () => {
  const receipt = {received_on:'2026-09-28',location:'Synthetic house',lines:[{line_id:'a',quantity:'0',damaged_quantity:'0'}]} as Receipt;
  assert.ok(receiptFormErrors(receipt).lines);
  receipt.lines[0].quantity = '2'; receipt.lines[0].damaged_quantity = '3'; assert.ok(receiptFormErrors(receipt)['a.damaged']);
  receipt.lines[0].damaged_quantity = '1'; assert.deepEqual(receiptFormErrors(receipt), {});
  receipt.lines[0].quantity = ''; assert.ok(receiptFormErrors(receipt)['a.quantity']);
});
test('return keeps house, filter and expanded row without accepting unrelated URLs', () => {
  const href='/procurement?project=3&node=rough&item=80&q=lamp&attention=1';
  assert.equal(procurementReturnTo(href,'3'),href);
  for (const href of ['//example.com','/finance','https://example.com','/procurement-else']) assert.equal(procurementReturnTo(href,'3'),'/procurement?project=3');
});

test('API validation feedback hides payload details and retains the actionable reason', () => {
  const raw = JSON.stringify([{msg:'Value error, 收货数量超过尚需补齐数量',input:{vendor:'synthetic-private-payload'}},{msg:'Value error, 收货数量超过尚需补齐数量'}]);
  assert.equal(procurementSaveError(new Error(raw)), '收货数量超过尚需补齐数量');
  assert.equal(procurementSaveError(new Error('订单已被其他人更新，请重新载入')), '订单已被其他人更新，请重新载入');
});

test('line and order links must be http(s); blank links are allowed', () => {
  const doc = newOrder(); doc.vendor = 'Synthetic shop'; doc.order_number = 'TEST-2';
  doc.lines = [{ ...newLine(1), name: 'Synthetic item', quantity: '1', product_url: 'https://example.com/p/1', image_url: null, tracking_url: '' }];
  assert.deepEqual(orderFormErrors(doc, 'rough'), {});
  doc.lines[0].image_url = 'example.com/img.jpg'; doc.order_url = 'ftp://example.com/order';
  const errors = orderFormErrors(doc, 'rough');
  assert.ok(errors[`${doc.lines[0].id}.image_url`]); assert.ok(errors.order_url); assert.equal(errors[`${doc.lines[0].id}.product_url`], undefined);
});
test('return feedback: beyond received, good beyond returned, refund beyond total, refund-only is valid', () => {
  const doc = newOrder(); doc.total = '50.00'; const line = { ...newLine(1), name: 'Lamp', quantity: '4' }; doc.lines = [line];
  const summary = { id: line.id, material_id: 1, name: 'Lamp', quantity: '4', received: '3', damaged: '1', returned: '0', usable: '2', remaining: '2', amount: '40.00' };
  const base: Adjustment = { id: 'x', line_id: line.id, returned_quantity: '0', returned_usable_quantity: '0', refund: null, occurred_on: '2026-10-01', reason: 'Damaged on arrival' };
  assert.ok(adjustmentFormErrors(base, summary, doc, '2026-10-02').returned);
  assert.deepEqual(adjustmentFormErrors({ ...base, refund: '5.00' }, summary, doc, '2026-10-02'), {});
  assert.ok(adjustmentFormErrors({ ...base, returned_quantity: '4' }, summary, doc, '2026-10-02').returned);
  assert.ok(adjustmentFormErrors({ ...base, returned_quantity: '3', returned_usable_quantity: '3' }, summary, doc, '2026-10-02').usable);
  assert.deepEqual(adjustmentFormErrors({ ...base, returned_quantity: '3', returned_usable_quantity: '2' }, summary, doc, '2026-10-02'), {});
  assert.ok(adjustmentFormErrors({ ...base, refund: '60.00' }, summary, doc, '2026-10-02').refund);
  doc.adjustments = [{ ...base, id: 'earlier', refund: '45.00' }];
  assert.ok(adjustmentFormErrors({ ...base, refund: '6.00' }, summary, doc, '2026-10-02').refund);
  assert.ok(adjustmentFormErrors({ ...base, refund: '1.00', occurred_on: '2026-10-03' }, summary, doc, '2026-10-02').date);
  assert.ok(adjustmentFormErrors({ ...base, refund: '1.00', reason: ' ' }, summary, doc, '2026-10-02').reason);
});
