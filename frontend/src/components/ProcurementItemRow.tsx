import { useState, type ReactNode } from 'react';
import Button from '@cloudscape-design/components/button';
import Link from '@cloudscape-design/components/link';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { ProcurementItem } from '../api/client';
import type { NodeOption } from '../lib/orderStages';
import { moneyValue, websiteStatusLabel, type PurchaseOrder } from '../lib/purchaseOrders';
import { materialPurchaseFacts } from '../lib/procurementSummary';
import ImageViewer from './ui/ImageViewer';

type Fact = [string, ReactNode];
const blank = (value: unknown) => value == null || value === '';
/** Label/value pairs; blank values are left out so the panel only states known facts. */
function Facts({ facts, wide = [] }: { facts: Fact[]; wide?: string[] }) {
  const rows = facts.filter(([, value]) => !blank(value));
  if (!rows.length) return null;
  return <dl className="proc-detail-facts">{rows.map(([label, value]) => <div key={label} className={wide.includes(label) ? 'proc-detail-wide' : ''}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

/** One material: the seven row facts stay visible; 查看详情 opens requirement, orders, receipts and links. */
export default function ProcurementItemRow({ row, orders, waves, expanded, statusLabel, onToggle, onEdit, onOrder, children, readOnly=false }: {
  readOnly?: boolean; children?: ReactNode; row: ProcurementItem; orders: PurchaseOrder[]; waves: NodeOption[]; expanded: boolean; statusLabel: string;
  onToggle: () => void; onEdit: () => void; onOrder: (id: number) => void;
}) {
  const [image, setImage] = useState<number | null>(null);
  const purchase = materialPurchaseFacts(row, orders);
  const attention = row.attention_reasons ?? [];
  const legacy = row.legacy_purchase || (!row.order_managed ? row : null);
  const hasLegacy = !!legacy && [legacy.retailer, legacy.order_number, legacy.amount, legacy.quantity, legacy.ordered_on, legacy.expected_on, legacy.received_on, legacy.tracking_url, legacy.follow_up, legacy.carrier, legacy.shipment_status].some(v=>v!=null && v!=='');
  const tone = row.status === 'received' ? 'success' : row.status === 'na' ? 'stopped' : purchase.linked.length ? 'in-progress' : 'pending';
  const unit = row.unit || '';
  const orderedText = purchase.linked.length > 1 ? `${purchase.orderedDates[0] || '未填写'} 起 · ${purchase.linked.length} 笔` : purchase.ordered;
  const images = row.images ?? [];
  return <article className="ui-proc-item" data-expanded={expanded}>
    <div id={`proc-item-${row.id}`} className="ui-proc-item-main">
      <div className="proc-material-main"><div className="ui-proc-item-name"><strong>{row.name}</strong>{row.specification && <span className="proc-material-secondary">{row.specification}</span>}</div><StatusIndicator type={tone}>{purchase.progress ?? statusLabel}</StatusIndicator></div>
      <dl className="proc-material-facts">
        <div className="proc-material-cell"><dt>需求数量</dt><dd>{row.required_quantity ?? '未填写'} {unit}</dd></div>
        {purchase.linked.length ? <>
          <div className="proc-material-cell"><dt>已订商品金额</dt><dd>{purchase.amount}{purchase.missing > 0 && purchase.missing < purchase.lines.length ? `（${purchase.missing} 行未填）` : ''}</dd></div>
          <div className="proc-material-cell"><dt>下单日期</dt><dd>{orderedText}</dd></div>
          <div className="proc-material-cell"><dt>预计到货</dt><dd>{purchase.expected}</dd></div>
        </> : <div className="proc-material-cell proc-material-unordered"><dt>已订商品金额 · 下单日期 · 预计到货</dt><dd>{hasLegacy ? '未关联订单，旧记录见详情' : '尚未下单'}</dd></div>}
      </dl>
      <div className="proc-material-foot">
        {attention.length > 0 && <div className="proc-material-attention"><StatusIndicator type={purchase.attentionTone}>{purchase.attentionLabel}</StatusIndicator><span className="proc-material-reason">{attention.map(reason => reason.replace(/[。；;]+$/, '')).join('\n')}</span></div>}
        <div className="proc-material-actions"><Button variant="inline-link" ariaLabel={`${expanded ? '收起' : '查看'}详情：${row.name}`} onClick={onToggle}>{expanded ? '收起详情' : '查看详情'}</Button></div>
      </div>
    </div>
    {expanded && <section id={`proc-summary-${row.id}`} aria-label={`采购详情：${row.name}`} className="ui-proc-item-summary">
      <div className="ui-proc-item-summary-heading"><h4>需求</h4>{!readOnly && <Button variant="inline-link" onClick={onEdit}>{children ? '收起需求编辑' : '修改需求'}</Button>}</div>
      {!row.in_worklist && <p className="proc-detail-note">此需求未纳入本次采购清单。</p>}
      <Facts facts={[['使用节点', waves.find(w=>w.value===row.wave)?.label || row.wave], ['使用位置', row.use_location], ['需要到场', row.needed_on], ['需求预算（非实付）', row.budget_amount != null ? moneyValue(row.budget_amount) : null], ['备注', row.note]]} wide={['备注']} />
      {row.product_url && <div className="proc-detail-links"><Link href={row.product_url} external>商品参考</Link></div>}
      {images.length > 0 && <div className="proc-detail-images">{images.map(i=><button type="button" key={i.id} aria-label={`查看材料图片：${i.filename}`} onClick={()=>setImage(i.id)}><img src={`/api/procurement-images/${i.id}`} alt={i.filename} loading="lazy" /><span>{i.filename}</span></button>)}</div>}
      {children}
      {purchase.linked.length > 0 && <h4>订单 · {purchase.linked.length} 笔</h4>}
      {purchase.linked.map(order => {
        const doc = order.document;
        const lines = doc.lines.filter(l=>l.material_id===row.id); const ids = new Set(lines.map(l=>l.id));
        const receipts = doc.receipts.filter(r=>r.lines.some(l=>ids.has(l.line_id)));
        const adjustments = doc.adjustments.filter(a=>ids.has(a.line_id));
        const deliveries = doc.deliveries.filter(d=>d.allocations.some(a=>ids.has(a.line_id)));
        return <section className="ui-proc-order-summary" key={order.id}>
          <div className="ui-proc-order-heading"><h5>{doc.vendor} · {doc.order_number || '订单号未填写'}</h5><Button variant="inline-link" onClick={()=>onOrder(order.id)}>打开订单{readOnly ? '' : ' / 收货'}</Button></div>
          {lines.map(line => { const fact = order.summary.lines.find(r=>r.id===line.id); const status = websiteStatusLabel(line.website_status); return <div className="proc-order-line" key={line.id}>
            <p>{lines.length > 1 ? `${line.name} · ` : ''}下单 {doc.ordered_on || '未填写'} · 订购 {line.quantity ?? '未填'} / 完好实收 {fact?.usable ?? '待核对'} / 待补 {fact?.remaining ?? '待核对'} {line.unit} · 商品金额 {moneyValue(fact?.amount ?? null)}{line.expected_on ? ` · 预计 ${line.expected_on}` : ''}{status ? ` · 网站${status}（不代表实收）` : ''}</p>
            {line.issue_note && <p className="proc-item-issue">需处理：{line.issue_note}</p>}
            {(line.product_url || line.tracking_url) && <div className="proc-detail-links">{line.product_url && <Link external href={line.product_url}>商品链接</Link>}{line.tracking_url && <Link external href={line.tracking_url}>物流链接</Link>}</div>}
          </div>; })}
          {deliveries.map(d => <p className="proc-history-entry" key={d.id}>配送 {d.label || ''}{d.replacement ? '（补发）' : ''} · {d.expected_on ? `预计 ${d.expected_on}` : '预计到货未填写'}{websiteStatusLabel(d.website_status) ? ` · 网站${websiteStatusLabel(d.website_status)}（不代表实收）` : ''}{d.tracking_url && <> · <Link external href={d.tracking_url}>物流</Link></>}</p>)}
          {receipts.map(r => <p className="proc-history-entry" key={r.id}>实收 {r.received_on} · {r.lines.filter(l=>ids.has(l.line_id)).map(l=>`${l.quantity}${Number(l.damaged_quantity) > 0 ? `（破损 ${l.damaged_quantity}）` : ''} ${lines.find(x=>x.id===l.line_id)?.unit || ''}`).join('；')}{r.note ? ` · ${r.note}` : ''}{r.void_reason ? ` · 已撤销：${r.void_reason}` : ''}</p>)}
          {adjustments.map(a => <p className="proc-history-entry" key={a.id}>退货 {a.occurred_on} · {a.returned_quantity} {lines.find(l=>l.id===a.line_id)?.unit || ''}{a.refund != null ? ` · 退款 ${moneyValue(a.refund)}` : ''}{a.reason ? ` · ${a.reason}` : ''}</p>)}
          {Number(order.summary.refund) > 0 && <p className="proc-detail-note">整单累计退款 {moneyValue(order.summary.refund)}，未分摊到本项。</p>}
          {(doc.order_url || doc.voucher_url) && <div className="proc-detail-links">{doc.order_url && <Link external href={doc.order_url}>商家订单</Link>}{doc.voucher_url && <Link external href={doc.voucher_url}>购买凭据</Link>}</div>}
        </section>;
      })}
      {hasLegacy && legacy && <section className="ui-proc-order-summary"><h5>旧购买记录（不计入订单汇总）</h5>
        <Facts facts={[['商家', legacy.retailer], ['订单号', legacy.order_number], ['金额', legacy.amount!=null ? moneyValue(legacy.amount) : null], ['数量', legacy.quantity], ['下单', legacy.ordered_on], ['预计到货', legacy.expected_on], ['实际到货', legacy.received_on], ['跟进', legacy.follow_up]]} wide={['跟进']} />
        {(legacy.order_url || legacy.tracking_url) && <div className="proc-detail-links">{legacy.order_url && <Link external href={legacy.order_url}>原订单</Link>}{legacy.tracking_url && <Link external href={legacy.tracking_url}>原物流</Link>}</div>}
      </section>}
    </section>}
    {image!=null && <ImageViewer images={images.map(i=>({id:i.id,src:`/api/procurement-images/${i.id}`,label:i.filename}))} selectedId={image} onClose={()=>setImage(null)} />}
  </article>;
}
