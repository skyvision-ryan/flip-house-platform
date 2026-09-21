import { test } from 'node:test';
import assert from 'node:assert';
import type { FileRow, StepItem, Steps } from '../api/client.ts';
import { attachmentsFor, contextNotes, factOf, limitsOf } from './stepDisplay.ts';

// 跑法（Node 22，零依赖）：
//   PATH="/opt/homebrew/opt/node@22/bin:$PATH" node --test --experimental-strip-types frontend/src/lib/stepDisplay.test.ts
//
// 下面的 fixture 除注明「构造」外，都是 2026-09-17 从本地后端
// GET /api/projects/{1,3,9,10}/steps、/api/projects/1/files 原样抄下来的。

const step = (o: Partial<StepItem> & { key: string; title: string }): StepItem => ({
  owners: [], gate: false, confirm: [], confirmed: [], done: false, how: null,
  deliverable: null, evidence_hint: null, evidence: null, can_auto: false,
  done_by: null, done_at: null, note: null, ...o,
});

// ---- 项目 1 ----
const p1Progress = step({
  key: 'progress', title: '施工进度', owners: ['PM'],
  deliverable: { kind: 'photo', label: '进度照片', doc_type: 'photo' },
  done: true, how: 'auto', evidence: '已传 4 张照片（PM 传的）', can_auto: true,
  done_by: 'PM', done_at: '2026-09-07T10:34:00', note: '屋顶完工，厨房水电走线中',
});
const p1HomeInspection = step({
  key: 'home_inspection', title: '房屋检查', owners: ['J'],
  deliverable: { kind: 'file', label: '检验报告', doc_type: 'inspection' },
  done: true, how: 'auto', evidence: '已上传检验报告：检验报告_Midwest Home Inspection.pdf（J 传的）', can_auto: true,
});
const p1Price = step({
  key: 'price', title: '董事会定价、谈价', owners: ['D', 'L'],
  deliverable: { kind: 'field', label: '买入价', field: 'purchase_price' },
  done: true, how: 'auto', evidence: '已填买入价：$185,000', can_auto: true,
});
const p1Inspections = step({
  key: 'inspections', title: '阶段性检查', owners: ['Z'],
  deliverable: { kind: 'record', label: '检查记录', record: 'inspections' },
  done: true, how: 'auto', evidence: '已通过 2 次检查：框架检查、屋顶检查', can_auto: true,
});
const p1Agent = step({
  key: 'agent', title: '选 listing agent', owners: ['J'],
  deliverable: { kind: 'tick', label: '做完打勾' },
  done: true, how: 'manual', done_by: 'J', done_at: '2026-09-09T10:36:00',
});
const p1OpenEscrow = step({
  key: 'open_escrow', title: 'Open escrow（决定买）', owners: ['D', 'J'], gate: true,
  deliverable: { kind: 'confirm', label: '购房合同', field: null, doc_type: 'purchase_contract' },
  evidence_hint: '已传购房合同', confirm: ['D', 'J'], confirmed: ['D', 'J'],
  done: true, how: 'manual', can_auto: true, done_by: 'J', done_at: '2026-06-17T10:49:00',
});
const p1Final = step({
  key: 'final', title: 'final（City 验收通过）', owners: ['D', 'J'], gate: true,
  deliverable: { kind: 'confirm', label: 'final 检查通过', field: null, doc_type: null },
  evidence_hint: '还没有通过的 final 检查', confirm: ['D', 'J'], can_auto: true,
});
// 关键边界：gate=true 但没有确认名单，必须落到 nothing-yet，不能进 gate 分支
const p1Listing = step({
  key: 'listing', title: '上市', owners: ['J'], gate: true,
  deliverable: { kind: 'field', label: '挂牌日期', field: 'list_date' }, can_auto: true,
});

