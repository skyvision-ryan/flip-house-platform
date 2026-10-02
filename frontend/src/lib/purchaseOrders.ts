import { systemText } from '../i18n/core.ts';
import { m as uiText } from '../i18n/core.ts';
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
  title?: string; vendor: string; order_number: string; seller: string; purchasing_entity: string; buyer_user_id: number | null;
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
  summary: OrderSummary; updated_at: string; updated_by: string; created_at?: string;
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
export const newOrder = (): OrderDocument => ({ title: '', vendor: '', order_number: '', seller: '', purchasing_entity: '', buyer_user_id: null,
  ordered_on: null, order_url: null, voucher_url: null, currency: 'USD', tax: null, shipping: null, discount: null, total: null,
  reconciliation_note: '', delivery_address: '', refunded: null, follow_up: '', follow_up_on: null, checked_on: null, note: '', lines: [], deliveries: [], receipts: [], adjustments: [] });
export function moneyValue(value: Numeric): string {
  return value === null || value === '' ? uiText("procurementItemRow.not.entered.2") : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));
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
/** A delivery batch is done when every allocated line is received in full, or the line itself needs nothing more. */
export function deliveryDone(order: PurchaseOrder, delivery: Delivery): boolean {
  const d = order.document;
  return delivery.allocations.length > 0 && delivery.allocations.every(a => Number(order.summary.lines.find(l => l.id === a.line_id)?.remaining) === 0 || d.receipts.filter(r => r.delivery_id === delivery.id && !r.void_reason)
    .flatMap(r => r.lines).filter(r => r.line_id === a.line_id).reduce((n, r) => n + Number(r.quantity), 0) >= Number(a.quantity));
}
export function orderAttention(order: PurchaseOrder, today: string): string[] {
  const d = order.document; const reasons = [];
  if (d.follow_up) reasons.push(d.follow_up_on && d.follow_up_on <= today ? uiText("sentences.follow.up.due", { value1: (d.follow_up) }) : d.follow_up);

  if (Number(order.summary.difference)) reasons.push(uiText("purchaseOrders.amount.needs.verification"));
  for (const line of d.lines) {
    const remaining = order.summary.lines.find(l => l.id === line.id)?.remaining;
    if (line.issue_note) reasons.push(`${line.name}：${line.issue_note}`);
    if (remaining == null || Number(remaining) > 0) {
      if (line.website_status === 'delivered') reasons.push(uiText("sentences.carrier.shows.delivered.verify.receipt", { value1: (line.name) }));
      else if (line.website_status === 'exception') reasons.push(uiText("sentences.shipment.exception", { value1: (line.name) }));
      else if (line.website_status === 'ready_pickup') reasons.push(uiText("sentences.awaiting.pickup", { value1: (line.name) }));
      else if (line.expected_on && line.expected_on < today) reasons.push(uiText("sentences.past.estimated.arrival", { value1: (line.name) }));
    }
  }
  for (const delivery of d.deliveries) {
    const done = deliveryDone(order, delivery);
    if (delivery.website_status === 'exception') reasons.push(uiText("sentences.shipment.exception", { value1: (delivery.label) }));
    else if (!done && delivery.website_status === 'delivered') reasons.push(uiText("sentences.carrier.shows.delivered.verify.receipt", { value1: (delivery.label) }));
    else if (!done && delivery.website_status === 'ready_pickup') reasons.push(uiText("sentences.awaiting.pickup", { value1: (delivery.label) }));
    else if (!done && delivery.expected_on && delivery.expected_on < today) reasons.push(uiText("sentences.past.estimated.arrival", { value1: (delivery.label) }));
  }
  if (order.summary.lines.some(l => Number(l.damaged) > 0 && Number(l.remaining) > 0)) reasons.push(uiText("purchaseOrders.damaged.items.need.action"));
  return [...new Set(reasons)];
}
/** Merchant-site shipping wording; never a statement of actual receipt. */
export const websiteStatusLabel = (status?: Delivery['website_status'] | null) => status && status !== 'unknown'
  ? systemText(({ not_shipped: '未发货', in_transit: '运输中', ready_pickup: '可取货', delivered: '显示送达', exception: '异常' })[status]) : null;
