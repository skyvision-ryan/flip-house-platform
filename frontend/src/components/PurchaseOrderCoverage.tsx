import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Popover from '@cloudscape-design/components/popover';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useNavigate } from 'react-router-dom';
import { Table } from './ui/Surface';
import Header from './ui/Header';
import { type PurchaseOrder, moneyValue, orderAttention, todayLA } from '../lib/purchaseOrders';

export default function PurchaseOrderCoverage({ orders, projectId, materialId, disabled = false, budgetAmount, compact = false }: { compact?: boolean; orders: PurchaseOrder[]; projectId: number; materialId?: number; disabled?: boolean; budgetAmount?: number | null }) {
  useLanguage();
  const navigate = useNavigate();
  const scoped = orders.filter(o => o.project_id === projectId && (!materialId || o.document.lines.some(l => l.material_id === materialId)));
  const missingTotal = scoped.filter(o => o.document.total == null).length;
  const knownTotal = scoped.reduce((n, o) => n + Math.round(Number(o.document.total ?? 0) * 100), 0) / 100;
  const refunds = scoped.reduce((n, o) => n + Math.round(Number(o.summary.refund) * 100), 0) / 100;
  const href = `/procurement/orders?project=${projectId}${materialId ? `&material=${materialId}` : ''}`;
  const rows = scoped.flatMap(order => order.summary.lines.filter(l => !materialId || l.material_id === materialId).map(line => ({ order, line,
    unit: order.document.lines.find(l => l.id === line.id)?.unit ?? '' })));
  return <SpaceBetween size="s">
    {!compact && <Header variant="h3" actions={<Button disabled={disabled} onClick={() => navigate(href)}>{materialId ? uiText("purchaseOrderCoverage.view.purchase.records") : uiText("purchaseOrderCoverage.view.purchase.records")}</Button>}>{materialId ? uiText("purchaseOrderCoverage.purchases.and.receipts.for.this.item") : uiText("purchaseOrderCoverage.property.order.summary")}</Header>}
    {materialId && budgetAmount != null && <Box>{uiText("purchaseOrderCoverage.item.procurement.budget")} {moneyValue(budgetAmount)} {uiText("purchaseOrderCoverage.recorded.item.amount")} {rows.length && rows.every(r => r.line.amount != null) ? moneyValue(rows.reduce((sum, r) => sum + Math.round(Number(r.line.amount) * 100), 0) / 100) : uiText("purchaseOrderCoverage.incomplete.amount.records")}{uiText("purchaseOrderCoverage.order.tax.shipping.and.discounts.are.separate.and.are")}</Box>}
    {!materialId && <>
      <dl className="proc-detail-facts"><div><dt>{uiText("purchaseOrderCoverage.order.count")}</dt><dd>{scoped.length ? uiText("counts.orders", { count: (scoped.length) }) : uiText("purchaseOrderCoverage.no.orders")}</dd></div><div><dt>{uiText("purchaseOrderCoverage.recorded.net.order.amount")} <Popover header={uiText("purchaseOrderCoverage.amount.scope")} content={uiText("purchaseOrderCoverage.sum.of.recorded.order.payments.less.refunds.excludes.legacy")} dismissAriaLabel={uiText("purchaseOrderCoverage.close.amount.explanation")} triggerType="custom"><Button variant="inline-icon" iconName="status-info" ariaLabel={uiText("purchaseOrderCoverage.view.net.order.amount.scope")} /></Popover></dt><dd>{scoped.length ? moneyValue(missingTotal === scoped.length ? null : knownTotal - refunds) : '—'}</dd></div></dl>
      {!!missingTotal && <Box color="text-status-warning">{missingTotal} {uiText("purchaseOrderCoverage.orders.have.no.payment.amount.the.total.is.incomplete")}</Box>}
      {!!refunds && <Box color="text-body-secondary">{uiText("purchaseOrderCoverage.refunds.deducted")} {moneyValue(refunds)}</Box>}
    </>}
    {materialId && <Table variant="embedded" items={rows} trackBy={row => `${row.order.id}-${row.line.id}`} empty={<Box>{uiText("purchaseOrderCoverage.no.linked.purchase.records.requirements.and.original.information.are")}</Box>}
      columnDefinitions={[
        { id: 'order', header: uiText("purchaseOrderCoverage.order.item"), minWidth: 200, cell: r => <><Button disabled={disabled} variant="inline-link" onClick={() => navigate(`${href}&order=${r.order.id}`)}>{r.order.document.vendor} · {r.order.document.order_number}</Button><Box>{r.line.name}</Box></> },
        { id: 'qty', header: uiText("purchaseOrderCoverage.ordered.received.damaged"), minWidth: 150, cell: r => `${r.line.quantity ?? uiText("purchaseOrderCoverage.not.entered")} / ${r.line.received} / ${r.line.damaged} ${r.unit}` },
        { id: 'remain', header: uiText("purchaseOrderCoverage.still.needed"), minWidth: 110, cell: r => `${r.line.remaining ?? uiText("procurementItemRow.needs.verification")} ${r.unit}` },
        { id: 'amount', header: uiText("purchaseOrderCoverage.item.amount"), minWidth: 110, cell: r => moneyValue(r.line.amount) },
      ]} />}
    {materialId && scoped.length > 0 && <Box color="text-body-secondary">{uiText("purchaseOrderCoverage.latest.order.update")}{scoped.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0].updated_by} · {scoped.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0].updated_at.replace('T', ' ').slice(0, 16)}</Box>}
    {!materialId && !compact && <Box>{scoped.filter(o => !o.summary.complete).length} {uiText("purchaseOrderCoverage.orders.incomplete.or.quantities.unverified")} {scoped.filter(o => orderAttention(o, todayLA()).length).length} {uiText("purchaseOrderCoverage.orders.need.action.information")}</Box>}
  </SpaceBetween>;
}
