import { m as uiText } from '../i18n/core.ts';
import type { ProcurementItem, ProcurementPatch } from '../api/client';

export const destinations = [{ value: 'company', get label() { return uiText("procurementItemRow.company"); } }, { value: 'project', get label() { return uiText("procurementItemRow.property.address"); } }, { value: 'custom', get label() { return uiText("procurement.custom.address"); } }];
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
  if (!draft.name.trim()) return uiText("procurement.enter.a.material.name");
  if (draft.required_quantity?.trim() && (!Number.isFinite(Number(draft.required_quantity)) || Number(draft.required_quantity) <= 0)) return uiText("procurement.required.quantity.must.be.greater.than.0");
  if (draft.budget_amount?.trim() && (!Number.isFinite(Number(draft.budget_amount)) || Number(draft.budget_amount) < 0 || !/^\d+(\.\d{1,2})?$/.test(draft.budget_amount.trim()))) return uiText("procurement.procurement.budget.must.be.nonnegative.with.no.more.than");
  for (const key of ['needed_on'] as const) {
    const day = draft[key];
    if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day)) return uiText("procurement.enter.a.valid.date.in.yyyy.mm.dd.format");
  }
  for (const key of ['product_url'] as const) if (draft[key]) { try { if (!['http:', 'https:'].includes(new URL(draft[key]).protocol)) return uiText("procurement.links.must.start.with.https.or.http"); } catch { return uiText("procurement.enter.a.complete.link"); } }
  return null;
}
export function deliveryLabel(row: { delivery_type?: string | null; delivery_address?: string | null }): string {
  return destinations.find(d => d.value === row.delivery_type)?.label ?? uiText("procurement.location.not.entered");
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