// ---- 项目 9 / 3 / 10 ----
const p9Listing = step({
  key: 'listing', title: '上市', owners: ['J'], gate: true,
  deliverable: { kind: 'field', label: '挂牌日期', field: 'list_date' },
  done: true, how: 'auto', evidence: '已填挂牌日期：2026-09-08', can_auto: true,
});
const p3DesignFinal = step({
  key: 'design_final', title: '设计定稿', owners: ['设计师'],
  deliverable: { kind: 'file', label: '定稿图纸', doc_type: 'drawing_final' },
  done: true, how: 'manual_override', evidence: '设计师 手工确认，没有交付证据', can_auto: true,
  done_by: '设计师', done_at: '2026-06-25T10:42:00',
});
const p3PrepWork = step({
  key: 'prep_work', title: '先干不用 permit 的活', owners: ['PM'],
  deliverable: { kind: 'photo', label: '现场照片', doc_type: 'photo' }, can_auto: true,
});
const p10Start = step({
  key: 'start', title: '可以开工', owners: ['D', 'J'], gate: true,
  deliverable: { kind: 'confirm', label: '开工日期', field: 'construction_start', doc_type: null },
  evidence_hint: '还没填开工日期', confirm: ['D', 'J'], can_auto: true,
});

// ---- 构造的 fixture（种子数据里没有这两种局面）----
// 构造：只有 D 确认过的大节点
const madePartialGate = step({
  ...p1OpenEscrow, confirmed: ['D'], done: false, how: null, done_by: null, done_at: null,
});
// 构造：D、J 都确认了 final，但最近一次 final 复检 failed，后端把门判回不算过
const madeVoidGate = step({
  ...p1Final, confirmed: ['D', 'J'], done: false, how: null,
  evidence: '最近一次 final 检查未通过：final 验收（failed）',
  evidence_hint: '最近一次 final 检查未通过：final 验收（failed）',
});

test('site-record：有照片的现场记录，数量从 evidence 里解析', () => {
  const f = factOf(p1Progress);
  assert.strictEqual(f.kind, 'site-record');
  assert.strictEqual(f.label, '已有现场记录 · 4 张照片');
  assert.deepStrictEqual(f.basis, ['已传 4 张照片（PM 传的）']);
  assert.strictEqual(f.indicator, 'success');
  assert.strictEqual(f.hint, undefined);
});

test('site-record：evidence 里解析不出张数就不带数量', () => {
  const f = factOf(step({ ...p1Progress, evidence: '已传照片（PM 传的）' }));
  assert.strictEqual(f.label, '已有现场记录');
});

test('record：后端记录类证据', () => {
  const f = factOf(p1Inspections);
  assert.strictEqual(f.kind, 'record');
  assert.strictEqual(f.label, '已有记录');
  assert.deepStrictEqual(f.basis, ['已通过 2 次检查：框架检查、屋顶检查']);
  assert.strictEqual(f.indicator, 'success');
});

test('doc-present：资料在项目里，并说明是按类型匹配的', () => {
  const f = factOf(p1HomeInspection);
  assert.strictEqual(f.kind, 'doc-present');
  assert.strictEqual(f.label, '资料已在项目里');
  assert.deepStrictEqual(f.basis, [
    '已上传检验报告：检验报告_Midwest Home Inspection.pdf（J 传的）',
    '按资料类型匹配，不是绑定到这一项',
  ]);
  assert.strictEqual(f.indicator, 'success');
});

test('field-filled：字段已填', () => {
  const f = factOf(p1Price);
  assert.strictEqual(f.kind, 'field-filled');
  assert.strictEqual(f.label, '数据已填');
  assert.deepStrictEqual(f.basis, ['已填买入价：$185,000']);
  assert.strictEqual(f.indicator, 'success');
});

test('field-filled：listing 这种 gate 但没有确认名单的证据门，也走字段分支', () => {
  const f = factOf(p9Listing);
  assert.strictEqual(f.kind, 'field-filled');
  assert.deepStrictEqual(f.basis, ['已填挂牌日期：2026-09-08']);
});

