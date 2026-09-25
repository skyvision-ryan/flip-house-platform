import type { ProcurementItem, ProcurementPatch } from '../api/client';

export const destinations = [{ value: 'company', label: '公司' }, { value: 'project', label: '房屋地址' }, { value: 'custom', label: '自定义地址' }];
export const procurementFields = ['name', 'wave', 'status', 'note', 'ordered_on', 'expected_on', 'received_on', 'delivery_type', 'delivery_address', 'amount', 'quantity', 'specification', 'product_url', 'retailer', 'order_number', 'order_url', 'carrier', 'tracking_number', 'tracking_url', 'shipment_status', 'follow_up'] as const;
export type ProcurementDraft = Record<typeof procurementFields[number], string>;
export function procurementDraft(item?: Partial<ProcurementItem>): ProcurementDraft {
  return Object.fromEntries(procurementFields.map(key => [key, item?.[key] == null ? (key === 'wave' ? 'other' : key === 'status' ? 'pending_spec' : '') : String(item[key])])) as ProcurementDraft;
}
export function procurementChanges(draft: ProcurementDraft, original: ProcurementDraft): ProcurementPatch {
  const changes: Record<string, string | number | null> = {};
  for (const key of procurementFields) {
    if (draft[key] === original[key]) continue;
    changes[key] = key === 'amount' || key === 'quantity' ? (draft[key].trim() ? Number(draft[key]) : null) : draft[key].trim() || null;
  }
  return changes as ProcurementPatch;
}
export function procurementError(draft: ProcurementDraft): string | null {
  if (!draft.name.trim()) return '请填写材料名称';
  if (draft.amount.trim() && (!Number.isFinite(Number(draft.amount)) || Number(draft.amount) < 0 || Number(draft.amount) > 9999999999 || !/^\d+(\.\d{1,2})?$/.test(draft.amount.trim()))) return '金额需为非负数，最多两位小数';
  if (draft.quantity.trim() && (!Number.isFinite(Number(draft.quantity)) || Number(draft.quantity) <= 0 || Number(draft.quantity) > 1000000)) return '数量需大于 0，且不超过 1,000,000';
  for (const key of ['ordered_on', 'expected_on', 'received_on'] as const) {
    const day = draft[key];
    if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day)) return '日期请按 YYYY-MM-DD 填写有效日期';
  }
  if (draft.ordered_on && [draft.expected_on, draft.received_on].some(day => day && day < draft.ordered_on)) return '预计或实际到货日期不能早于下单日期';
  if (draft.delivery_type === 'custom' && !draft.delivery_address.trim()) return '请填写自定义收货地址';
  for (const key of ['product_url', 'order_url', 'tracking_url'] as const) if (draft[key]) { try { if (!['http:', 'https:'].includes(new URL(draft[key]).protocol)) return '链接须以 https:// 或 http:// 开头'; } catch { return '请填写完整链接'; } }
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

export const shipmentStatuses = [{ value: '', label: '未核实' }, { value: 'not_shipped', label: '尚未发货' }, { value: 'in_transit', label: '运输中' }, { value: 'out_for_delivery', label: '派送中' }, { value: 'delivered', label: '网站显示已送达' }, { value: 'exception', label: '物流异常' }];
export function trackingFlag(item: Partial<ProcurementItem>, today: string): 'attention' | 'upcoming' | 'unverified' | 'other' {
  if (item.status === 'na') return 'other';
  if (item.follow_up?.trim() || item.status === 'exception' || item.shipment_status === 'exception') return 'attention';
  if (item.status === 'received') return 'other';
  if (item.shipment_status === 'delivered' || (item.expected_on && item.expected_on < today)) return 'attention';
  const end = new Date(`${today}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 3);
  if (item.expected_on && item.expected_on <= end.toISOString().slice(0, 10)) return 'upcoming';
  if (item.status === 'ordered' && !item.checked_at) return 'unverified';
  return 'other';
}
export function trackingReason(item: Partial<ProcurementItem>, today: string): string {
  if (item.follow_up) return item.follow_up;
  if (item.status === 'exception' || item.shipment_status === 'exception') return '异常待跟进';
  if (item.status === 'received' || item.status === 'na') return '无待处理事项';
  if (item.shipment_status === 'delivered') return '网站显示送达，待现场核实收货';
  if (item.expected_on && item.expected_on < today) return '预计日期已过，待核实';
  if (trackingFlag(item, today) === 'upcoming') return '未来 3 天预计到货，确认收货安排';
  return item.checked_at ? '按上次人工核对记录跟进' : '尚未人工核对订单';
}

/** Work buckets contain records; they do not create or assign per-item tasks. */
export const procurementWorkGroups = [
  { value: 'all', label: '全部工作' },
  { value: 'selection', label: '选型与规格' },
  { value: 'ordering', label: '准备下单' },
  { value: 'tracking', label: '订单与交期' },
  { value: 'receiving', label: '收货核对' },
  { value: 'exceptions', label: '异常处理' },
  { value: 'closed', label: '已收货 / 不适用' },
];
export function procurementWorkGroup(item: Partial<ProcurementItem>): string {
  if (item.status === 'na') return 'closed';
  if (item.status === 'exception' || item.follow_up?.trim() || item.shipment_status === 'exception') return 'exceptions';
  if (item.status === 'received') return 'closed';
  if (item.status === 'ordered' && ['delivered', 'out_for_delivery'].includes(item.shipment_status ?? '')) return 'receiving';
  if (item.status === 'ordered') return 'tracking';
  return item.status === 'pending_order' ? 'ordering' : 'selection';
}
