import { systemText } from '../i18n/core.ts';
import { materialName, orderLineName } from '../i18n/templateNames.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import { useState, type ReactNode } from 'react';
import Button from '@cloudscape-design/components/button';
import Link from '@cloudscape-design/components/link';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { ProcurementItem } from '../api/client';
import type { NodeOption } from '../lib/orderStages';
import { moneyValue, websiteStatusLabel, orderTitle, type PurchaseOrder } from '../lib/purchaseOrders';
import DeleteRequirementButton from './DeleteRequirementButton';
import { materialPurchaseFacts } from '../lib/procurementSummary';
import ImageViewer from './ui/ImageViewer';
import ProductThumb from './ProductThumb';

type Fact = [string, ReactNode];
const blank = (value: unknown) => value == null || value === '';
/** Label/value pairs; blank values are left out so the panel only states known facts. */
function Facts({ facts, wide = [] }: { facts: Fact[]; wide?: string[] }) {
  useLanguage();
  const rows = facts.filter(([, value]) => !blank(value));
  if (!rows.length) return null;
  return <dl className="proc-detail-facts">{rows.map(([label, value], index) => <div key={index} className={wide.includes(label) ? 'proc-detail-wide' : ''}><dt>{systemText(label)}</dt><dd>{value}</dd></div>)}</dl>;
}

