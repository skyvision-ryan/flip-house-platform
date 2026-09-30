import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {ProcurementItem, ProcurementWorkspaceData, Task} from '../api/client';
import type {PurchaseOrder} from './purchaseOrders';
import {houseProcurement, pendingRequirements} from './procurementWorkspace.ts';

const item = (id: number, project_id = 1, extra = {}) => ({id, project_id, status:'pending_spec', in_worklist:true, updated_at:'2026-09-29T10:00:00', attention_reasons:[], ...extra} as ProcurementItem);
test('switching houses scopes requirements, reminders, orders and owner together', () => {
  const data = {items:[item(1), item(2,2,{attention_reasons:['等 Jessie 确认']})], tasks:[{project_id:1,id:11},{project_id:2,id:22}] as Task[]} as ProcurementWorkspaceData;
  const orders = [{project_id:1,id:111},{project_id:2,id:222}] as PurchaseOrder[];
  for (const [id, expected] of [['1',1],['2',2],['1',1]] as const) {
    const house = houseProcurement(data,orders,id);
    assert.deepEqual(house.items.map(i=>i.id),[expected]);
    assert.deepEqual(house.orders.map(i=>i.id),[expected*111]);
    assert.equal(house.task?.id,expected*11);
    assert.equal(house.items.flatMap(i=>i.attention_reasons || []).length,expected===2 ? 1 : 0);
  }
  assert.deepEqual(houseProcurement(data,orders,'999'),{items:[],orders:[],task:undefined});
});
test('pending queue exposes new demand immediately without unread or today inference', () => {
  const rows=[item(1),item(2,1,{status:'pending_order'}),item(3,1,{status:'na',attention_reasons:['Old reason']}),
    item(4,1,{status:'received'}),item(5,1,{in_worklist:false}),item(6,1,{status:'ordered',order_managed:true}),
    item(7,1,{status:'ordered',order_managed:true,attention_reasons:['待补齐']}),item(8,1,{updated_at:'2026-09-30T10:00:00'})];
  assert.deepEqual(pendingRequirements(rows).map(i=>i.id),[8,7,2,1]);
  assert.equal(rows[0].id,1); // sorting cannot mutate the worklist
  assert.deepEqual(pendingRequirements([]),[]);
});
