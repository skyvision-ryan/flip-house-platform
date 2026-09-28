import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useNavigate } from 'react-router-dom';
import { Table } from './ui/Surface';
import Header from './ui/Header';
import { type PurchaseOrder, moneyValue, orderAttention, todayLA } from '../lib/purchaseOrders';

export default function PurchaseOrderCoverage({ orders, projectId, materialId, disabled = false, budgetAmount, compact = false }: { compact?: boolean; orders: PurchaseOrder[]; projectId: number; materialId?: number; disabled?: boolean; budgetAmount?: number | null }) {
  const navigate = useNavigate();
  const scoped = orders.filter(o => o.project_id === projectId && (!materialId || o.document.lines.some(l => l.material_id === materialId)));
  const missingTotal = scoped.filter(o => o.document.total == null).length;
  const knownTotal = scoped.reduce((n, o) => n + Math.round(Number(o.document.total ?? 0) * 100), 0) / 100;
  const refunds = scoped.reduce((n, o) => n + Math.round(Number(o.summary.refund) * 100), 0) / 100;
  const href = `/procurement/orders?project=${projectId}${materialId ? `&material=${materialId}` : ''}`;
  const rows = scoped.flatMap(order => order.summary.lines.filter(l => !materialId || l.material_id === materialId).map(line => ({ order, line,
    unit: order.document.lines.find(l => l.id === line.id)?.unit ?? '' })));
  return <SpaceBetween size="s">
    {!compact && <Header variant="h3" actions={<Button disabled={disabled} onClick={() => navigate(href)}>{materialId ? '查看购买记录' : '查看购买记录'}</Button>}>{materialId ? '本项实际购买与收货' : '本房订单汇总'}</Header>}
    {materialId && budgetAmount != null && <Box>本项采购预算 {moneyValue(budgetAmount)} · 已登记商品金额 {rows.length && rows.every(r => r.line.amount != null) ? moneyValue(rows.reduce((sum, r) => sum + Math.round(Number(r.line.amount) * 100), 0) / 100) : '待完整登记'}（订单税费、运费、折扣另列，不自动分摊）</Box>}
    {!materialId && <>
      <Box>{scoped.length} 笔订单 · 已登记订单净额 {scoped.length ? moneyValue(missingTotal === scoped.length ? null : knownTotal - refunds) : '暂无订单'}{missingTotal ? `（${missingTotal} 笔实付未填，汇总不完整）` : ''}{refunds ? ` · 已扣退款 ${moneyValue(refunds)}` : ''}</Box>
      <Box color="text-body-secondary" variant="small">仅订单实付减退款，不含材料旧记录；采购登记金额，非财务核款结果。</Box>
    </>}
    {materialId && <Table variant="embedded" items={rows} trackBy={row => `${row.order.id}-${row.line.id}`} empty={<Box>尚未关联购买记录。采购项及原有资料保留。</Box>}
      columnDefinitions={[
        { id: 'order', header: '订单 / 商品', minWidth: 200, cell: r => <><Button disabled={disabled} variant="inline-link" onClick={() => navigate(`${href}&order=${r.order.id}`)}>{r.order.document.vendor} · {r.order.document.order_number}</Button><Box>{r.line.name}</Box></> },
        { id: 'qty', header: '订购 / 实收 / 破损', minWidth: 150, cell: r => `${r.line.quantity ?? '待填'} / ${r.line.received} / ${r.line.damaged} ${r.unit}` },
        { id: 'remain', header: '仍需补齐', minWidth: 110, cell: r => `${r.line.remaining ?? '待核对'} ${r.unit}` },
        { id: 'amount', header: '商品金额', minWidth: 110, cell: r => moneyValue(r.line.amount) },
      ]} />}
    {materialId && scoped.length > 0 && <Box color="text-body-secondary">最近订单更新：{scoped.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0].updated_by} · {scoped.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0].updated_at.replace('T', ' ').slice(0, 16)}</Box>}
    {!materialId && !compact && <Box>{scoped.filter(o => !o.summary.complete).length} 笔尚未收齐或数量待核对 · {scoped.filter(o => orderAttention(o, todayLA()).length).length} 笔待处理 / 待补资料</Box>}
  </SpaceBetween>;
}
