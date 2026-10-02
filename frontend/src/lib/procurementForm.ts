import { m as uiText, systemText } from '../i18n/core.ts';
import { adjustmentRefundTotal, type Adjustment, type OrderDocument, type OrderSummary, type Receipt } from './purchaseOrders.ts';

export type FieldErrors = Record<string, string>;
const present = (value: unknown) => value !== null && value !== undefined && value !== '';
const nonnegative = (value: unknown) => present(value) && Number.isFinite(Number(value)) && Number(value) >= 0;
const linkError = (value: string | null | undefined) => value && !/^https?:\/\/\S+$/i.test(String(value).trim()) ? uiText("procurementForm.enter.a.valid.link") : '';
const dateError = (value: string | null | undefined) => value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) ? uiText("procurementForm.enter.a.valid.date.in.yyyy.mm.dd.format") : '';

/** UI feedback only. The order API remains the authority for quantities and money. */
export function orderFormErrors(doc: OrderDocument, stage?: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!doc.vendor.trim()) errors.vendor = uiText("procurementForm.enter.a.procurement.channel.or.supplier");
  if (!doc.order_number.trim()) errors.order_number = uiText("procurementForm.enter.the.merchant.order.or.receipt.number");
  if (stage === '') errors.stage = uiText("procurementForm.select.the.procurement.stage.for.this.order");
  if (dateError(doc.ordered_on)) errors.ordered_on = dateError(doc.ordered_on);
  if (present(doc.total) && !nonnegative(doc.total)) errors.total = uiText("procurementForm.enter.a.nonnegative.amount.leave.unknown.amounts.blank");
  if (!doc.lines.length) errors.lines = uiText("procurementForm.add.at.least.one.item");
  for (const line of doc.lines) {
    if (!line.material_id || !line.name.trim()) errors[`${line.id}.material`] = uiText("procurementForm.select.a.procurement.item.from.this.property");
    if ((stage !== undefined || present(line.quantity)) && (!nonnegative(line.quantity) || Number(line.quantity) <= 0)) errors[`${line.id}.quantity`] = uiText("procurementForm.ordered.quantity.must.be.greater.than.0");
    if (present(line.unit_price) && !nonnegative(line.unit_price)) errors[`${line.id}.price`] = uiText("procurementForm.unit.price.cannot.be.negative.leave.unknown.prices.blank");
    if (dateError(line.expected_on)) errors[`${line.id}.date`] = dateError(line.expected_on);
    for (const field of ['product_url', 'image_url', 'tracking_url'] as const) if (linkError(line[field])) errors[`${line.id}.${field}`] = linkError(line[field]);
  }
  for (const field of ['order_url', 'voucher_url'] as const) if (linkError(doc[field])) errors[field] = linkError(doc[field]);
  return errors;
}
/** One return / refund for one order line. Quantities come from the order summary; the API stays the authority. */
export function adjustmentFormErrors(adjustment: Adjustment, line: OrderSummary['lines'][number], doc: OrderDocument, today: string): FieldErrors {
  const errors: FieldErrors = {};
  const returned = Number(adjustment.returned_quantity || 0), usable = Number(adjustment.returned_usable_quantity || 0);
  const returnable = Number(line.received) - Number(line.returned);
  if (!nonnegative(adjustment.returned_quantity || '0')) errors.returned = uiText("procurementForm.enter.a.nonnegative.amount.leave.unknown.amounts.blank");
  else if (returned > returnable) errors.returned = uiText("procurementForm.return.exceeds.received");
  if (!nonnegative(adjustment.returned_usable_quantity || '0') || usable > returned || usable > Number(line.usable)) errors.usable = uiText("procurementForm.usable.exceeds.returned");
  if (present(adjustment.refund) && !nonnegative(adjustment.refund)) errors.refund = uiText("procurementForm.enter.a.nonnegative.amount.leave.unknown.amounts.blank");
  else if (present(doc.total) && adjustmentRefundTotal([...doc.adjustments, adjustment]) > Number(doc.total)) errors.refund = uiText("procurementForm.refund.exceeds.order.total");
  if (!returned && !present(adjustment.refund)) errors.returned = errors.returned || uiText("procurementForm.enter.a.return.quantity.or.refund");
  if (!adjustment.occurred_on || dateError(adjustment.occurred_on)) errors.date = uiText("procurementForm.enter.a.valid.date.in.yyyy.mm.dd.format");
  else if (adjustment.occurred_on > today) errors.date = uiText("procurementForm.date.cannot.be.in.the.future");
  if (!adjustment.reason.trim()) errors.reason = uiText("procurementForm.enter.the.return.refund.reason");
  return errors;
}
export function receiptFormErrors(receipt: Receipt): FieldErrors {
  const errors: FieldErrors = {};
  if (!receipt.location.trim()) errors.location = uiText("procurementForm.enter.the.actual.receiving.location");
  if (!receipt.received_on || dateError(receipt.received_on)) errors.date = uiText("procurementForm.enter.a.valid.actual.receipt.date.yyyy.mm.dd");
  for (const line of receipt.lines) {
    if (!nonnegative(line.quantity)) errors[`${line.line_id}.quantity`] = uiText("procurementForm.enter.the.quantity.received.this.time.enter.0.if");
    if (!nonnegative(line.damaged_quantity) || Number(line.damaged_quantity) > Number(line.quantity)) errors[`${line.line_id}.damaged`] = uiText("procurementForm.damaged.quantity.must.be.between.0.and.the.quantity");
  }
  if (!receipt.lines.some(line => Number(line.quantity) > 0)) errors.lines = uiText("procurementForm.enter.a.received.quantity.for.at.least.one.item");
  return errors;
}

export function procurementReturnTo(value: string | null, project: string): string {
  // Accept only this workspace, never an external or unrelated navigation target.
  return value && /^\/procurement(?:\?|$)/.test(value) ? value : `/procurement?project=${project}`;
}

/** Keep API validation details readable without echoing the submitted order document. */
export function procurementSaveError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const details: unknown = JSON.parse(message);
    if (Array.isArray(details)) {
      const messages = details.flatMap(detail => typeof detail?.msg === 'string' ? [systemText(detail.msg.replace(/^Value error, /, ''))] : []);
      return [...new Set(messages)].join('；') || uiText("procurementForm.could.not.save.check.your.entries.and.try.again");
    }
  } catch { /* Normal API errors already contain a readable message. */ }
  return message;
}
