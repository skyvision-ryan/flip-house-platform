import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  currentAnalysis, dayDifference, holdingDays, investedScale, leadershipMoney,
  leadershipTotals, overdueTasks, reviewAge,
} from './leadershipDesign.ts';
import type { LeadershipAnalysis, LeadershipProject, LeadershipTask } from './leadershipDesign.ts';

const AS_OF = '2026-09-24';
function analysis(patch: Partial<LeadershipAnalysis> = {}): LeadershipAnalysis {
  return {
    id: 'model-current', label: '合成分析', recorded_at: '2026-09-20', current: true,
    missing: [], assumptions: [{ label: '数据来源', value: '合成模型输入', source: '测试数据' }],
    outputs: { total_profit: 25, purchase_total: 100, rehab_total: 20, holding_total: 10,
      selling_total: 5, total_costs: 135, cash_invested: 65, roi_pct: 38.46, sale_price: 160 },
    ...patch,
  };
}
function task(patch: Partial<LeadershipTask> = {}): LeadershipTask {
  return {
    id: 'task-one', title: '合成资料交付', owner: '示例员工', status: 'doing',
    due_date: '2026-09-23', submitted_at: null, wait_reason: null, waiting_for: null,
    ...patch,
  };
}
function project(patch: Partial<LeadershipProject> = {}): LeadershipProject {
  return {
    id: 'synthetic-one', name: 'Synthetic House', stage: '装修', lifecycle: 'active',
    purchase_price: 100, target_arv: 160, budget: 20, expenses: 15,
    purchase_date: '2026-09-01', sale_date: null, sale_price: null, planned_end: '2026-10-30',
    financial_updated_at: '2026-09-20', coordinator: '示例统筹', concern: '合成待核对事项',
    next_action: '核对合成资料', issues: [],
    gate: { title: '合成节点', prerequisite_met: false, d: false, j: false, detail: '未确认' },
    tasks: [], analyses: [analysis()], documents: [], updates: [], ...patch,
  };
}

test('缺买入价或登记支出不当零投入，已登记的零与负数保留', () => {
  assert.equal(investedScale(project({ purchase_price: null })), null);
  assert.equal(investedScale(project({ expenses: null })), null);
  assert.equal(investedScale(project({ purchase_price: 0, expenses: 0 })), 0);
  assert.equal(investedScale(project({ purchase_price: 100, expenses: -5 })), 95);
  assert.equal(investedScale(project({ purchase_price: 0.1, expenses: 0.2 })), 0.3);
  assert.equal(investedScale(project({ lifecycle: 'lead' })), null);
  assert.equal(leadershipMoney(null), '资料未齐');
  assert.equal(leadershipMoney(0), '$0');
  assert.match(leadershipMoney(-5), /-.*5/);
});

test('只取唯一标为 current 的分析，缺 current 不回落到历史版本', () => {
  const old = analysis({ id: 'old', current: false });
  const current = analysis({ id: 'current', recorded_at: '2026-08-01' });
  assert.equal(currentAnalysis(project({ analyses: [] })), null);
  assert.equal(currentAnalysis(project({ analyses: [old] })), null);
  assert.equal(currentAnalysis(project({ analyses: [old, current] })), current);
  assert.equal(currentAnalysis(project({ analyses: [current, old] })), current);
  assert.equal(currentAnalysis(project({ analyses: [current, analysis({ id: 'duplicate-current' })] })), null);
});

test('当前分析缺数据或输出时不借用旧版利润，完整零利润仍计入覆盖', () => {
  const old = analysis({ id: 'old', current: false });
  const missing = project({ id: 'missing', analyses: [old, analysis({ missing: ['预计售价'] })] });
  const noOutput = project({ id: 'no-output', analyses: [old, analysis({ outputs: null })] });
  const historical = project({ id: 'history-only', analyses: [old] });
  const zeroModel = analysis();
  zeroModel.outputs!.total_profit = 0;
  const zero = project({ id: 'zero', analyses: [zeroModel] });
  const totals = leadershipTotals([missing, noOutput, historical, zero], AS_OF);
  assert.equal(totals.active, 4);
  assert.equal(totals.modeled, 1);
  assert.equal(totals.modelProfit, 0);
});

test('多个 current 的歧义项目不进入模型汇总，输入顺序不选出不同利润', () => {
  const first = analysis({ id: 'first' });
  const second = analysis({ id: 'second' });
  second.outputs!.total_profit = 1000;
  for (const analyses of [[first, second], [second, first]]) {
    const totals = leadershipTotals([project({ analyses })], AS_OF);
    assert.equal(totals.modeled, 0);
    assert.equal(totals.modelProfit, 0);
  }
});