test('manual-no-proof：手工标记完成、没有交付证据', () => {
  const f = factOf(p3DesignFinal);
  assert.strictEqual(f.kind, 'manual-no-proof');
  assert.strictEqual(f.label, '有人手工标记完成，没有交付证据');
  assert.deepStrictEqual(f.basis, ['设计师 手工确认，没有交付证据', '设计师 06/25']);
  assert.strictEqual(f.indicator, 'warning');
});

test('ticked：纯打勾项', () => {
  const f = factOf(p1Agent);
  assert.strictEqual(f.kind, 'ticked');
  assert.strictEqual(f.label, '已打勾');
  assert.deepStrictEqual(f.basis, ['J 09/09']);
  assert.strictEqual(f.indicator, 'success');
});

test('gate-confirmed：名单上的人都确认了，hint 原样带出', () => {
  const f = factOf(p1OpenEscrow);
  assert.strictEqual(f.kind, 'gate-confirmed');
  assert.strictEqual(f.label, 'D、J 都已确认');
  assert.deepStrictEqual(f.basis, ['J 06/17']);
  assert.strictEqual(f.indicator, 'success');
  assert.strictEqual(f.hint, '已传购房合同');
});

test('gate-confirmed：evidence 非空时也进 basis', () => {
  const f = factOf(step({ ...p1Final, confirmed: ['D', 'J'], done: true, how: 'manual', done_by: 'D', done_at: '2026-09-10T09:00:00', evidence: 'final 检查通过：final 验收（2026-09-10）' }));
  assert.deepStrictEqual(f.basis, ['D 09/10', 'final 检查通过：final 验收（2026-09-10）']);
});

test('gate-partial：构造 fixture，只确认了一个人', () => {
  const f = factOf(madePartialGate);
  assert.strictEqual(f.kind, 'gate-partial');
  assert.strictEqual(f.label, 'D 已确认；J 还没确认');
  assert.deepStrictEqual(f.basis, []);
  assert.strictEqual(f.indicator, 'pending');
  assert.strictEqual(f.hint, '已传购房合同');
});

test('gate-none：一个人都还没确认', () => {
  const f = factOf(p1Final);
  assert.strictEqual(f.kind, 'gate-none');
  assert.strictEqual(f.label, '还没有人确认');
  assert.deepStrictEqual(f.basis, ['要 D、J 各确认一次']);
  assert.strictEqual(f.indicator, 'pending');
  assert.strictEqual(f.hint, '还没有通过的 final 检查');
});

test('gate-none：开工门同样判定，hint 是后端原文', () => {
  const f = factOf(p10Start);
  assert.strictEqual(f.kind, 'gate-none');
  assert.deepStrictEqual(f.basis, ['要 D、J 各确认一次']);
  assert.strictEqual(f.hint, '还没填开工日期');
});

test('gate-void：构造 fixture，人都确认了但后端不算过', () => {
  const f = factOf(madeVoidGate);
  assert.strictEqual(f.kind, 'gate-void');
  assert.strictEqual(f.label, '确认不成立');
  assert.deepStrictEqual(f.basis, ['最近一次 final 检查未通过：final 验收（failed）']);
  assert.strictEqual(f.indicator, 'error');
  assert.strictEqual(f.hint, '最近一次 final 检查未通过：final 验收（failed）');
});

test('nothing-yet：还没交东西，说清缺的是什么', () => {
  const f = factOf(p3PrepWork);
  assert.strictEqual(f.kind, 'nothing-yet');
  assert.strictEqual(f.label, '还没有「现场照片」');
  assert.deepStrictEqual(f.basis, []);
  assert.strictEqual(f.indicator, 'pending');
});

test('nothing-yet：gate=true 但没有确认名单的 listing，不许落进 gate 分支', () => {
  const f = factOf(p1Listing);
  assert.strictEqual(f.kind, 'nothing-yet');
  assert.strictEqual(f.label, '还没有「挂牌日期」');
});

test('nothing-yet：没有交付物时说「还没有记录」', () => {
  const f = factOf(step({ key: 'x', title: '某项' }));
  assert.strictEqual(f.kind, 'nothing-yet');
  assert.strictEqual(f.label, '还没有记录');
});

