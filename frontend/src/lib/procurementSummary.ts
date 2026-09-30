import { m as uiText, systemText } from '../i18n/core.ts';
import type { ProcurementItem } from '../api/client';
import type { PurchaseOrder } from './purchaseOrders';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** Display facts only: order totals and refunds never get allocated to materials. */
export function materialPurchaseFacts(row: ProcurementItem, orders: PurchaseOrder[]) {
  const linked = orders.filter(o => o.project_id === row.project_id && o.document.lines.some(l => l.material_id === row.id));
  const lines = linked.flatMap(order => order.document.lines.filter(l => l.material_id === row.id).map(line => ({
    order, line, result: order.summary.lines.find(r => r.id === line.id),
  })));
  const amounts = lines.map(l => l.result?.amount ?? null);
  const missing = amounts.filter(a => a == null || a === '').length;
  const cents = amounts.reduce<number>((sum, amount) => sum + Math.round(Number(amount ?? 0) * 100), 0);
  const orderedDates = [...new Set(linked.map(o => o.document.ordered_on).filter((d): d is string => !!d))].sort();
  const expectedDates = [...new Set(lines.flatMap(({order,line}) => [line.expected_on,
    ...order.document.deliveries.filter(d => d.allocations.some(a => a.line_id === line.id)).map(d => d.expected_on),
  ]).filter((d): d is string => !!d))].sort();
  const receivedDates = [...new Set(linked.flatMap(o => o.document.receipts.filter(r => !r.void_reason && r.lines.some(l => lines.some(x => x.order.id === o.id && x.line.id === l.line_id) && Number(l.quantity) > 0)).map(r => r.received_on)))].sort();
  const damaged = lines.some(l => Number(l.result?.damaged) > 0 && Number(l.result?.remaining) > 0);
  const failedShipping = lines.some(({line,order,result}) => result?.remaining !== 0 && Number(result?.remaining ?? 1) > 0 && (line.website_status === 'exception' || order.document.deliveries.some(d => d.website_status === 'exception' && d.allocations.some(a => a.line_id === line.id))));
  const cancelled = lines.length > 0 && lines.every(({line}) => line.quantity != null && Number(line.cancelled_quantity) >= Number(line.quantity));
  const anyReceived = lines.some(l => Number(l.result?.usable) > 0);
  const legacy = !linked.length && (row.amount != null || !!row.ordered_on || !!row.received_on);
  const progress = linked.length
    ? row.status === 'received' ? '已备齐' : cancelled ? '订单已取消' : anyReceived ? '部分到货' : '已下单'
    : row.status === 'exception' ? (legacy ? '旧记录待跟进' : '未下单') : legacy ? uiText("sentences.legacy.record", { value1: (row.status === 'received' ? uiText("procurementDesign.received") : row.status === 'ordered' ? uiText("procurementDesign.ordered") : uiText("directorDesign.recorded")) }) : null;
  return { linked, lines, missing, orderedDates, expectedDates, receivedDates, progress,
    amount: linked.length ? (missing === amounts.length ? '未填写' : usd.format(cents / 100)) : legacy ? '未关联订单' : '未下单',
    ordered: !linked.length ? (legacy ? '旧记录见详情' : '未下单') : linked.length > 1 ? '多笔订单' : orderedDates[0] || '未填写',
    expected: !linked.length ? (legacy ? '旧记录见详情' : '未下单') : expectedDates.length > 1 ? uiText("sentences.to", { value1: (expectedDates[0]), value2: (expectedDates[expectedDates.length - 1]) }) : expectedDates[0] || '未填写',
    attentionTone: damaged || failedShipping ? 'error' as const : 'warning' as const,
    attentionLabel: damaged ? uiText("procurementSummary.damaged.items.need.replacement") : failedShipping ? uiText("purchaseOrderFields.shipment.exception") : uiText("procurementSummary.follow.up.needed"),
  };
}

export function houseOrderTotal(orders: PurchaseOrder[]) {
  const missing = orders.filter(o => o.document.total == null || o.document.total === '').length;
  const paid = orders.reduce((sum,o) => sum + Math.round(Number(o.document.total ?? 0) * 100), 0);
  const refunds = orders.reduce((sum,o) => sum + Math.round(Number(o.summary.refund ?? 0) * 100), 0);
  return { missing, refunds: refunds / 100, label: !orders.length ? '—' : missing === orders.length ? uiText("procurementItemRow.not.entered") : usd.format((paid-refunds)/100) };
}

/** Unordered demand is distinct from ordered goods still awaiting receipt. Never convert units. */
export function materialQuantityFacts(row: ProcurementItem, orders: PurchaseOrder[]) {
  const lines = orders.filter(o => o.project_id === row.project_id).flatMap(o => o.document.lines.filter(l => l.material_id === row.id).map(line => ({line, result:o.summary.lines.find(r => r.id === line.id)})));
  const unit = row.unit?.trim() || '件';
  const comparable = lines.every(({line}) => (line.unit?.trim() || '件') === unit && line.quantity != null && line.quantity !== '');
  const ordered = comparable ? lines.reduce((sum,{line}) => sum + Math.max(0, Number(line.quantity) - Number(line.cancelled_quantity || 0)),0) : null;
  const received = comparable && lines.every(l => l.result?.usable != null) ? lines.reduce((sum,l) => sum + Number(l.result!.usable),0) : null;
  const pending = comparable && lines.every(l => l.result?.remaining != null) ? lines.reduce((sum,l) => sum + Number(l.result!.remaining),0) : null;
  const legacy = !lines.length && (!!row.legacy_purchase || row.amount != null || !!row.ordered_on || !!row.received_on);
  const unplaced = row.required_quantity != null && ordered != null && !legacy ? Math.max(0, Math.round((Number(row.required_quantity)-ordered)*1000000)/1000000) : null;
  return {unit, ordered, received, pending, unplaced, legacy,
    text: legacy ? uiText("procurementSummary.legacy.purchase.records.exist.verify.quantities.first") : !comparable ? uiText("procurementSummary.order.units.or.quantities.need.verification.no.automatic.total") : uiText("sentences.ordered.received.in.good.condition.awaiting.receipt.not.ordered", { value1: (ordered), value2: (received ?? uiText("procurementItemRow.needs.verification")), value3: (pending ?? uiText("procurementItemRow.needs.verification")), value4: (systemText(unit)), value5: (unplaced ?? uiText("procurementItemRow.needs.verification")) }),
  };
}