test('active 分母与已知投入、模型覆盖分别计数，线索及收尾不混入', () => {
  const ready = project({ tasks: [task({ status: 'review', submitted_at: '2026-09-20T10:00:00' })] });
  const unknownBuy = project({ id: 'unknown-buy', purchase_price: null, analyses: [analysis({ missing: ['买入价'] })] });
  const unknownExpenses = project({ id: 'unknown-expenses', expenses: null, analyses: [] });
  const zero = project({ id: 'zero-investment', purchase_price: 0, expenses: 0, analyses: [] });
  const lead = project({ id: 'lead', lifecycle: 'lead', tasks: [task({ status: 'review' })] });
  const closed = project({ id: 'closed', lifecycle: 'closed', tasks: [task({ status: 'review' })] });
  assert.deepEqual(leadershipTotals([ready, unknownBuy, unknownExpenses, zero, lead, closed], AS_OF), {
    active: 4, modeled: 1, investedKnown: 2, modelProfit: 25, invested: 115,
    overdue: 1, review: 1, closed: 1,
  });
});

test('重复项目不重复计项目、金额、逾期或待审，汇总不修改输入', () => {
  const p = project({ tasks: [task({ status: 'review' })] });
  const closed = project({ id: 'closed', lifecycle: 'closed' });
  const input = [p, structuredClone(p), closed, structuredClone(closed)];
  const original = structuredClone(input);
  assert.deepEqual(leadershipTotals(input, AS_OF), leadershipTotals([p, closed], AS_OF));
  assert.deepEqual(input, original);
});

test('日期严格校验，非法日期、倒序、缺值不生成天数；闰年有效', () => {
  assert.equal(dayDifference('2024-02-28', '2024-03-01'), 2);
  assert.equal(dayDifference('2024-02-29', '2024-03-01'), 1);
  assert.equal(dayDifference('2026-02-28', '2026-03-01'), 1);
  assert.equal(dayDifference(AS_OF, AS_OF), 0);
  for (const invalid of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-9-01', 'invalid', '2026-09-01T00:00:00Z']) {
    assert.equal(dayDifference(invalid, AS_OF), null, invalid);
    assert.equal(dayDifference('2026-01-01', invalid), null, invalid);
  }
  assert.equal(dayDifference('2026-09-25', AS_OF), null);
  assert.equal(dayDifference(null, AS_OF), null);
  assert.equal(dayDifference('2026-09-01', null), null);
});

test('持有天数按生命周期选截至日，计划完工不充当实际结束', () => {
  assert.equal(holdingDays(project(), AS_OF), 23);
  assert.equal(holdingDays(project({ planned_end: '2026-09-05' }), AS_OF), 23);
  assert.equal(holdingDays(project({ lifecycle: 'lead' }), AS_OF), null);
  assert.equal(holdingDays(project({ lifecycle: 'closed', sale_date: '2026-09-10' }), AS_OF), 9);
  assert.equal(holdingDays(project({ lifecycle: 'closed', sale_date: null }), AS_OF), null);
  assert.equal(holdingDays(project({ purchase_date: '2026-09-25' }), AS_OF), null);
  assert.equal(holdingDays(project({ lifecycle: 'closed', sale_date: '2026-08-30' }), AS_OF), null);
});

test('逾期只计未结束且有效截止早于截至日的任务，当天和无日期排除', () => {
  const items = [
    task({ id: 'doing' }), task({ id: 'waiting', status: 'waiting' }),
    task({ id: 'review', status: 'review' }), task({ id: 'todo', status: 'todo' }),
    task({ id: 'done', status: 'done' }), task({ id: 'na', status: 'na' }),
    task({ id: 'today', due_date: AS_OF }), task({ id: 'future', due_date: '2026-09-25' }),
    task({ id: 'missing', due_date: null }), task({ id: 'invalid', due_date: '2026-02-30' }),
  ];
  assert.deepEqual(overdueTasks(project({ tasks: items }), AS_OF).map(item => item.id), ['doing', 'waiting', 'review', 'todo']);
});

test('非法统计截至日不会经字符串比较产生伪逾期', () => {
  for (const invalid of ['not-a-date', '2026-02-30', '2026-9-24', '']) {
    assert.deepEqual(overdueTasks(project({ tasks: [task()] }), invalid), []);
  }
});