/** One material: the seven row facts stay visible; 查看详情 opens requirement, orders, receipts and links. */
export default function ProcurementItemRow({ row, orders, waves, expanded, statusLabel, onToggle, onEdit, onOrder, onDeleted, newBy, children, readOnly=false }: {
  readOnly?: boolean; children?: ReactNode; row: ProcurementItem; orders: PurchaseOrder[]; waves: NodeOption[]; expanded: boolean; statusLabel: string;
  onToggle: () => void; onEdit: () => void; onOrder: (id: number) => void; onDeleted?: () => void | Promise<void>; newBy?: { added_by: string; added_at: string };
}) {
  useLanguage();
  const [image, setImage] = useState<number | null>(null);
  const purchase = materialPurchaseFacts(row, orders);
  const attention = row.attention_reasons ?? [];
  const legacy = row.legacy_purchase || (!row.order_managed ? row : null);
  const hasLegacy = !!legacy && [legacy.retailer, legacy.order_number, legacy.amount, legacy.quantity, legacy.ordered_on, legacy.expected_on, legacy.received_on, legacy.tracking_url, legacy.follow_up, legacy.carrier, legacy.shipment_status].some(v=>v!=null && v!=='');
  const tone = row.status === 'received' ? 'success' : row.status === 'na' ? 'stopped' : purchase.linked.length ? 'in-progress' : 'pending';
  const unit = systemText(row.unit || '');
  const orderedText = purchase.linked.length > 1 ? uiText("sentences.from.orders", { value1: (purchase.orderedDates[0] || uiText("procurementItemRow.not.entered")), value2: (purchase.linked.length) }) : purchase.ordered;
  const images = row.images ?? [];
  return <article className="ui-proc-item" data-expanded={expanded}>
    <div id={`proc-item-${row.id}`} tabIndex={-1} className="ui-proc-item-main">
      <div className="proc-material-main"><div className="ui-proc-item-name"><strong>{materialName(row)}</strong>{row.specification && <span className="proc-material-secondary">{row.specification}</span>}</div><span className="proc-material-chips"><StatusIndicator type={tone}>{systemText(purchase.progress ?? statusLabel)}</StatusIndicator>{newBy && <span className="proc-new-chip">{uiText("procurementItemRow.new.requirement.by", { value1: newBy.added_by || uiText("purchaseOrders.procurement.entry"), value2: newBy.added_at.slice(5, 10) })}</span>}</span></div>
      <dl className="proc-material-facts">
        <div className="proc-material-cell"><dt>{uiText("procurementFields.required.quantity")}</dt><dd>{row.required_quantity ?? uiText("procurementItemRow.not.entered")} {unit}</dd></div>
        {purchase.linked.length ? <>
          <div className="proc-material-cell"><dt>{uiText("procurementItemRow.ordered.item.amount")}</dt><dd>{systemText(purchase.amount)}{purchase.missing > 0 && purchase.missing < purchase.lines.length ? uiText("sentences.lines.missing", { value1: (purchase.missing) }) : ''}</dd></div>
          <div className="proc-material-cell"><dt>{uiText("procurementItemRow.order.date")}</dt><dd>{systemText(orderedText)}</dd></div>
          <div className="proc-material-cell"><dt>{uiText("procurementItemRow.estimated.arrival")}</dt><dd>{systemText(purchase.expected)}</dd></div>
        </> : <div className="proc-material-cell proc-material-unordered"><dt>{uiText("procurementItemRow.ordered.item.amount.order.date.estimated.arrival")}</dt><dd>{hasLegacy ? uiText("procurementItemRow.no.linked.order.see.details.for.legacy.records") : uiText("procurementItemRow.not.ordered")}</dd></div>}
      </dl>
      <div className="proc-material-foot">
        {attention.length > 0 && <div className="proc-material-attention"><StatusIndicator type={purchase.attentionTone}>{purchase.attentionLabel}</StatusIndicator><span className="proc-material-reason">{attention.map(reason => systemText(reason).replace(/[。；;]+$/, '')).join('\n')}</span></div>}
        <div className="proc-material-actions"><Button variant="inline-link" ariaLabel={uiText("sentences.details", { value1: (expanded ? uiText("procurementItemRow.collapse") : uiText("procurementItemRow.view")), value2: (materialName(row)) })} onClick={onToggle}>{expanded ? uiText("procurementItemRow.collapse.details") : uiText("procurementItemRow.view.details")}</Button></div>
      </div>
    </div>
    {expanded && <section id={`proc-summary-${row.id}`} aria-label={uiText("sentences.procurement.details", { value1: (materialName(row)) })} className="ui-proc-item-summary">
      <div className="ui-proc-item-summary-heading"><h4>{uiText("procurementItemRow.requirement")}</h4>{!readOnly && <span className="proc-requirement-actions"><Button variant="inline-link" onClick={onEdit}>{children ? uiText("procurementItemRow.collapse.requirement.editor") : row.status === 'na' ? uiText("procurementItemRow.restore.edit.requirement") : uiText("procurementItemRow.edit.requirement")}</Button>{onDeleted && !children && !purchase.linked.length && !hasLegacy && <DeleteRequirementButton row={row} onDeleted={onDeleted} />}</span>}</div>
      {row.status === 'na' && <p className="proc-detail-note">{uiText("procurementItemRow.not.needed.for.this.property.excluded.from.progress.restore")}</p>}
      {row.status !== 'na' && !row.in_worklist && <p className="proc-detail-note">{uiText("procurementItemRow.this.requirement.is.outside.the.current.procurement.list")}</p>}
      <Facts facts={[['材料名称', materialName(row)], ['规格', row.specification], ['需求数量', row.required_quantity != null ? `${row.required_quantity} ${unit}` : null], ['使用节点', waves.find(w=>w.value===row.wave)?.label || row.wave], ['使用位置', row.use_location], ['需要到场', row.needed_on], ['需求预算（非实付）', row.budget_amount != null ? moneyValue(row.budget_amount) : null], ['备注', row.note]]} wide={['备注']} />
      {row.product_url && <div className="proc-detail-links"><Link href={row.product_url} external>{uiText("procurementItemRow.product.reference")}</Link></div>}
      {images.length > 0 && <div className="proc-detail-images">{images.map(i=><button type="button" key={i.id} aria-label={uiText("sentences.view.material.image", { value1: (i.filename) })} onClick={()=>setImage(i.id)}><img src={`/api/procurement-images/${i.id}`} alt={i.filename} loading="lazy" /><span>{i.filename}</span></button>)}</div>}
      {children}
      {purchase.linked.length > 0 && <h4>{uiText("procurementItemRow.orders")} {uiText("counts.orders", { count: purchase.linked.length })}</h4>}
      {purchase.linked.map(order => {
        const doc = order.document;
        const lines = doc.lines.filter(l=>l.material_id===row.id); const ids = new Set(lines.map(l=>l.id));
        const receipts = doc.receipts.filter(r=>r.lines.some(l=>ids.has(l.line_id)));
        const adjustments = doc.adjustments.filter(a=>ids.has(a.line_id));
        const deliveries = doc.deliveries.filter(d=>d.allocations.some(a=>ids.has(a.line_id)));
        return <section className="ui-proc-order-summary" key={order.id}>
          <div className="ui-proc-order-heading"><h5>{doc.title?.trim() ? <>{orderTitle(doc)}<small className="proc-order-subtitle">{doc.vendor} · {doc.order_number || uiText("procurementItemRow.order.number.not.entered")}</small></> : <>{doc.vendor} · {doc.order_number || uiText("procurementItemRow.order.number.not.entered")}</>}</h5><Button variant="inline-link" onClick={()=>onOrder(order.id)}>{uiText("procurementItemRow.open.order")}{readOnly ? '' : uiText("procurementItemRow.receiving")}</Button></div>
          {lines.map(line => { const fact = order.summary.lines.find(r=>r.id===line.id); const status = websiteStatusLabel(line.website_status); return <div className="proc-order-line" key={line.id}>
            <p>{lines.length > 1 ? `${orderLineName(line, [row])} · ` : ''}{uiText("procurementItemRow.order")} {doc.ordered_on || uiText("procurementItemRow.not.entered")} {uiText("procurementItemRow.ordered")} {line.quantity ?? uiText("procurementItemRow.not.entered.2")} {uiText("procurementItemRow.received.in.good.condition")} {fact?.usable ?? uiText("procurementItemRow.needs.verification")} {uiText("procurementItemRow.remaining")} {fact?.remaining ?? uiText("procurementItemRow.needs.verification")} {systemText(line.unit)} {uiText("procurementItemRow.item.amount")} {moneyValue(fact?.amount ?? null)}{line.expected_on ? uiText("sentences.estimated", { value1: (line.expected_on) }) : ''}{status ? uiText("sentences.carrier.not.proof.of.receipt", { value1: (status) }) : ''}</p>
            <Facts facts={[["规格", line.specification], ["品牌", line.brand], ["型号", line.model], ["颜色", line.color], ["使用位置", line.location], ["需要到场", line.needed_on], ["卖家", line.vendor], ["单价", line.unit_price != null ? moneyValue(line.unit_price) : null], ["收货地址", line.delivery_address || doc.delivery_address], ["备注", line.selection_note]]} wide={['备注']} />
            {line.issue_note && <p className="proc-item-issue">{uiText("procurementItemRow.action.needed")}{line.issue_note}</p>}
            {(line.product_url || line.tracking_url || line.image_url) && <div className="proc-detail-links"><ProductThumb src={line.image_url} label={orderLineName(line, [row])} />{line.product_url && <Link external href={line.product_url}>{uiText("procurementItemRow.product.link")}</Link>}{line.tracking_url && <Link external href={line.tracking_url}>{uiText("procurementItemRow.tracking.link")}</Link>}</div>}
          </div>; })}
          {deliveries.map(d => <p className="proc-history-entry" key={d.id}>{uiText("procurementItemRow.delivery")} {d.label || ''}{d.replacement ? uiText("procurementItemRow.replacement.shipment") : ''} · {d.expected_on ? uiText("sentences.estimated.2", { value1: (d.expected_on) }) : uiText("procurementItemRow.estimated.arrival.not.entered")}{websiteStatusLabel(d.website_status) ? uiText("sentences.carrier.not.proof.of.receipt", { value1: (websiteStatusLabel(d.website_status)) }) : ''}{d.tracking_url && <> · <Link external href={d.tracking_url}>{uiText("procurementItemRow.tracking")}</Link></>}</p>)}
          {receipts.map(r => <p className="proc-history-entry" key={r.id}>{uiText("procurementItemRow.received")} {r.received_on} · {r.lines.filter(l=>ids.has(l.line_id)).map(l=>`${l.quantity}${Number(l.damaged_quantity) > 0 ? uiText("sentences.damaged", { value1: (l.damaged_quantity) }) : ''} ${systemText(lines.find(x=>x.id===l.line_id)?.unit || '')}`).join('；')}{r.note ? ` · ${r.note}` : ''}{r.void_reason ? uiText("sentences.reversed", { value1: (r.void_reason) }) : ''}</p>)}
          {adjustments.map(a => <p className="proc-history-entry" key={a.id}>{uiText("procurementItemRow.return")} {a.occurred_on} · {a.returned_quantity} {systemText(lines.find(l=>l.id===a.line_id)?.unit || '')}{a.refund != null ? uiText("sentences.refund", { value1: (moneyValue(a.refund)) }) : ''}{a.reason ? ` · ${a.reason}` : ''}</p>)}
          {Number(order.summary.refund) > 0 && <p className="proc-detail-note">{uiText("procurementItemRow.total.order.refunds")} {moneyValue(order.summary.refund)}{uiText("procurementItemRow.not.allocated.to.this.item")}</p>}
          {(doc.order_url || doc.voucher_url) && <div className="proc-detail-links">{doc.order_url && <Link external href={doc.order_url}>{uiText("procurementItemRow.merchant.order")}</Link>}{doc.voucher_url && <Link external href={doc.voucher_url}>{uiText("procurementItemRow.proof.of.purchase")}</Link>}</div>}
        </section>;
      })}
      {hasLegacy && legacy && <section className="ui-proc-order-summary"><h5>{uiText("procurementItemRow.legacy.purchase.records.excluded.from.order.totals")}</h5>
        <Facts facts={[['商家', legacy.retailer], ['订单号', legacy.order_number], ['金额', legacy.amount!=null ? moneyValue(legacy.amount) : null], ['数量', legacy.quantity], ['下单', legacy.ordered_on], ['预计到货', legacy.expected_on], ['实际到货', legacy.received_on], ['跟进', legacy.follow_up], ['承运商', legacy.carrier], ['运单号', legacy.tracking_number], ['物流状态', legacy.shipment_status], ['收货地点', legacy.delivery_address || (legacy.delivery_type === 'company' ? uiText("procurementItemRow.company") : legacy.delivery_type === 'project' ? uiText("procurementItemRow.property.address") : null)]]} wide={['跟进']} />
        {(legacy.order_url || legacy.tracking_url) && <div className="proc-detail-links">{legacy.order_url && <Link external href={legacy.order_url}>{uiText("procurementItemRow.original.order")}</Link>}{legacy.tracking_url && <Link external href={legacy.tracking_url}>{uiText("procurementItemRow.original.tracking")}</Link>}</div>}
      </section>}
    </section>}
    {image!=null && <ImageViewer images={images.map(i=>({id:i.id,src:`/api/procurement-images/${i.id}`,label:i.filename}))} selectedId={image} onClose={()=>setImage(null)} />}
  </article>;
}
