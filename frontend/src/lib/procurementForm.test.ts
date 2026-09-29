import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderFormErrors, receiptFormErrors, procurementReturnTo, procurementSaveError } from './procurementForm.ts';
import { newOrder, newLine, type Receipt } from './purchaseOrders.ts';
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
