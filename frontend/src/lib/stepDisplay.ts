import { systemText } from '../i18n/core.ts';
import { m as uiText } from '../i18n/core.ts';
import type { FileRow, StepItem, Steps } from '../api/client';

/**
 * 把后端已经判定好的事实翻译成一行人话，不做任何推导。
 * 页面只说「后端看到了什么」，不说「进行中 / 等谁 / 逾期 / 卡住」。
 */
export type FactKind =
  | 'site-record' | 'record' | 'doc-present' | 'field-filled'
  | 'manual-no-proof' | 'ticked'
  | 'gate-confirmed' | 'gate-partial' | 'gate-none' | 'gate-void'
  | 'nothing-yet' | 'review-pending' | 'reviewed' | 'record-current';

export interface Fact {
  kind: FactKind;
  /** 一行状态词，业务语言 */
  label: string;
  /** 依据：evidence 原文 / confirmed 名单 / done_by + done_at */
  basis: string[];
  indicator: 'success' | 'warning' | 'error' | 'pending';
  /** evidence_hint 原文，非空才有 */
  hint?: string;
}

/** '2026-06-29T10:21:00' → '06/29'。 */
function mmdd(iso: string | null | undefined): string {
  return iso ? iso.slice(5, 10).replace('-', '/') : '';
}

/** 「J 06/17」这种签名；缺人或缺时间就只留有的那半截。 */
function whoAt(item: StepItem): string {
  return [item.done_by ?? '', mmdd(item.done_at)].filter(Boolean).join(' ');
}

const list = (...xs: (string | null | undefined)[]): string[] => xs.filter((x): x is string => !!x);

export function factOf(item: StepItem): Fact {
  const hint = item.confirmation_mode === 'any' && item.missing?.length
    ? uiText('sentences.missing', { value1: item.missing.map(value => systemText(value)).join(' / ') })
    : item.evidence_hint || undefined;
  const ev = item.evidence;
  const out = (kind: FactKind, label: string, basis: string[], indicator: Fact['indicator']): Fact =>
    hint ? { kind, label: systemText(label), basis, indicator, hint: systemText(hint) } : { kind, label: systemText(label), basis, indicator };

  if (item.review_state==='reviewed') return out('reviewed',uiText('review.reviewed'),list(whoAt(item),ev),'success');
  if (item.review_state==='recheck') return out('review-pending',uiText('review.recheck'),list(ev),'warning');
  if (item.review_state==='pending') return out('review-pending',uiText('review.pending'),list(ev),'pending');
  if (item.counts_as_task===false && item.condition_met) return out('record-current',uiText('review.continuing'),list(ev),'pending');
  if (item.confirmation_mode === 'any') {
    if (item.done) return out('gate-confirmed', uiText('stepsPanel.confirmed'), list(whoAt(item), ev), 'success');
    if (item.needs_review) return out('gate-void', uiText('taskSummaryPanel.prerequisites.changed.review.required'), [], 'warning');
    return out('gate-none', item.ready ? uiText('taskSummaryPanel.awaiting.one.authorized.confirmation') : uiText('taskSummaryPanel.requirements.not.met'), [], 'pending');
  }

  // 一、先看大节点：要具名的人各确认一次。listing 这类 gate=true 但没有确认名单的，不走这里。
  if (item.confirm.length > 0) {
    const missing = item.confirm.filter((c) => !item.confirmed.includes(c));
    if (missing.length === 0) {
      if (item.done) return out('gate-confirmed', uiText("sentences.have.all.confirmed", { value1: (item.confirm.join('、')) }), list(whoAt(item), ev), 'success');
      // 人都确认了但后端仍不算过（例如 final 复检没过）
      return out('gate-void', '确认不成立', list(ev), 'error');
    }
    if (item.confirmed.length > 0) {
      return out('gate-partial', uiText("sentences.confirmed.have.not", { value1: (item.confirmed.join('、')), value2: (missing.join('、')) }), [], 'pending');
    }
    return out('gate-none', '还没有人确认', [uiText("sentences.each.of.must.confirm", { value1: (item.confirm.join('、')) })], 'pending');
  }

  // 二、再看后端怎么判定的
  if (item.how === 'manual_override') {
    return out('manual-no-proof', '有人手工标记完成，没有交付证据', list(ev, whoAt(item)), 'warning');
  }
  if (item.how === 'manual') {
    return out('ticked', '已打勾', list(whoAt(item)), 'success');
  }
  if (item.how === 'auto') {
    const kind = item.deliverable?.kind;
    if (kind === 'photo') {
      const n = item.photo_count;
      return out('site-record', n ? uiText("sentences.site.records.available.photos", { value1: (n) }) : '已有现场记录', list(ev), 'success');
    }
    if (kind === 'file') {
      return out('doc-present', '资料已在项目里', [...list(ev), '按资料类型匹配，不是绑定到这一项'], 'success');
    }
    if (kind === 'field') return out('field-filled', '数据已填', list(ev), 'success');
    // record 以及兜底：后端说有证据，就不能说成「还没有」
    return out('record', '已有记录', list(ev), 'success');
  }

  // 三、后端没判定满足
  const dv = item.deliverable;
  return out('nothing-yet', dv ? uiText("sentences.not.yet.available", { value1: (systemText(dv.label)) }) : '还没有记录', [], 'pending');
}

/**
 * 只列后端真的会拒绝的操作限制（见 routers/steps.py 的 toggle_step）。
 * 「前面段落没做完」「关键节点没过」不是操作限制，不写在这里。
 */
