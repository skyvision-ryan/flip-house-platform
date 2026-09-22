/**
 * leads.ts 的测试（KAN-50）。全部离线、不碰 DOM。
 * 跑法：node --test --experimental-strip-types（Node 22 内置，零新依赖）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Meta, Project } from '../api/client.ts';
import { UNKNOWN_GROUP, groupBySubstage, heatLabel, isLead, nextUpText } from './leads.ts';

const META = {
  substages: {
    lead: [
      { value: 'new_lead', label: '新线索' },
      { value: 'contacting', label: '联系卖家' },
      { value: 'appointment', label: '约看' },
      { value: 'offer_made', label: '已出价' },
      { value: 'negotiating', label: '谈判中' },
      { value: 'pending', label: '待成交' },
    ],
    active: [{ value: 'construction', label: '施工中' }],
  },
} as unknown as Meta;

/** 只造被测函数用得到的字段。 */
const proj = (over: Partial<Project> = {}) => ({
  id: 1, name: 'p', stage: 'lead', substage: 'new_lead', lead_heat: 'warm_lead',
  current_stage: { key: 's1', label: '① 预买房' }, next_up: [],
  ...over,
} as unknown as Project);

// ---- isLead ----

test('线索 = 当前段停在 s1', () => {
  assert.equal(isLead(proj({ current_stage: { key: 's1', label: '① 预买房' } })), true);
  assert.equal(isLead(proj({ current_stage: { key: 's2', label: '② 买房与过户' } })), false);
  assert.equal(isLead(proj({ current_stage: { key: 'done', label: '全部完成' } })), false);
});

test('判据认 current_stage，不认旧列——这是本票的核心，旧列可能是陈旧的', () => {
  // 实测过的陷阱：sync_legacy_stage 惰性回写，裸列可能落后于真实进度
  const 旧列还没同步 = proj({ stage: 'lead', current_stage: { key: 's2', label: '② 买房与过户' } });
  assert.equal(isLead(旧列还没同步), false, '已经过户了就不是线索，哪怕旧列还写着 lead');

  const 旧列写着在建 = proj({ stage: 'active', current_stage: { key: 's1', label: '① 预买房' } });
  assert.equal(isLead(旧列写着在建), true, 'escrow 还没过就是线索，哪怕旧列写着 active');
});

test('拿不到 current_stage 才回落旧列', () => {
  assert.equal(isLead(proj({ current_stage: null, stage: 'lead' })), true);
  assert.equal(isLead(proj({ current_stage: null, stage: 'active' })), false);
});

// ---- groupBySubstage ----

test('六组按字典顺序返回，空组也在——管线缺口要看得见', () => {
  const gs = groupBySubstage([], META);
  assert.deepEqual(gs.map((g) => g.value), ['new_lead', 'contacting', 'appointment', 'offer_made', 'negotiating', 'pending']);
  assert.deepEqual(gs.map((g) => g.label), ['新线索', '联系卖家', '约看', '已出价', '谈判中', '待成交']);
  assert.ok(gs.every((g) => g.projects.length === 0));
});

test('按 substage 分到对应组', () => {
  const gs = groupBySubstage([
    proj({ id: 1, substage: 'contacting' }),
    proj({ id: 2, substage: 'offer_made' }),
    proj({ id: 3, substage: 'contacting' }),
  ], META);
  const byValue = Object.fromEntries(gs.map((g) => [g.value, g.projects.map((p) => p.id)]));
  assert.deepEqual(byValue.contacting, [1, 3]);
  assert.deepEqual(byValue.offer_made, [2]);
  assert.deepEqual(byValue.appointment, []);
});

test('认不出的子阶段进「待核实」，不能并进「新线索」', () => {
  const gs = groupBySubstage([
    proj({ id: 1, substage: null }),
    proj({ id: 2, substage: 'nonsense' }),
    proj({ id: 3, substage: 'contacting' }),
  ], META);
  const last = gs[gs.length - 1];
  assert.equal(last.value, UNKNOWN_GROUP.value);
  assert.equal(last.label, '待核实');
  assert.deepEqual(last.projects.map((p) => p.id), [1, 2]);
  assert.deepEqual(gs[0].projects, [], '「新线索」不该被塞进认不出的条目');
  const 总数 = gs.reduce((n, g) => n + g.projects.length, 0);
  assert.equal(总数, 3, '分组条数之和必须等于输入条数');
});

test('没有认不出的条目时，不显示「待核实」这一组', () => {
  const gs = groupBySubstage([proj({ substage: 'contacting' })], META);
  assert.equal(gs.length, 6);
  assert.ok(!gs.some((g) => g.value === UNKNOWN_GROUP.value));
});

test('meta 还没加载时返回空数组，不崩', () => {
  assert.deepEqual(groupBySubstage([proj()], null), []);
  assert.deepEqual(groupBySubstage([proj()], {} as Meta), []);
});

// ---- nextUpText ----

test('待办参考取 next_up[0]，事项与负责角色分开返回', () => {
  assert.deepEqual(nextUpText(proj({ next_up: [{ key: 'view', title: '看房', owners: ['L'], gate: false }] } as Partial<Project>)), { task: '看房', roles: 'L' });
  assert.deepEqual(nextUpText(proj({ next_up: [{ key: 'price', title: '董事会定价、谈价', owners: ['D', 'L'], gate: false }] } as Partial<Project>)), { task: '董事会定价、谈价', roles: 'D、L' });
});

test('没有待办就返回 null，让调用方决定怎么显示', () => {
  assert.equal(nextUpText(proj({ next_up: [] })), null);
});

test('有事项但没写负责角色时 roles 为 null', () => {
  assert.deepEqual(nextUpText(proj({ next_up: [{ key: 'x', title: '某事', owners: [], gate: false }] } as Partial<Project>)), { task: '某事', roles: null });
});

test('已出价的房子仍可能显示「看房」——这是证据规则不是业务倒退，所以只能叫「待办参考」', () => {
  // steps.py 按模板顺序取第一条未完成项；「看房」的完成判定是有没有照片。
  // 出价了但没传看房照片，next_up[0] 就还是「看房」。
  const 已出价但没传照片 = proj({
    substage: 'offer_made',
    next_up: [{ key: 'view', title: '看房', owners: ['L'], gate: false }],
  } as Partial<Project>);
  assert.deepEqual(nextUpText(已出价但没传照片), { task: '看房', roles: 'L' });
});

// ---- heatLabel ----

test('热度只认两个已知取值', () => {
  assert.equal(heatLabel(proj({ lead_heat: 'hot_lead' })), '热线索');
  assert.equal(heatLabel(proj({ lead_heat: 'warm_lead' })), '温线索');
  assert.equal(heatLabel(proj({ lead_heat: null })), null);
  assert.equal(heatLabel(proj({ lead_heat: 'cold_lead' })), null, '认不出的值不显示，不猜');
});
