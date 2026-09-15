import type { StepItem, Steps } from '../api/client';

export type ActionMode = 'upload' | 'field' | 'tick' | 'confirm' | 'navigate' | 'view';

export const FIELD_LABEL: Record<string, string> = {
  purchase_price: '买入价（美元）',
  purchase_date: '买入日期',
  construction_start: '开工日期',
  list_date: '挂牌日期',
  sale_date: '成交日期',
  risks: '风险',
};

type RoleLike = { actor: string; can: (action: string, ...extraOk: string[]) => boolean };

/** 是否轮到当前身份操作（含上传／填数／记录；不含 gate 确认）。 */
export function canActOn(item: StepItem, role: RoleLike): boolean {
  const dv = item.deliverable;
  if (!dv) return false;
  const mine = item.owners.includes(role.actor);
  if (dv.kind === 'tick') return mine || role.can('tick_any');
  if (dv.kind === 'file' || dv.kind === 'photo') return mine || role.can('upload_any');
  if (dv.kind === 'field') return dv.field === 'purchase_price' ? role.can('edit_money') : role.can('edit_project') || mine;
  if (dv.kind === 'record') {
    return mine || role.can(dv.record === 'utilities' ? 'utilities' : dv.record === 'inspections' ? 'inspections' : dv.record === 'procurement' ? 'procurement' : dv.record === 'analyses' ? 'analysis' : 'budget');
  }
  return false;
}

/** 当前身份是否还能对 gate 做确认。 */
export function canConfirm(item: StepItem, role: RoleLike): boolean {
  if (!item.gate && item.deliverable?.kind !== 'confirm') return false;
  return item.confirm.includes(role.actor) || role.can('confirm_for_others')
    ? item.confirm.some((c) => !item.confirmed.includes(c) && (role.actor === c || role.can('confirm_for_others')))
    : false;
}

export function needsMyConfirm(item: StepItem, actor: string): boolean {
  return item.confirm.includes(actor) && !item.confirmed.includes(actor);
}

export function actionMode(item: StepItem, opts?: { forConfirm?: boolean }): ActionMode {
  if (opts?.forConfirm || (item.gate && item.confirm.length > 0) || item.deliverable?.kind === 'confirm') return 'confirm';
  const dv = item.deliverable;
  if (!dv) return 'view';
  if (dv.kind === 'file' || dv.kind === 'photo') return 'upload';
  if (dv.kind === 'field') return 'field';
  if (dv.kind === 'tick') return 'tick';
  if (dv.kind === 'record') return 'navigate';
  return 'view';
}

export function actionLabel(item: StepItem, opts: { actor: string; canDo: boolean; forConfirm?: boolean }): string {
  const mode = actionMode(item, { forConfirm: opts.forConfirm });
  if (mode === 'confirm') return '确认节点';
  if (!opts.canDo && mode !== 'navigate') return '查看';
  const dv = item.deliverable;
  if (mode === 'upload') return dv?.kind === 'photo' ? '交照片' : '交文件';
  if (mode === 'field') {
    const f = dv?.field ?? '';
    if (f.endsWith('_date')) return '填日期';
    if (f === 'risks') return '写风险';
    if (f === 'purchase_price') return '填价格';
    return `填${FIELD_LABEL[f] ?? f}`;
  }
  if (mode === 'tick') return '标完成';
  if (mode === 'navigate') {
    if (dv?.record === 'utilities') return '填水电账户';
    if (dv?.record === 'expenses') return '记支出';
    if (dv?.record === 'procurement') return '管采购';
    if (dv?.record === 'inspections') return '记检查';
    if (dv?.record === 'analyses') return '去算账';
    return '去处理';
  }
  return '查看';
}

/** 深链：打开项目并落到对应动作。 */
export function actionHref(projectId: number, item: StepItem, opts?: { forConfirm?: boolean; action?: string }): string {
  const mode = actionMode(item, { forConfirm: opts?.forConfirm });
  const base = `/projects/${projectId}`;
  const dv = item.deliverable;
  if (mode === 'navigate' && dv?.record === 'utilities') return `${base}?tab=data&section=utilities`;
  if (mode === 'navigate' && dv?.record === 'expenses') return `${base}?tab=budget`;
  if (mode === 'navigate' && dv?.record === 'procurement') return `${base}?tab=budget&section=procurement`;
  if (mode === 'navigate' && dv?.record === 'inspections') return `${base}?tab=overview&focus=inspections`;
  if (mode === 'navigate' && dv?.record === 'analyses') return `${base}?tab=analysis`;
  const action = opts?.action ?? (mode === 'upload' ? 'upload' : mode === 'field' ? 'field' : mode === 'confirm' ? 'confirm' : mode === 'tick' ? 'tick' : undefined);
  const qs = new URLSearchParams({ tab: 'overview', step: item.key });
  if (action) qs.set('action', action);
  return `${base}?${qs.toString()}`;
}

export function statusHint(item: StepItem): string {
  if (item.gate && item.confirm.length > 0) {
    const waiting = item.confirm.filter((c) => !item.confirmed.includes(c));
    if (item.done) return '已确认';
    if (item.confirmed.length) return `等 ${waiting.join('、')} 确认`;
    return `待 ${item.confirm.join('、')} 确认`;
  }
  const dv = item.deliverable;
  if (!dv) return '待处理';
  if (dv.kind === 'file') return `待交：${dv.label}`;
  if (dv.kind === 'photo') return `待交照片：${dv.label}`;
  if (dv.kind === 'field') return `待填：${FIELD_LABEL[dv.field ?? ''] ?? dv.label}`;
  if (dv.kind === 'record') {
    if (dv.record === 'utilities') return '待填水电账户';
    if (dv.record === 'expenses') return '待记支出';
    if (dv.record === 'procurement') return '待处理采购';
    if (dv.record === 'inspections') return '待记检查';
    if (dv.record === 'analyses') return '待算账';
  }
  if (dv.kind === 'tick') return '待标完成';
  return dv.label;
}

/** 完成后 Flashbar 文案。 */
export function nextUpFlash(doneTitle: string, steps: Steps): string {
  const next = steps.next_up[0];
  if (!next) return `已完成「${doneTitle}」。本段暂无下一项。`;
  const who = next.owners.length ? next.owners.join('、') : '相关同事';
  return `已完成「${doneTitle}」。下一位：${who} · ${next.title}`;
}

/** 从 steps 里按 key 找完整 StepItem。 */
export function findStepItem(steps: Steps, key: string): StepItem | null {
  for (const s of steps.stages) {
    const it = s.items.find((i) => i.key === key);
    if (it) return it;
  }
  return null;
}

export function findStageKey(steps: Steps, itemKey: string): string | null {
  for (const s of steps.stages) {
    if (s.items.some((i) => i.key === itemKey)) return s.key;
  }
  return null;
}
