import type { ProcurementItem, ProcurementPatch } from '../api/client';

export const destinations = [{ value: 'company', label: '公司' }, { value: 'project', label: '房屋地址' }, { value: 'custom', label: '自定义地址' }];
export const procurementFields = ['name', 'wave', 'status', 'note', 'specification', 'product_url', 'required_quantity', 'unit', 'needed_on', 'budget_amount', 'use_location'] as const;
export type ProcurementDraft = Record<typeof procurementFields[number], string>;
export function procurementDraft(item?: Partial<ProcurementItem>): ProcurementDraft {
  return Object.fromEntries(procurementFields.map(key => [key, item?.[key] == null ? (key === 'wave' ? 'other' : key === 'status' ? 'pending_spec' : '') : String(item[key])])) as ProcurementDraft;
}
export function procurementChanges(draft: ProcurementDraft, original: ProcurementDraft): ProcurementPatch {
  const changes: Record<string, string | number | null> = {};
  for (const key of procurementFields) {
    if (draft[key] === original[key]) continue;
    changes[key] = ['required_quantity', 'budget_amount'].includes(key) ? (draft[key].trim() ? Number(draft[key]) : null) : draft[key].trim() || null;
  }
  return changes as ProcurementPatch;
}
export function procurementError(draft: ProcurementDraft): string | null {
  if (!draft.name.trim()) return '请填写材料名称';
  if (draft.required_quantity?.trim() && (!Number.isFinite(Number(draft.required_quantity)) || Number(draft.required_quantity) <= 0)) return '需求数量需大于 0';
  if (draft.budget_amount?.trim() && (!Number.isFinite(Number(draft.budget_amount)) || Number(draft.budget_amount) < 0 || !/^\d+(\.\d{1,2})?$/.test(draft.budget_amount.trim()))) return '采购项预算需为非负数，最多两位小数';
  for (const key of ['needed_on'] as const) {
    const day = draft[key];
    if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day)) return '日期请按 YYYY-MM-DD 填写有效日期';
  }
  for (const key of ['product_url'] as const) if (draft[key]) { try { if (!['http:', 'https:'].includes(new URL(draft[key]).protocol)) return '链接须以 https:// 或 http:// 开头'; } catch { return '请填写完整链接'; } }
  return null;
}
export function deliveryLabel(row: { delivery_type?: string | null; delivery_address?: string | null }): string {
  return destinations.find(d => d.value === row.delivery_type)?.label ?? '未填地点';
}

/** Retain old procurement bookmarks without rendering unavailable finance tabs. */
export function projectTab(requested: string | null, section: string | null, access: { money: boolean; procurement: boolean; analysis: boolean; data: boolean }): string {
  let tab = requested || 'overview';
  if (tab === 'budget' && (section === 'procurement' || (!access.money && access.procurement))) tab = 'procurement';
  const allowed = ['overview', 'files', ...(access.money ? ['budget'] : []), ...(access.procurement ? ['procurement'] : []), ...(access.analysis ? ['analysis'] : []), ...(access.data ? ['data'] : [])];
  return allowed.includes(tab) ? tab : 'overview';
}

/** Backend owns actionable facts; views only filter and render these reasons. */
export const procurementNeedsAttention = (item: Pick<ProcurementItem, 'attention_reasons'>) => !!item.attention_reasons?.length;
