import type { ReactNode } from 'react';
import Button from '@cloudscape-design/components/button';
import Icon from '@cloudscape-design/components/icon';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { ProcurementItem } from '../api/client';
import { orderStages, stageFacts, type NodeOption } from '../lib/orderStages';
import { moneyValue, type PurchaseOrder } from '../lib/purchaseOrders';

const tone = (status: string) => status === 'exception' ? 'error' : status === 'received' ? 'success' : status === 'na' ? 'stopped' : status === 'ordered' ? 'in-progress' : 'pending';
export default function ProcurementItemRow({ row, orders, waves, expanded, statusLabel, onToggle, onEdit, onOrder, children }: {
  children?: ReactNode; row: ProcurementItem; orders: PurchaseOrder[]; waves: NodeOption[]; expanded: boolean; statusLabel: string;
  onToggle: () => void; onEdit: () => void; onOrder: (id: number) => void;
}) {
  const linked = orders.filter(o => o.project_id === row.project_id && o.document.lines.some(l => l.material_id === row.id)).map(order => {
    const stage = orderStages(order.document.lines.filter(l => l.material_id === row.id), row.project_id, [row], waves)[0];
    return { order, stage, facts: stageFacts(order, stage) };
  }).sort((a, b) => Number(a.facts.complete) - Number(b.facts.complete));
  const dates = [...new Set(linked.flatMap(l => l.facts.dates))].sort();
  const amounts = linked.flatMap(l => l.facts.rows.map(r => r.amount));
  const knownAmount = amounts.reduce<number>((n, a) => n + Math.round(Number(a ?? 0) * 100), 0) / 100;
  const missing = amounts.filter(a => a == null).length;
  const amount = linked.length ? moneyValue(missing === amounts.length ? null : knownAmount) : moneyValue(row.amount);
  const places = [...new Set(linked.flatMap(l => [...l.stage.lines.map(({line})=>line.delivery_address || l.order.document.delivery_address), ...l.facts.deliveries.map(d=>d.address)]).filter(Boolean))];
  const quantity = linked.flatMap(({ facts, stage }) => facts.rows.map(r => `实收 ${r.usable} / ${r.quantity ?? '待核对'} ${stage.lines.find(l => l.line.id === r.id)?.line.unit || ''}${r.remaining != null && Number(r.remaining) > 0 ? ` · 待补 ${r.remaining}` : ''}`)).join('；');
  const note = row.attention_reasons?.join('；') || row.order_progress_note || quantity || row.note || row.order_notes;
  return <article className="ui-proc-item" data-expanded={expanded}>
    <button type="button" id={`proc-item-${row.id}`} className="ui-proc-item-trigger" aria-label={`查看采购：${row.name}`} aria-expanded={expanded} aria-controls={`proc-summary-${row.id}`} onClick={onToggle}>
      <span className="ui-proc-item-name"><Icon name={expanded ? 'angle-down' : 'angle-right'} /><span><strong>{row.name}</strong>{note && <span className="ui-proc-item-note">{note}</span>}</span></span>
      <span className="ui-proc-item-status"><StatusIndicator type={tone(row.status)}>{statusLabel}</StatusIndicator></span>
      {(dates.length > 0 || row.expected_on || row.received_on) && <span className="ui-proc-item-fact proc-item-date"><small>{row.status === 'received' ? '实际到货' : '预计到货'}</small><span>{row.status === 'received' ? row.received_on || '日期待补' : dates.join(' / ') || row.expected_on || (row.status === 'na' ? '—' : '待确定')}</span></span>}
      {(linked.length > 0 || row.amount != null) && <span className="ui-proc-item-fact proc-item-amount"><small>{linked.length ? `${linked.length} 笔订单 · 商品金额` : '采购金额'}</small><span>{amount}{missing > 0 && missing < amounts.length ? ' + 待补金额' : ''}</span></span>}
    </button>
    {expanded && <section id={`proc-summary-${row.id}`} aria-labelledby={`proc-item-${row.id}`} className="ui-proc-item-summary">
      <div className="ui-proc-item-summary-heading"><span>需求 {row.required_quantity ?? '待核对'} {row.unit || ''}{row.needed_on ? ` · 需用 ${row.needed_on}` : ''}</span><Button variant="inline-link" onClick={onEdit}>修改需求</Button></div>
      {row.specification && <div className="ui-proc-item-destination">{row.specification}</div>}
      {row.note && row.note !== note && <div className="ui-proc-item-destination">{row.note}</div>}
      {children}
      {!!places.length && <div className="ui-proc-item-destination">收货地点 · {places.join(' / ')}</div>}
      {!linked.length && row.ordered_on && <div className="ui-proc-item-unordered">原登记下单 {row.ordered_on} · 旧记录可在修改采购项中查看</div>}
      {linked.map(({ order, stage, facts }) => <div className="ui-proc-order-summary" key={order.id}>
        <div className="ui-proc-order-heading"><strong>{order.document.vendor} · {order.document.order_number || '订单号待补'}</strong><Button variant="inline-link" onClick={() => onOrder(order.id)}>订单详情 / 收货</Button></div>
        {stage.lines.map(({ line }) => {
          const fact = facts.rows.find(r => r.id === line.id);
          return <div className="ui-proc-order-product" key={line.id}><span>{line.brand || (stage.lines.length > 1 ? line.name : '')}</span><span>实收 {fact?.usable ?? '待核对'} / 订购 {line.quantity ?? '待核对'} {line.unit}{fact?.remaining != null && Number(fact.remaining) > 0 ? ` · 待补 ${fact.remaining}` : ''}{facts.cancelled ? ' · 已取消' : ''}</span></div>;
        })}

      </div>)}
    </section>}
  </article>;
}
