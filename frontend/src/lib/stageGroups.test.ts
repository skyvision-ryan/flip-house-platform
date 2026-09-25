/**
 * stageGroups.ts 的测试（KAN-75 块 2）。全部离线、不碰 DOM。
 * 跑法：node --test --experimental-strip-types（Node 22 内置）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GroupPosition, StageGroup } from '../api/client.ts';
import { filterFromParams, groupFilterOptions, matchesGroupFilter, segmentsOf, stageKeyLabel } from './stageGroups.ts';

const GROUPS: StageGroup[] = [
  { key: 'buying', label: '买房', stages: ['s1', 's2'], subs: [{ key: 'pre', label: '未购入', stage: 's1' }, { key: 'escrow', label: 'escrow 中', stage: 's2' }] },
  { key: 'renovation', label: '装修', stages: ['s3'], subs: [] },
  { key: 'prelisting', label: '预上市', stages: ['s4'], subs: [] },
  { key: 'selling', label: '卖房上市', stages: ['s5'], subs: [] },
  { key: 'closeout', label: '售出收尾', stages: ['s6'], subs: [] },
];
const gp = (over: Partial<GroupPosition>): GroupPosition => ({
  group_key: 'buying', group_label: '买房', group_index: 1, group_count: 5, sub_key: 'pre', sub_label: '未购入',
  lead_substage: 'offer_made', lead_substage_label: '已出价', frozen_substage: null, frozen_substage_label: null, label: '买房 · 未购入', complete: false, ...over,
});

test('segmentsOf：五格，当前一格带子位置，前面已过、后面未到', () => {
  const seg = segmentsOf(GROUPS, gp({ group_key: 'renovation', group_label: '装修', group_index: 3, sub_key: null, sub_label: null, lead_substage_label: null, label: '装修', frozen_substage_label: '待成交' }));
  assert.deepEqual(seg.map((s) => s.state), ['done', 'done', 'current', 'future', 'future']);
  assert.equal(seg[0].note, '过门前档位：待成交', '买房格过了以后仍能看到过门前档位');
  assert.equal(seg[2].note, null);
});

test('segmentsOf：未购入时买房格显示档位；escrow 中显示过门前档位', () => {
  assert.equal(segmentsOf(GROUPS, gp({}))[0].note, '未购入 · 已出价');
  const e = segmentsOf(GROUPS, gp({ sub_key: 'escrow', sub_label: 'escrow 中', lead_substage_label: null, frozen_substage_label: '谈判中', label: '买房 · escrow 中' }));
  assert.equal(e[0].state, 'current');
  assert.equal(e[0].note, 'escrow 中 · 过门前档位：谈判中');
});

test('segmentsOf：全部走完五格都算已过；没数据返回空', () => {
  assert.deepEqual(segmentsOf(GROUPS, gp({ complete: true, group_index: 5 })).map((s) => s.state), ['done', 'done', 'done', 'done', 'done']);
  assert.deepEqual(segmentsOf(GROUPS, null), []);
  assert.deepEqual(segmentsOf(undefined, gp({})), []);
});

test('筛选项与匹配：买房拆成两个子项，其余一组一项', () => {
  const opts = groupFilterOptions(GROUPS);
  assert.deepEqual(opts.map((o) => o.value), ['', 'buying:pre', 'buying:escrow', 'renovation', 'prelisting', 'selling', 'closeout']);
  assert.equal(matchesGroupFilter(gp({}), 'buying:pre'), true);
  assert.equal(matchesGroupFilter(gp({}), 'buying:escrow'), false);
  assert.equal(matchesGroupFilter(gp({ group_key: 'selling' }), 'selling'), true);
  assert.equal(matchesGroupFilter(gp({}), ''), true);
  assert.equal(matchesGroupFilter(null, 'buying:pre'), false);
  assert.equal(filterFromParams('buying', 'pre'), 'buying:pre');
  assert.equal(filterFromParams('renovation', null), 'renovation');
  assert.equal(filterFromParams(null, 'pre'), '');
});

test('stageKeyLabel：六段 key 翻成位置条说法', () => {
  assert.equal(stageKeyLabel(GROUPS, 's1', '① 预买房'), '买房 · 未购入');
  assert.equal(stageKeyLabel(GROUPS, 's2', '② 买房与过户'), '买房 · escrow 中');
  assert.equal(stageKeyLabel(GROUPS, 's5', '⑤ 卖房上市'), '卖房上市');
  assert.equal(stageKeyLabel(null, 's5', '⑤ 卖房上市'), '⑤ 卖房上市');
});
