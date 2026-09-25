/**
 * taskGroups.ts 的测试（KAN-75）。全部离线、不碰 DOM。
 * 跑法：node --test --experimental-strip-types（Node 22 内置）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../api/client.ts';
import { dueText, groupMyTasks, initialsOf, statusActions, statusIndicator } from './taskGroups.ts';

function task(over: Partial<Task>): Task {
  return {
    id: 1, project_id: 1, project_name: 'P', project_address: 'A', step_key: 'view', source: 'template',
    stage_key: 's1', stage_label: '① 预买房', stage_short: '预买房', stage_index: 1,
    project_current_stage_index: 1, project_current_stage_label: '① 预买房',
    title: '看房', ws: null, purpose: null, done_when: null, owners: ['L'], deliverable: null,
    description: null, deliverable_note: null, assignee: null, reviewer: null,
    exec_status: 'not_started', exec_status_label: '未开始', due_at: null, wait_for: null, wait_reason: null, wait_until: null,
    version: 1, satisfied: false, satisfied_how: null, satisfied_evidence: null, evidence_hint: null,
    last_event: null, created_at: '', updated_at: '',
    ...over,
  };
}

test('groupMyTasks：等待、未来段、完成各归各组，其余是现在可做', () => {
  const g = groupMyTasks([
    task({ id: 1, exec_status: 'in_progress' }),
    task({ id: 2, exec_status: 'waiting' }),
    task({ id: 3, stage_index: 3, project_current_stage_index: 1 }),
    task({ id: 4, exec_status: 'done' }),
    task({ id: 5, stage_index: 1, project_current_stage_index: 3 }),
  ]);
  assert.deepEqual(g.now.map((t) => t.id), [1, 5], '更早段没做完的也是现在可做');
  assert.deepEqual(g.waiting.map((t) => t.id), [2]);
  assert.deepEqual(g.later.map((t) => t.id), [3]);
  assert.deepEqual(g.done.map((t) => t.id), [4]);
});

test('groupMyTasks：组内按截止日期升序，没截止的排最后', () => {
  const g = groupMyTasks([task({ id: 1, due_at: null }), task({ id: 2, due_at: '2026-09-30' }), task({ id: 3, due_at: '2026-09-25' })]);
  assert.deepEqual(g.now.map((t) => t.id), [3, 2, 1]);
});

test('statusIndicator：五种状态各有对应，未知值当未开始', () => {
  assert.equal(statusIndicator('not_started'), 'stopped');
  assert.equal(statusIndicator('in_progress'), 'in-progress');
  assert.equal(statusIndicator('waiting'), 'pending');
  assert.equal(statusIndicator('pending_review'), 'pending');
  assert.equal(statusIndicator('done'), 'success');
  assert.equal(statusIndicator('whatever'), 'stopped');
});

test('statusActions：只有负责人本人能动，且按状态给动作', () => {
  const a = { id: 7, username: 'a', display_name: '员工A', role_code: '设计师', active: true };
  assert.deepEqual(statusActions(task({ assignee: a }), 7), ['start', 'wait']);
  assert.deepEqual(statusActions(task({ assignee: a, exec_status: 'in_progress' }), 7), ['wait']);
  assert.deepEqual(statusActions(task({ assignee: a, exec_status: 'waiting' }), 7), ['resume']);
  assert.deepEqual(statusActions(task({ assignee: a }), 8), [], '同角色的另一个账号不能动');
  assert.deepEqual(statusActions(task({ assignee: null }), 7), []);
  assert.deepEqual(statusActions(task({ assignee: a }), null), [], '没登录不能动');
});

test('initialsOf 与 dueText', () => {
  assert.equal(initialsOf({ username: 'person@example.com', display_name: 'Jessie' }), 'J');
  assert.equal(initialsOf({ username: '员工a', display_name: '员工A' }), '员');
  assert.equal(initialsOf(null), '?');
  assert.equal(dueText('2026-09-25'), '09/25');
  assert.equal(dueText(null), '未设定');
});