test('limitsOf：final 门没过就列 final 限制', () => {
  assert.deepStrictEqual(limitsOf(p1Final, 'D', false, true), ['final 检查通过后才能确认']);
  assert.deepStrictEqual(limitsOf(madeVoidGate, 'D', false, true), ['final 检查通过后才能确认']);
});

test('limitsOf：final 检查已通过就不再列限制', () => {
  const passed = step({ ...p1Final, evidence: 'final 检查通过：final 验收（2026-09-10）', evidence_hint: 'final 检查通过：final 验收（2026-09-10）' });
  assert.deepStrictEqual(limitsOf(passed, 'D', false, true), []);
});

test('limitsOf：普通大节点没有「要交东西」的限制', () => {
  assert.deepStrictEqual(limitsOf(p1OpenEscrow, 'PM', false, false), []);
  assert.deepStrictEqual(limitsOf(p10Start, 'PM', false, false), []);
});

test('limitsOf：有自动证据的项不能手工勾；能手工勾的身份不受限', () => {
  assert.deepStrictEqual(limitsOf(p3PrepWork, 'PM', false, true), ['这一项要交东西才算满足，不能手工勾']);
  assert.deepStrictEqual(limitsOf(p3PrepWork, '负责人', true, false), []);
});

test('limitsOf：纯打勾项只由负责人勾', () => {
  assert.deepStrictEqual(limitsOf(p1Agent, 'PM', false, false), ['这一项由 J 负责']);
  assert.deepStrictEqual(limitsOf(p1Agent, 'J', false, true), []);
  assert.deepStrictEqual(limitsOf(p1Agent, '负责人', true, false), []);
});

// ---- 附件：项目 1 的 9 张照片（看房 3、清理拆除 2、进度 4）+ 一份检验报告 ----
const file = (o: Partial<FileRow> & { id: number; filename: string }): FileRow => ({
  project_id: 1, mime: 'image/png', size: 70, doc_type: 'photo', stage: '通用',
  doc_date: null, counterparty: null, amount: null, source: 'upload', uploaded_by: 'PM',
  step_key: null, expires_at: null, uploaded_at: '2026-09-17T13:31:20', ...o,
});
const p1Files: FileRow[] = [
  file({ id: 2, filename: '检验报告_Midwest Home Inspection.pdf', mime: 'application/pdf', size: 193, doc_type: 'inspection', stage: '买入', uploaded_by: 'J', doc_date: '2026-06-20', source: 'lark' }),
  file({ id: 16, filename: '看房_1.png', step_key: 'view', uploaded_by: 'L', doc_date: '2026-06-09' }),
  file({ id: 17, filename: '看房_2.png', step_key: 'view', uploaded_by: 'L', doc_date: '2026-06-09' }),
  file({ id: 18, filename: '看房_3.png', step_key: 'view', uploaded_by: 'L', doc_date: '2026-06-09' }),
  file({ id: 19, filename: '清理拆除_1.png', step_key: 'prep_work', doc_date: '2026-07-19' }),
  file({ id: 20, filename: '清理拆除_2.png', step_key: 'prep_work', doc_date: '2026-07-19' }),
  file({ id: 21, filename: '进度_1.png', step_key: 'progress', doc_date: '2026-09-07' }),
  file({ id: 22, filename: '进度_2.png', step_key: 'progress', doc_date: '2026-09-07' }),
  file({ id: 23, filename: '进度_3.png', step_key: 'progress', doc_date: '2026-09-07' }),
  file({ id: 24, filename: '进度_4.png', step_key: 'progress', doc_date: '2026-09-07' }),
];

test('attachmentsFor：进度项挂了 4 张，同类照片另有 5 张', () => {
  const { bound, byType } = attachmentsFor(p1Progress, p1Files);
  assert.deepStrictEqual(bound.map((f) => f.id), [21, 22, 23, 24]);
  assert.deepStrictEqual(byType.map((f) => f.id), [16, 17, 18, 19, 20]);
});

