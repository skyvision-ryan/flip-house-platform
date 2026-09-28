export type Numeric = string | number | null;
export interface OrderLine {
  id: string; material_id: number; name: string; specification: string; brand: string; vendor: string; model: string;
  color: string; unit: string; quantity: Numeric; cancelled_quantity: Numeric; unit_price: Numeric;
  amount: Numeric; product_url: string | null; image_url: string | null; expected_on: string | null; needed_on: string | null;
  location: string; selection_note: string; delivery_address?: string | null; issue_note?: string; website_status?: Delivery['website_status']; tracking_url?: string | null;
}
export interface Delivery {
  id: string; label: string; method: 'unknown' | 'shipping' | 'pickup' | 'scheduled'; replacement: boolean;
  allocations: { line_id: string; quantity: Numeric }[]; destination: 'project' | 'company' | 'custom';
  address: string; contact: string; store: string; expected_on: string | null; appointment: string;
  carrier: string; tracking_number: string; tracking_url: string | null;
  website_status: 'unknown' | 'not_shipped' | 'in_transit' | 'ready_pickup' | 'delivered' | 'exception'; instructions: string;
}
export interface Receipt {
  id: string; delivery_id: string | null; received_on: string; location: string;
  lines: { line_id: string; quantity: Numeric; damaged_quantity: Numeric }[];
  note: string; confirmed_by: number; confirmed_name: string; recorded_at: string; void_reason: string;
}
export interface Adjustment {
  id: string; line_id: string; returned_quantity: Numeric; returned_usable_quantity: Numeric;
  refund: Numeric; occurred_on: string; reason: string;
}
export interface OrderDocument {
  vendor: string; order_number: string; seller: string; purchasing_entity: string; buyer_user_id: number | null;
  ordered_on: string | null; order_url: string | null; voucher_url: string | null; currency: 'USD';
  tax: Numeric; shipping: Numeric; discount: Numeric; total: Numeric; refunded?: Numeric; delivery_address?: string; reconciliation_note: string;
  follow_up: string; follow_up_on: string | null; checked_on: string | null; note: string;
  lines: OrderLine[]; deliveries: Delivery[]; receipts: Receipt[]; adjustments: Adjustment[];
}
export interface OrderSummary {
  lines: { id: string; material_id: number; name: string; quantity: Numeric; received: Numeric; damaged: Numeric;
    returned: Numeric; usable: Numeric; remaining: Numeric; amount: Numeric }[];
  subtotal: Numeric; calculated_total: Numeric; difference: Numeric; refund: Numeric;
  missing: string[]; complete: boolean; attention: boolean;
}
export interface PurchaseOrder {
  id: number; project_id: number; project_name: string; version: number; document: OrderDocument;
  summary: OrderSummary; updated_at: string; updated_by: string;
  events?: { version: number; kind: string; actor: string; created_at: string; source_text: string; note: string; document: OrderDocument }[];
}
export interface ImportPreview {
  draft: Partial<Omit<OrderDocument, 'lines'>> & { lines: Partial<OrderLine>[] };
  evidence: { field: string; text: string }[]; warnings: string[]; existing_order_id: number | null;
}
export interface SaveOrder { request_key: string; expected_version?: number; document: OrderDocument; source_text: string; note: string }
export const newLine = (materialId = 0): OrderLine => ({ id: crypto.randomUUID(), material_id: materialId,
  name: '', specification: '', brand: '', vendor: '', model: '', color: '', unit: '件', quantity: null, cancelled_quantity: '0',
  unit_price: null, amount: null, product_url: null, image_url: null, expected_on: null, needed_on: null, location: '', selection_note: '', issue_note: '', website_status: 'unknown', delivery_address: null, tracking_url: null });
export const newOrder = (): OrderDocument => ({ vendor: '', order_number: '', seller: '', purchasing_entity: '', buyer_user_id: null,
  ordered_on: null, order_url: null, voucher_url: null, currency: 'USD', tax: null, shipping: null, discount: null, total: null,
  reconciliation_note: '', delivery_address: '', refunded: null, follow_up: '', follow_up_on: null, checked_on: null, note: '', lines: [], deliveries: [], receipts: [], adjustments: [] });
export function moneyValue(value: Numeric): string {
  return value === null || value === '' ? '未填' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));
}
export function lineAmount(line: OrderLine): number | null {
  if (line.amount !== null && line.amount !== '') return Number(line.amount);
  return line.quantity == null || line.unit_price == null || line.quantity === '' || line.unit_price === '' ? null : Math.round(Number(line.quantity) * Number(line.unit_price) * 100) / 100;
}
export function reconcile(doc: OrderDocument) {
  const amounts = doc.lines.map(lineAmount);
  const missing = amounts.filter(a => a === null).length;
  const subtotal = missing || !amounts.length ? null : amounts.reduce<number>((n, a) => n + Math.round((a ?? 0) * 100), 0) / 100;
  const calculated = subtotal === null || [doc.tax, doc.shipping, doc.discount].some(v => v === null || v === '') ? null
    : Math.round((subtotal + Number(doc.tax) + Number(doc.shipping) - Number(doc.discount)) * 100) / 100;
  const difference = calculated === null || doc.total === null || doc.total === '' ? null : Math.round((Number(doc.total) - calculated) * 100) / 100;
  return { subtotal, missing, calculated, difference };
}
export function orderAttention(order: PurchaseOrder, today: string): string[] {
  const d = order.document; const reasons = [];
  if (d.follow_up) reasons.push(d.follow_up_on && d.follow_up_on <= today ? `到期跟进：${d.follow_up}` : d.follow_up);

  if (Number(order.summary.difference)) reasons.push('金额待核对');
  for (const line of d.lines) {
    const remaining = order.summary.lines.find(l => l.id === line.id)?.remaining;
    if (line.issue_note) reasons.push(`${line.name}：${line.issue_note}`);
    if (remaining == null || Number(remaining) > 0) {
      if (line.website_status === 'delivered') reasons.push(`${line.name}：网站送达待确认`);
      else if (line.website_status === 'exception') reasons.push(`${line.name}：物流异常`);
      else if (line.website_status === 'ready_pickup') reasons.push(`${line.name}：待取货`);
      else if (line.expected_on && line.expected_on < today) reasons.push(`${line.name}：已过预计日期`);
    }
  }
  for (const delivery of d.deliveries) {
    const done = delivery.allocations.length > 0 && delivery.allocations.every(a => Number(order.summary.lines.find(l => l.id === a.line_id)?.remaining) === 0 || d.receipts.filter(r => r.delivery_id === delivery.id && !r.void_reason)
      .flatMap(r => r.lines).filter(r => r.line_id === a.line_id).reduce((n, r) => n + Number(r.quantity), 0) >= Number(a.quantity));
    if (delivery.website_status === 'exception') reasons.push(`${delivery.label}：物流异常`);
    else if (!done && delivery.website_status === 'delivered') reasons.push(`${delivery.label}：网站送达待确认`);
    else if (!done && delivery.website_status === 'ready_pickup') reasons.push(`${delivery.label}：待取货`);
    else if (!done && delivery.expected_on && delivery.expected_on < today) reasons.push(`${delivery.label}：已过预计日期`);
  }
  if (order.summary.lines.some(l => Number(l.damaged) > 0 && Number(l.remaining) > 0)) reasons.push('破损待处理');
  return [...new Set(reasons)];
}
export function importDocument(preview: ImportPreview): OrderDocument {
  return { ...newOrder(), ...preview.draft, lines: preview.draft.lines.map(l => ({ ...newLine(), ...l })) };
}
export const todayLA = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