export function limitsOf(item: StepItem, actor: string, canTickAny: boolean, isOwner: boolean): string[] {
  const out: string[] = [];
  if (item.key === 'final' && !item.done) {
    // 后端要求最近一次标 final 的检查是 passed，否则 400
    const passed = item.final_inspection_passed === true;
    if (!passed) out.push('final 检查通过后才能确认');
  }
  if (item.confirm.length === 0) {
    if (item.can_auto && !canTickAny) out.push('这一项要交东西才算满足，不能手工勾');
    else if (!item.can_auto && !isOwner && !canTickAny) out.push(uiText("sentences.responsible.roles.3", { value1: (item.owners.join('、')) }));
  }
  return out.map(value => systemText(value));
}

/** 附件两分：挂到这一项的，和项目里同类型的别的资料。都按上传时间倒序。 */
export function attachmentsFor(item: StepItem, files: FileRow[]): { bound: FileRow[]; byType: FileRow[] } {
  const newest = (a: FileRow, b: FileRow) => (a.uploaded_at < b.uploaded_at ? 1 : a.uploaded_at > b.uploaded_at ? -1 : 0);
  const bound = files.filter((f) => f.step_key === item.key).sort(newest);
  const docType = item.deliverable?.doc_type;
  const byType = docType ? files.filter((f) => f.doc_type === docType && f.step_key !== item.key).sort(newest) : [];
  return { bound, byType };
}

/** 上下文提醒：中性陈述，不是阻塞，也不点名等谁。 */
export function contextNotes(steps: Steps, stageKey: string): string[] {
  const out: string[] = [];
  const stage = steps.stages.find((s) => s.key === stageKey);
  for (const it of stage?.items ?? []) {
    if (!it.gate || it.done || it.confirm.length === 0) continue;
    const missing = it.confirm.filter((c) => !it.confirmed.includes(c));
    out.push(it.confirmed.length
      ? uiText("sentences.milestone.still.needs.confirmation", { value1: (systemText(it.title)), value2: (missing.join('、')) })
      : uiText("sentences.milestone.has.no.confirmations.yet", { value1: (systemText(it.title)) }));
  }
  if (steps.earlier_undone.length > 0) out.push(uiText("sentences.earlier.items.have.not.met.system.requirements", { value1: (steps.earlier_undone.length) }));
  return out.map(value => systemText(value));
}

/**
 * 项目列表/卡片上那一行「阶段」文字（KAN-65）。
 *
 * **唯一依据是 `current_stage`**，也就是六阶段清单算出来的实际业务阶段。
 * 旧的 `stage` / `substage` 两列**不再参与展示**——它们是派生缓存（`steps.py:206-212`
 * 每次读项目都会重算并回写），而 `dictionaries.py:281` 的 `STAGE_TO_LEGACY` 把
 * 「② 买房与过户」直接映射成 `("active","construction")`，于是一套刚 open escrow、
 * 还没过户的房子会在列表上显示「在建 · 施工中」。
 *
 * **线索段是例外，子阶段要留着。** `derive_legacy_stage`（`steps.py:197-203`）只在
 * lead 段保留人工填的 substage（新线索/联系卖家/约看/已出价/谈判中/待成交），
 * 那是真信息，漏斗小组件在用，KAN-50 也要用。非 lead 段的 substage 是查表查出来的，
 * 正是要藏掉的那一个。
 *
 * 所以规则只有两条：
 * - 线索段：`① 预买房 · 已出价`
 * - 其余：`② 买房与过户`
 *
 * 拿不到 `current_stage` 时回落到旧字段——那是接口没返回的异常情况，
 * 显示旧值也好过显示空白，但**不是正常路径**。
 */
export interface GroupPositionLike {
  group_label: string; label: string; sub_key: string | null; lead_substage_label: string | null; frozen_substage_label: string | null; complete: boolean;
}

export function stageText(
  p: { stage: string; substage: string | null; current_stage: { key: string; label: string } | null; group_position?: GroupPositionLike | null },
  meta: { stages: { value: string; label: string }[]; substages: Record<string, { value: string; label: string }[]> } | null | undefined,
): string {
  const sub = (v: string | null) =>
    (meta?.substages?.[p.stage] ?? []).find((s) => s.value === v)?.label ?? v ?? '';

  // KAN-75 块 2：后端给了分组位置就按五格说——「买房 · 未购入 · 已出价」「买房 · escrow 中」「装修」。
  // 底层 s1…s6 仍在 current_stage 里，只是不再直接当标题。
  if (p.group_position) {
    const gp = p.group_position;
    if (gp.complete) return uiText("sentences.process.complete", { value1: (systemText(gp.group_label)) });
    const label = gp.label.split(' · ').map(part => systemText(part)).join(' · ');
    return gp.sub_key === 'pre' && gp.lead_substage_label ? `${label} · ${systemText(gp.lead_substage_label)}` : label;
  }

  if (!p.current_stage) {
    // 兜底：接口没给 current_stage。用旧字段，行为与改动前一致。
    const stage = (meta?.stages ?? []).find((s) => s.value === p.stage)?.label ?? p.stage;
    const s = sub(p.substage);
    return s ? `${stage} · ${s}` : stage;
  }

  // 线索段的子阶段是人工维护的，接着显示；其余段的 substage 是派生值，不显示。
  if (p.stage === 'lead' && p.substage) {
    const s = sub(p.substage);
    if (s) return `${systemText(p.current_stage.label)} · ${s}`;
  }
  return systemText(p.current_stage.label);
}
