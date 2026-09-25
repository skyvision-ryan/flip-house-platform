import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planByPerson, planPayload, summarizePlan } from './projectPlan.ts';
import type { PlanStage } from './projectPlan.ts';
const stages: PlanStage[] = [
  { key: 's1', short: '未购入', label: '买房', items: [{ key: 'view', title: '看房', owners: [], evidence: '' }, { key: 'open', title: 'Open escrow', owners: [], evidence: '', gate: true }] },
  { key: 's2', short: 'escrow 中', label: '买房', items: [{ key: 'close_prep', title: '准备过户', owners: [], evidence: '' }] },
  { key: 's3', short: '装修', label: '装修', items: [{ key: 'design', title: '设计', owners: [], evidence: '' }, { key: 'permit', title: 'Permit', owners: [], evidence: '' }] },
];
const plan = { view: { assignee_user_id: 7, due_at: '2026-09-25' }, close_prep: { assignee_user_id: 7, due_at: '' }, design: { assignee_user_id: 8, due_at: '' }, permit: { assignee_user_id: null, due_at: '2026-10-01' }, open: { assignee_user_id: 7, due_at: '' } };

test('当前只指未购入；同组 escrow 仍为后续安排，关键节点不混入分母', () => {
  assert.deepEqual(summarizePlan(stages, plan), { total: 4, assigned: 3, unassigned: 1, current: 1, future: 2, gates: 1, people: [7, 8] });
});
test('同一个员工只出现一份预览，当前与未来任务均保留', () => {
  const users = [{ id: 7, username: 'a', display_name: '员工A', role_code: '设计师', active: true }, { id: 8, username: 'a2', display_name: '员工A2', role_code: '设计师', active: true }];
  const groups = planByPerson(stages, plan, users);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].items[0].future, false);
  assert.equal(groups[0].items[1].future, true);
  assert.equal(groups[1].user?.id, 8);
});
test('只设截止也会保存，空截止发 null，关键节点永不发往普通任务接口', () => {
  const payload = planPayload(stages, plan);
  assert.equal(payload.length, 4);
  assert.equal(payload[1].due_at, null);
  assert.deepEqual(payload[3], { step_key: 'permit', assignee_user_id: null, due_at: '2026-10-01' });
  assert.equal(planPayload(stages, {}).length, 0);
  assert.equal(summarizePlan(stages, {}).unassigned, 4);
});
