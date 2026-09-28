import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { type ProcurementItem } from '../api/client';
import FormField from './ui/FormField';
import Header from './ui/Header';
import { ExpandableSection } from './ui/Surface';
import { type OrderDocument, type OrderLine, type Delivery, type Numeric, newLine, moneyValue, lineAmount, reconcile } from '../lib/purchaseOrders';
import type { FieldErrors } from '../lib/procurementForm';
import type { NodeOption } from '../lib/orderStages';

export function TextField({ label, value, onChange, numeric = false, date = false, disabled = false, error, hint }: {
  label: string; value: Numeric | undefined; onChange: (v: string) => void; numeric?: boolean; date?: boolean; disabled?: boolean; error?: string; hint?: string;
}) {
  return <FormField label={label.replace(/^商品 \d+ /, '').replace(/^.* (?=本次实收数量$|其中破损数量$)/, '')} errorText={error} constraintText={hint}><Input ariaLabel={label} value={value == null ? '' : String(value)} type={numeric ? 'number' : date ? 'text' : 'text'}
    placeholder={date ? 'YYYY-MM-DD' : undefined} disabled={disabled} onChange={({ detail }) => onChange(detail.value)} /></FormField>;
}
export function Choice({ label, value, options, onChange, disabled = false, error }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; disabled?: boolean; error?: string }) {
  return <FormField label={label.replace(/^商品 \d+ /, '').replace(/^.* (?=本次实收数量$|其中破损数量$)/, '')} errorText={error}><Select ariaLabel={label} disabled={disabled} options={options} selectedOption={options.find(o => o.value === value) ?? null}
    placeholder="请选择" onChange={({ detail }) => onChange(detail.selectedOption.value!)} /></FormField>;
}
export const websiteStatuses = [{ value: 'unknown', label: '未核实' }, { value: 'not_shipped', label: '未发货' }, { value: 'in_transit', label: '运输中' }, { value: 'ready_pickup', label: '可以取货' }, { value: 'delivered', label: '网站显示送达' }, { value: 'exception', label: '物流异常' }];

