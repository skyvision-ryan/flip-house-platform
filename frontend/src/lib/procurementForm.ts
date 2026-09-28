import type { OrderDocument, Receipt } from './purchaseOrders';

export type FieldErrors = Record<string, string>;
const present = (value: unknown) => value !== null && value !== undefined && value !== '';
const nonnegative = (value: unknown) => present(value) && Number.isFinite(Number(value)) && Number(value) >= 0;
const dateError = (value: string | null | undefined) => value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) ? '使用有效日期，格式为 YYYY-MM-DD。' : '';

/** UI feedback only. The order API remains the authority for quantities and money. */
export function orderFormErrors(doc: OrderDocument, stage?: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!doc.vendor.trim()) errors.vendor = '填写采购渠道或供应商。';
  if (!doc.order_number.trim()) errors.order_number = '填写商家订单号或收据编号。';
  if (stage === '') errors.stage = '选择本次采购阶段。';
  if (dateError(doc.ordered_on)) errors.ordered_on = dateError(doc.ordered_on);
  if (present(doc.total) && !nonnegative(doc.total)) errors.total = '填写非负金额；未知请留空。';
  if (!doc.lines.length) errors.lines = '至少添加一项商品。';
  for (const line of doc.lines) {
    if (!line.material_id || !line.name.trim()) errors[`${line.id}.material`] = '选择本房采购项。';
    if ((stage !== undefined || present(line.quantity)) && (!nonnegative(line.quantity) || Number(line.quantity) <= 0)) errors[`${line.id}.quantity`] = '订购数量须大于 0。';
    if (present(line.unit_price) && !nonnegative(line.unit_price)) errors[`${line.id}.price`] = '单价不能为负数；未知请留空。';
    if (dateError(line.expected_on)) errors[`${line.id}.date`] = dateError(line.expected_on);
  }
  return errors;
}
export function receiptFormErrors(receipt: Receipt): FieldErrors {
  const errors: FieldErrors = {};
  if (!receipt.location.trim()) errors.location = '填写本次实际收货地点。';
  if (!receipt.received_on || dateError(receipt.received_on)) errors.date = '填写有效的实际收货日期（YYYY-MM-DD）。';
  for (const line of receipt.lines) {
    if (!nonnegative(line.quantity)) errors[`${line.line_id}.quantity`] = '填写本次实收数量；未收到填 0。';
    if (!nonnegative(line.damaged_quantity) || Number(line.damaged_quantity) > Number(line.quantity)) errors[`${line.line_id}.damaged`] = '破损数量须介于 0 与本次实收数量之间。';
  }
  if (!receipt.lines.some(line => Number(line.quantity) > 0)) errors.lines = '至少填写一项本次实收数量。';
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
      const messages = details.flatMap(detail => typeof detail?.msg === 'string' ? [detail.msg.replace(/^Value error, /, '')] : []);
      return [...new Set(messages)].join('；') || '未能保存，请核对输入后重试。';
    }
  } catch { /* Normal API errors already contain a readable message. */ }
  return message;
}