test('待审核年龄只来自当前未决提交，完成或退回后的时间不继续累加', () => {
  const submitted = '2026-09-20T10:30:00';
  assert.equal(reviewAge(task({ status: 'review', submitted_at: submitted }), AS_OF), 4);
  assert.equal(reviewAge(task({ status: 'review', submitted_at: `${AS_OF}T10:30:00` }), AS_OF), 0);
  for (const status of ['todo', 'doing', 'waiting', 'done', 'na'] as const) {
    assert.equal(reviewAge(task({ status, submitted_at: submitted }), AS_OF), null);
  }
  for (const submitted_at of [null, '2026-02-30T10:00:00', '2026-09-25T10:00:00']) {
    assert.equal(reviewAge(task({ status: 'review', submitted_at }), AS_OF), null);
  }
});

test('空项目集合的覆盖分母为零，保持未覆盖计数供界面区别无数据', () => {
  assert.deepEqual(leadershipTotals([], AS_OF), {
    active: 0, modeled: 0, investedKnown: 0, modelProfit: 0, invested: 0,
    overdue: 0, review: 0, closed: 0,
  });
});

type DatasetProject = Omit<LeadershipProject, 'analyses'> & {
  analyses: (Omit<LeadershipAnalysis, 'outputs'> & { inputs: Record<string, unknown> })[];
};
const dataset: { as_of: string; projects: DatasetProject[] } = JSON.parse(readFileSync(
  new URL('../../../backend/app/design_previews/leadership_projects.json', import.meta.url), 'utf8',
));

test('董事与 T 共用样例的项目、任务、分析及资料 ID 唯一，日期记录有效', () => {
  const ids = (values: string[]) => assert.equal(new Set(values).size, values.length);
  ids(dataset.projects.map(item => item.id));
  ids(dataset.projects.flatMap(item => item.tasks.map(value => value.id)));
  ids(dataset.projects.flatMap(item => item.analyses.map(value => value.id)));
  ids(dataset.projects.flatMap(item => item.documents.map(value => value.id)));
  assert.equal(dayDifference(dataset.as_of, dataset.as_of), 0);
  for (const item of dataset.projects) {
    assert.equal(item.analyses.filter(value => value.current).length, 1, item.id);
    for (const value of [item.purchase_date, item.sale_date, item.planned_end, item.financial_updated_at,
      ...item.tasks.map(value => value.due_date), ...item.analyses.map(value => value.recorded_at)]) {
      if (value !== null) assert.equal(dayDifference(value, value), 0, `${item.id}: ${value}`);
    }
    for (const value of item.tasks) {
      if (value.status === 'review') assert.notEqual(reviewAge(value, dataset.as_of), null, value.id);
    }
  }
});

test('共用样例保留缺买价、未购入假设及未结算成交三种不同事实', () => {
  const missing = dataset.projects.find(item => item.id === 'maple')!;
  assert.equal(missing.purchase_price, null);
  assert.equal(missing.expenses, 25000);
  assert.ok(missing.analyses.find(value => value.current)!.missing.includes('买入价'));
  const lead = dataset.projects.find(item => item.id === 'elm')!;
  assert.equal(lead.lifecycle, 'lead');
  assert.equal(lead.purchase_price, null);
  assert.equal(lead.purchase_date, null);
  assert.equal(lead.expenses, 0);
  assert.equal(lead.analyses.find(value => value.current)!.inputs.purchase_price, 390000);
  const sold = dataset.projects.find(item => item.id === 'birch')!;
  assert.equal(sold.lifecycle, 'closed');
  assert.equal(sold.sale_price, 425000);
  assert.ok(sold.issues.includes('settlement'));
  assert.match(sold.concern, /未齐|待核对/);
});

test('共用样例 active 投入口径覆盖 3/4 房，逾期任务 4 项与待审 2 项不混收尾', () => {
  // The backend computes analysis outputs. This test deliberately does not invent
  // outputs from input fixtures; it verifies independent recorded-cost/time facts.
  const projects: LeadershipProject[] = dataset.projects.map(item => ({
    ...item, analyses: item.analyses.map(value => ({ ...value, outputs: null })),
  }));
  const totals = leadershipTotals(projects, dataset.as_of);
  assert.equal(totals.active, 4);
  assert.equal(totals.investedKnown, 3);
  assert.equal(totals.invested, 1494000);
  assert.equal(totals.overdue, 4);
  assert.equal(totals.review, 2);
  assert.equal(totals.closed, 1);
  assert.equal(totals.modeled, 0);
});