export default function PurchaseOrderFields({ doc, onChange, materials, busy, nodes, defaultNode, errors = {} }: {
  doc: OrderDocument; onChange: (doc: OrderDocument) => void; materials: ProcurementItem[]; busy: boolean;
  nodes: NodeOption[]; defaultNode: string; errors?: FieldErrors;
}) {
  const set = <K extends keyof OrderDocument>(key: K, value: OrderDocument[K]) => onChange({ ...doc, [key]: value });
  const lineSet = (id: string, patch: Partial<OrderLine>) => set('lines', doc.lines.map(l => l.id === id ? { ...l, ...patch } : l));
  const totals = reconcile(doc);
  const choices = [...materials].sort((a, b) => Number(b.wave === defaultNode) - Number(a.wave === defaultNode)).map(m => ({ value: String(m.id), label: `${m.name} · ${nodes.find(n => n.value === m.wave)?.label || m.wave}` }));
  return <SpaceBetween size="m">
    <div className="proc-common-fields">
      <TextField error={errors.vendor} label="采购渠道 / 供应商" value={doc.vendor} disabled={busy} onChange={v => set('vendor', v)} />
      <TextField error={errors.order_number} label="商家订单号" value={doc.order_number} disabled={busy} onChange={v => set('order_number', v)} />
      <TextField error={errors.ordered_on} label="下单日期" date value={doc.ordered_on} disabled={busy} onChange={v => set('ordered_on', v || null)} />
      <TextField error={errors.total} label="订单实付（USD）" numeric value={doc.total} disabled={busy} onChange={v => set('total', v || null)} />
    </div>
    <section className="proc-order-products"><Header variant="h2" actions={<Button disabled={busy} onClick={() => set('lines', [...doc.lines, newLine()])}>添加采购项</Button>}>买了什么</Header>
      {doc.lines.map((line, index) => <section className="ui-order-line" key={line.id}>
        <Header variant="h3" actions={<Button variant="inline-link" ariaLabel={`移除商品 ${index + 1}`} disabled={busy || doc.receipts.some(r => r.lines.some(l => l.line_id === line.id)) || doc.adjustments.some(a => a.line_id === line.id)} onClick={() => set('lines', doc.lines.filter(l => l.id !== line.id))}>移除</Button>}>
          {line.name || `采购项 ${index + 1}`} · {moneyValue(lineAmount(line))}
        </Header>
        <div className="proc-line-edit">
          <Choice error={errors[`${line.id}.material`]} label={`商品 ${index + 1} 对应采购项`} value={String(line.material_id || '')} disabled={busy || doc.receipts.some(r => r.lines.some(l => l.line_id === line.id))} options={choices} onChange={v => {
            const material = materials.find(m => m.id === Number(v));
            const previous = materials.find(m => m.id === line.material_id);
            lineSet(line.id, { material_id: Number(v), name: !line.name || line.name === previous?.name ? material?.name || '' : line.name, unit: material?.unit || line.unit });
          }} />
          <TextField error={errors[`${line.id}.quantity`]} hint={line.unit || '单位未填'} label={`商品 ${index + 1} 数量`} numeric value={line.quantity} disabled={busy} onChange={v => lineSet(line.id, { quantity: v || null })} />
          <TextField error={errors[`${line.id}.price`]} label={`商品 ${index + 1} 单价（USD）`} numeric value={line.unit_price} disabled={busy} onChange={v => lineSet(line.id, { unit_price: v || null })} />
          <TextField error={errors[`${line.id}.date`]} label={`商品 ${index + 1} 预计到货`} date value={line.expected_on} disabled={busy} onChange={v => lineSet(line.id, { expected_on: v || null })} />
          <div className="proc-line-issue"><TextField label={`商品 ${index + 1} 问题说明`} value={line.issue_note || ''} disabled={busy} onChange={issue_note => lineSet(line.id, { issue_note })} /></div>
        </div>
        {(line.brand || line.vendor || (line.delivery_address != null && line.delivery_address !== doc.delivery_address)) && <p className="proc-line-differences">{[line.brand && `品牌 ${line.brand}`, line.vendor && `卖家 ${line.vendor}`, line.delivery_address != null && line.delivery_address !== doc.delivery_address && `本项送至 ${line.delivery_address || '地址未填'}`].filter(Boolean).join(' · ')}</p>}
        <ExpandableSection headerText={`商品 ${index + 1} 品牌、规格与物流`}><div className="ui-order-grid">
          <TextField label={`商品 ${index + 1} 实际卖家`} value={line.vendor} disabled={busy} onChange={v => lineSet(line.id, { vendor: v })} />
          <TextField label={`商品 ${index + 1} 品牌`} value={line.brand} disabled={busy} onChange={v => lineSet(line.id, { brand: v })} />
          <TextField label={`商品 ${index + 1} 商品名称`} value={line.name} disabled={busy} onChange={v => lineSet(line.id, { name: v })} />
          <TextField label={`商品 ${index + 1} 单位`} value={line.unit} disabled={busy} onChange={v => lineSet(line.id, { unit: v })} />
          <TextField label={`商品 ${index + 1} 规格`} value={line.specification} disabled={busy} onChange={v => lineSet(line.id, { specification: v })} />
          <TextField label={`商品 ${index + 1} 型号`} value={line.model} disabled={busy} onChange={v => lineSet(line.id, { model: v })} />
          <TextField label={`商品 ${index + 1} 颜色`} value={line.color} disabled={busy} onChange={v => lineSet(line.id, { color: v })} />
          <TextField label={`商品 ${index + 1} 商品链接`} value={line.product_url} disabled={busy} onChange={v => lineSet(line.id, { product_url: v || null })} />
          <TextField label={`商品 ${index + 1} 图片链接`} value={line.image_url} disabled={busy} onChange={v => lineSet(line.id, { image_url: v || null })} />
          <TextField label={`商品 ${index + 1} 小计（如商家另计折扣）`} numeric value={line.amount} disabled={busy} onChange={v => lineSet(line.id, { amount: v || null })} />
          <TextField label={`商品 ${index + 1} 已取消数量`} numeric value={line.cancelled_quantity} disabled={busy} onChange={v => lineSet(line.id, { cancelled_quantity: v || '0' })} />
          <TextField label={`商品 ${index + 1} 备注`} value={line.selection_note} disabled={busy} onChange={v => lineSet(line.id, { selection_note: v })} />
          <TextField label={`商品 ${index + 1} 收货地址`} value={line.delivery_address ?? doc.delivery_address ?? ''} disabled={busy} onChange={delivery_address => lineSet(line.id, { delivery_address })} />
          <Choice label={`商品 ${index + 1} 网站状态（不代表实收）`} value={line.website_status || 'unknown'} options={websiteStatuses} disabled={busy} onChange={v => lineSet(line.id, { website_status: v as Delivery['website_status'] })} />
          <TextField label={`商品 ${index + 1} 物流链接`} value={line.tracking_url || ''} disabled={busy} onChange={v => lineSet(line.id, { tracking_url: v || null })} />
        </div></ExpandableSection>
      </section>)}
    </section>
    <TextField label="收货地址" value={doc.delivery_address || ''} disabled={busy} onChange={v => set('delivery_address', v)} />
    <ExpandableSection headerText="物流、备注与凭据"><SpaceBetween size="m">
      <div className="ui-order-grid">
        <TextField label="待处理事项" value={doc.follow_up} disabled={busy} onChange={v => set('follow_up', v)} />
        <TextField label="下次跟进日期" date value={doc.follow_up_on} disabled={busy} onChange={v => set('follow_up_on', v || null)} />
        <TextField label="最近人工核对日期" date value={doc.checked_on} disabled={busy} onChange={v => set('checked_on', v || null)} />
        <TextField label="订单备注" value={doc.note} disabled={busy} onChange={v => set('note', v)} />
        <TextField label="原订单链接" value={doc.order_url} disabled={busy} onChange={v => set('order_url', v || null)} />
        <TextField label="购买凭据链接" value={doc.voucher_url} disabled={busy} onChange={v => set('voucher_url', v || null)} />
        <TextField label="实际卖家 / 门店" value={doc.seller} disabled={busy} onChange={v => set('seller', v)} />
        <TextField label="采购主体" value={doc.purchasing_entity} disabled={busy} onChange={v => set('purchasing_entity', v)} />
      </div>
      {!!doc.deliveries.length && <ExpandableSection headerText="原配送记录（只读）">{doc.deliveries.map(d => <Box key={d.id}>{d.label} · {d.address} · 预计 {d.expected_on || '未填'} · {websiteStatuses.find(s => s.value === d.website_status)?.label}{d.tracking_number ? ` · ${d.tracking_number}` : ''}</Box>)}</ExpandableSection>}
    </SpaceBetween></ExpandableSection>
    <ExpandableSection headerText="税费、运费与金额核对"><div className="ui-order-grid">
      {(['tax', 'shipping', 'discount'] as const).map((key, i) => <TextField key={key} label={['税费（USD）', '运费（USD）', '折扣（USD）'][i]} numeric value={doc[key]} disabled={busy} onChange={v => set(key, v || null)} />)}
      <TextField label="金额核对说明" value={doc.reconciliation_note} disabled={busy} onChange={v => set('reconciliation_note', v)} />
    </div><Box>商品合计 {moneyValue(totals.subtotal)} · 计算总额 {moneyValue(totals.calculated)} · 差额 {moneyValue(totals.difference)}</Box></ExpandableSection>
  </SpaceBetween>;
}