export function importDocument(preview: ImportPreview): OrderDocument {
  return { ...newOrder(), ...preview.draft, lines: preview.draft.lines.map(l => ({ ...newLine(), ...l })) };
}
export const todayLA = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const cents = (value: Numeric) => value == null || value === '' ? 0 : Math.round(Number(value) * 100);
/** Sum of per-line refund records, in dollars. */
export const adjustmentRefundTotal = (adjustments: Adjustment[]) => adjustments.reduce((n, a) => n + cents(a.refund), 0) / 100;
/** Order-level refund total after appending one return: automatic (null) stays automatic; a manual total is only raised, never lowered, so it never undercuts the records. */
export function refundedAfterAdjustment(doc: OrderDocument, adjustment: Adjustment): { refunded: Numeric; raised: boolean } {
  if (doc.refunded == null || doc.refunded === '') return { refunded: null, raised: false };
  const sum = adjustmentRefundTotal([...doc.adjustments, adjustment]);
  return Number(doc.refunded) < sum ? { refunded: sum.toFixed(2), raised: true } : { refunded: doc.refunded, raised: false };
}

/** Buyer-given title first; vendor and order number remain the identity and the fallback. */
export const orderTitle = (doc: Pick<OrderDocument, 'title' | 'vendor' | 'order_number'>) => doc.title?.trim() || `${doc.vendor} · ${doc.order_number}`;
export type LineStatus = 'pending' | 'partial' | 'received' | 'cancelled' | 'returned';
/** Per-line receiving state from the order summary; never from merchant website status. */
export function lineStatus(summary: OrderSummary['lines'][number], line: Pick<OrderLine, 'quantity' | 'cancelled_quantity'>): LineStatus {
  const quantity = line.quantity == null || line.quantity === '' ? null : Number(line.quantity);
  if (quantity != null && Number(line.cancelled_quantity) >= quantity) return 'cancelled';
  const received = Number(summary.received), returned = Number(summary.returned);
  if (received > 0 && returned >= received) return 'returned';
  if (summary.remaining != null && Number(summary.remaining) === 0) return 'received';
  return received > 0 ? 'partial' : 'pending';
}
export const lineStatusLabel = (status: LineStatus) => uiText(({ pending: 'purchaseOrders.line.status.pending', partial: 'purchaseOrders.line.status.partial', received: 'purchaseOrders.line.status.received', cancelled: 'purchaseOrders.line.status.cancelled', returned: 'purchaseOrders.line.status.returned' } as const)[status]);
/** Earliest estimated arrival still outstanding: lines with remaining quantity and delivery batches not received in full. Null once nothing is outstanding. */
export function nextExpected(order: PurchaseOrder): string | null {
  const d = order.document;
  const dates: string[] = [];
  for (const line of d.lines) {
    const fact = order.summary.lines.find(l => l.id === line.id);
    if (!fact || lineStatus(fact, line) === 'cancelled') continue;
    if ((fact.remaining == null || Number(fact.remaining) > 0) && line.expected_on) dates.push(line.expected_on);
  }
  for (const delivery of d.deliveries) if (!deliveryDone(order, delivery) && delivery.expected_on) dates.push(delivery.expected_on);
  return dates.length ? dates.sort()[0] : null;
}
const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000;
/** Due-today or overdue marker for the order list; a front-end expression only, the backend keeps its strict "past" rule. */
export function arrivalChip(order: PurchaseOrder, today: string): { kind: 'today' } | { kind: 'overdue'; days: number } | null {
  const next = nextExpected(order);
  if (!next || order.summary.complete) return null;
  if (next === today) return { kind: 'today' };
  return next < today ? { kind: 'overdue', days: dayNumber(today) - dayNumber(next) } : null;
}
/** Outstanding orders with a date first (soonest first), then outstanding without a date, then received orders, each latest-updated first. */
export function sortOrdersForList(orders: PurchaseOrder[]): PurchaseOrder[] {
  const rank = (o: PurchaseOrder) => o.summary.complete ? 2 : nextExpected(o) ? 0 : 1;
  return [...orders].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return nextExpected(a)!.localeCompare(nextExpected(b)!) || b.updated_at.localeCompare(a.updated_at);
    return b.updated_at.localeCompare(a.updated_at);
  });
}