test('attachmentsFor：没有 doc_type 的交付物不出同类资料', () => {
  const { bound, byType } = attachmentsFor(p1Agent, p1Files);
  assert.deepStrictEqual(bound, []);
  assert.deepStrictEqual(byType, []);
});

test('attachmentsFor：文件类交付物按 doc_type 命中项目里的资料', () => {
  const { bound, byType } = attachmentsFor(p1HomeInspection, p1Files);
  assert.deepStrictEqual(bound, []);
  assert.deepStrictEqual(byType.map((f) => f.id), [2]);
});

test('attachmentsFor：两组都按上传时间倒序（构造出不同的 uploaded_at）', () => {
  const made: FileRow[] = [
    file({ id: 101, filename: '旧_挂本项.png', step_key: 'progress', uploaded_at: '2026-09-01T08:00:00' }),
    file({ id: 102, filename: '新_挂本项.png', step_key: 'progress', uploaded_at: '2026-09-15T08:00:00' }),
    file({ id: 103, filename: '旧_同类.png', step_key: 'view', uploaded_at: '2026-09-02T08:00:00' }),
    file({ id: 104, filename: '新_同类.png', step_key: 'view', uploaded_at: '2026-09-16T08:00:00' }),
  ];
  const { bound, byType } = attachmentsFor(p1Progress, made);
  assert.deepStrictEqual(bound.map((f) => f.id), [102, 101]);
  assert.deepStrictEqual(byType.map((f) => f.id), [104, 103]);
});

// ---- 上下文提醒 ----
const stage = (key: string, label: string, items: StepItem[]) => ({
  key, label, short: label, items, done_count: items.filter((i) => i.done).length, total: items.length,
  gate_title: null, gate_done: false, gate_confirmed: [], gate_at: null,
});
const mkSteps = (stages: ReturnType<typeof stage>[], earlier: Steps['earlier_undone']): Steps => ({
  stages, current_stage: { key: stages[0].key, label: stages[0].label },
  next_up: [], earlier_undone: earlier, stage_progress: [],
});

const p1S3Start = step({ ...p10Start, confirmed: ['D', 'J'], done: true, how: 'manual', done_by: 'J', done_at: '2026-07-12T10:00:00' });

test('contextNotes：本段没过的关键节点，没人确认', () => {
  const steps = mkSteps([stage('s3', '③ 装修', [p1S3Start, p1Progress, p1Final])], []);
  assert.deepStrictEqual(contextNotes(steps, 's3'), ['本段关键节点「final（City 验收通过）」还没有人确认']);
});

test('contextNotes：确认了一半就说还差谁', () => {
  const steps = mkSteps([stage('s1', '① 预买房', [madePartialGate])], []);
  assert.deepStrictEqual(contextNotes(steps, 's1'), ['本段关键节点「Open escrow（决定买）」还差 J 确认']);
});

test('contextNotes：没有确认名单的 gate 不进提醒', () => {
  const steps = mkSteps([stage('s4', '④ 卖房准备', [p1Listing, p1Agent])], []);
  assert.deepStrictEqual(contextNotes(steps, 's4'), []);
});

test('contextNotes：前面段落未判定满足的条数（项目 3 的真实值是 3）', () => {
  const earlier = [
    { key: 'loan_start', title: '开始贷款、买保险', owners: ['K'], stage: '② 买入' },
    { key: 'loan_doc', title: '签 loan doc', owners: ['K'], stage: '② 买入' },
    { key: 'utilities', title: '开水电瓦斯', owners: ['K'], stage: '② 买入' },
  ];
  const steps = mkSteps([stage('s3', '③ 装修', [p3PrepWork])], earlier);
  assert.deepStrictEqual(contextNotes(steps, 's3'), ['前面段落还有 3 项系统未判定满足']);
});

test('contextNotes：段落不存在就是空', () => {
  assert.deepStrictEqual(contextNotes(mkSteps([stage('s1', '① 预买房', [])], []), 's9'), []);
});
