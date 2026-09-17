import type { FileRow, StepItem, Steps } from '../api/client';

/**
 * 把后端已经判定好的事实翻译成一行人话，不做任何推导。
 * 页面只说「后端看到了什么」，不说「进行中 / 等谁 / 逾期 / 卡住」。
 */
export type FactKind =
  | 'site-record' | 'record' | 'doc-present' | 'field-filled'
  | 'manual-no-proof' | 'ticked'
  | 'gate-confirmed' | 'gate-partial' | 'gate-none' | 'gate-void'
  | 'nothing-yet';

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
  const hint = item.evidence_hint || undefined;
  const ev = item.evidence;
  const out = (kind: FactKind, label: string, basis: string[], indicator: Fact['indicator']): Fact =>
    hint ? { kind, label, basis, indicator, hint } : { kind, label, basis, indicator };

  // 一、先看大节点：要具名的人各确认一次。listing 这类 gate=true 但没有确认名单的，不走这里。
  if (item.confirm.length > 0) {
    const missing = item.confirm.filter((c) => !item.confirmed.includes(c));
    if (missing.length === 0) {
      if (item.done) return out('gate-confirmed', `${item.confirm.join('、')} 都已确认`, list(whoAt(item), ev), 'success');
      // 人都确认了但后端仍不算过（例如 final 复检没过）
      return out('gate-void', '确认不成立', list(ev), 'error');
    }
    if (item.confirmed.length > 0) {
      return out('gate-partial', `${item.confirmed.join('、')} 已确认；${missing.join('、')} 还没确认`, [], 'pending');
    }
    return out('gate-none', '还没有人确认', [`要 ${item.confirm.join('、')} 各确认一次`], 'pending');
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
      const n = ev?.match(/已传\s*(\d+)\s*张照片/)?.[1];
      return out('site-record', n ? `已有现场记录 · ${n} 张照片` : '已有现场记录', list(ev), 'success');
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
  return out('nothing-yet', dv ? `还没有「${dv.label}」` : '还没有记录', [], 'pending');
}

/**
 * 只列后端真的会拒绝的操作限制（见 routers/steps.py 的 toggle_step）。
 * 「前面段落没做完」「关键节点没过」不是操作限制，不写在这里。
 */
export function limitsOf(item: StepItem, actor: string, canTickAny: boolean, isOwner: boolean): string[] {
  const out: string[] = [];
  if (item.key === 'final' && !item.done) {
    // 后端要求最近一次标 final 的检查是 passed，否则 400
    const passed = [item.evidence, item.evidence_hint].some((s) => (s ?? '').startsWith('final 检查通过'));
    if (!passed) out.push('final 检查通过后才能确认');
  }
  if (item.confirm.length === 0) {
    if (item.can_auto && !canTickAny) out.push('这一项要交东西才算满足，不能手工勾');
    else if (!item.can_auto && !isOwner && !canTickAny) out.push(`这一项由 ${item.owners.join('、')} 负责`);
  }
  return out;
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
      ? `本段关键节点「${it.title}」还差 ${missing.join('、')} 确认`
      : `本段关键节点「${it.title}」还没有人确认`);
  }
  if (steps.earlier_undone.length > 0) out.push(`前面段落还有 ${steps.earlier_undone.length} 项系统未判定满足`);
  return out;
}
