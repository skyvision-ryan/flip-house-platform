import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProcurementItem } from '../api/client';
import { newOrder, newLine, type PurchaseOrder } from './purchaseOrders.ts';
import { houseOrderTotal, materialPurchaseFacts, materialQuantityFacts } from './procurementSummary.ts';

const item = { id: 1, project_id: 1, status: 'ordered', amount: 999, ordered_on: '2020-01-01' } as ProcurementItem;
function order(id = 1, amount: string | null = '20.00'): PurchaseOrder {
  return { id, project_id: 1, project_name: 'Synthetic house', version: 1, updated_at:'2026-09-29', updated_by:'Buyer',
    document:{ ...newOrder(), ordered_on:'2026-09-20', total:'100.00', lines:[{...newLine(1),id:'line',quantity:'2',unit:'件',amount,expected_on:'2026-10-01'}]},
    summary:{lines:[{id:'line',material_id:1,name:'Synthetic',quantity:'2',received:'1',damaged:'0',returned:'0',usable:'1',remaining:'1',amount}], subtotal:amount,calculated_total:null,difference:null,refund:'0',missing:[],complete:false,attention:false},
  };
}
test('material sums only its order lines, not total, other houses or legacy fields', () => {
  const a=order(),b=order(2,'30'),other=order(3,'900'); other.project_id=2;
  b.document.ordered_on='2026-09-25';
  a.summary.lines.push({...a.summary.lines[0],id:'unrelated',material_id:2,amount:'80'});
  const facts=materialPurchaseFacts(item,[a,b,other]);
  assert.equal(facts.amount,'$50.00'); assert.equal(facts.ordered,'多笔订单');
  assert.deepEqual(facts.orderedDates,['2026-09-20','2026-09-25']);
  assert.equal(facts.progress,'部分到货');
});
test('unknown and zero amounts are distinct, partial totals disclose missing lines', () => {
  assert.equal(materialPurchaseFacts(item,[order(1,null)]).amount,'未填写');
  assert.equal(materialPurchaseFacts(item,[order(1,'0')]).amount,'$0.00');
  const partial=materialPurchaseFacts(item,[order(),order(2,null)]);
  assert.equal(partial.amount,'$20.00'); assert.equal(partial.missing,1);
});
test('purchase, expected and actual receipt dates stay distinct; void receipts ignored', () => {
  const a=order(); a.document.receipts=[{id:'r',delivery_id:null,received_on:'2026-09-28',location:'Site',lines:[{line_id:'line',quantity:'1',damaged_quantity:'0'}],note:'',confirmed_by:1,confirmed_name:'Buyer',recorded_at:'2099-01-01',void_reason:''}];
  a.document.receipts.push({...a.document.receipts[0],id:'void',received_on:'2030-01-01',void_reason:'Mistake'});
  a.document.deliveries=[{id:'d',expected_on:'2026-10-03',allocations:[{line_id:'line',quantity:'1'}]} as any];
  const facts=materialPurchaseFacts(item,[a]);
  assert.equal(facts.ordered,'2026-09-20'); assert.equal(facts.expected,'2026-10-01 至 2026-10-03'); assert.deepEqual(facts.receivedDates,['2026-09-28']);
});
test('manual notes never infer a decision maker or failed shipment; damage does', () => {
  const row={...item, status:'exception', note:'Jessie 确认款式', attention_reasons:['Jessie 确认款式'], amount:null,ordered_on:null};
  const facts=materialPurchaseFacts(row,[]);
  assert.equal(facts.progress,'未下单'); assert.equal(facts.attentionLabel,'需跟进'); assert.equal(facts.attentionTone,'warning');
  const a=order(); a.summary.lines[0].damaged='1';
  assert.equal(materialPurchaseFacts(row,[a]).attentionTone,'error');
  a.summary.lines[0].remaining='0';
  assert.equal(materialPurchaseFacts(row,[a]).attentionTone,'warning');
});
test('old records remain explicitly old without creating order facts', () => {
  const facts=materialPurchaseFacts({...item,status:'received'},[]);
  assert.equal(facts.amount,'未关联订单'); assert.equal(facts.ordered,'旧记录见详情'); assert.equal(facts.progress,'已到货（旧记录）');
  assert.equal(houseOrderTotal([]).label,'—');
});
test('house net subtracts refunds once, material amounts stay unallocated', () => {
  const a=order();a.summary.refund='15';
  assert.equal(houseOrderTotal([a]).label,'$85.00'); assert.equal(materialPurchaseFacts(item,[a]).amount,'$20.00');
  a.document.total=null;assert.equal(houseOrderTotal([a]).label,'未填写');assert.equal(houseOrderTotal([a]).missing,1);
  a.document.total='0'; a.summary.refund='0';assert.equal(houseOrderTotal([a]).label,'$0.00');
});

test('unplaced demand does not confuse pending receipt with a need to buy again',()=>{
  const row={...item,required_quantity:10,unit:'件'}; const a=order(); a.document.lines[0].quantity='10';
  a.summary.lines[0].usable='6';a.summary.lines[0].remaining='4';
  const q=materialQuantityFacts(row,[a]);assert.equal(q.ordered,10);assert.equal(q.received,6);assert.equal(q.pending,4);assert.equal(q.unplaced,0);
  a.document.lines[0].cancelled_quantity='3';assert.equal(materialQuantityFacts(row,[a]).unplaced,3);
  a.document.lines[0].unit='箱';assert.equal(materialQuantityFacts(row,[a]).unplaced,null);
  assert.equal(materialQuantityFacts({...row,required_quantity:null},[a]).unplaced,null);
});
test('unknown and legacy quantities never invent a default order quantity',()=>{
  assert.equal(materialQuantityFacts(item,[]).unplaced,null);
  assert.equal(materialQuantityFacts({...item,required_quantity:5},[]).legacy,true);
  const a=order();a.document.lines[0].quantity=null;assert.equal(materialQuantityFacts({...item,required_quantity:5},[a]).unplaced,null);
});
