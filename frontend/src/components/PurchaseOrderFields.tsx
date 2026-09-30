import { materialName } from '../i18n/templateNames.ts';
import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
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
  useLanguage();
  return <FormField label={label.replace(/^商品 \d+ /, '').replace(/^.* (?=本次实收数量$|其中破损数量$)/, '')} errorText={systemText(error)} constraintText={hint}><Input ariaLabel={label} value={value == null ? '' : String(value)} type={numeric ? 'number' : date ? 'text' : 'text'}
    placeholder={date ? 'YYYY-MM-DD' : undefined} disabled={disabled} onChange={({ detail }) => onChange(detail.value)} /></FormField>;
}
export function Choice({ label, value, options, onChange, disabled = false, error }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; disabled?: boolean; error?: string }) {
  useLanguage();
  return <FormField label={label.replace(/^商品 \d+ /, '').replace(/^.* (?=本次实收数量$|其中破损数量$)/, '')} errorText={systemText(error)}><Select ariaLabel={label} disabled={disabled} options={options} selectedOption={options.find(o => o.value === value) ?? null}
    placeholder={uiText("purchaseOrderFields.select")} onChange={({ detail }) => onChange(detail.selectedOption.value!)} /></FormField>;
}
export const websiteStatuses = [{ value: 'unknown', get label() { return uiText("purchaseOrderFields.unverified"); } }, { value: 'not_shipped', get label() { return uiText("purchaseOrderFields.not.shipped"); } }, { value: 'in_transit', get label() { return uiText("purchaseOrderFields.in.transit"); } }, { value: 'ready_pickup', get label() { return uiText("purchaseOrderFields.ready.for.pickup"); } }, { value: 'delivered', get label() { return uiText("purchaseOrderFields.carrier.shows.delivered"); } }, { value: 'exception', get label() { return uiText("purchaseOrderFields.shipment.exception"); } }];

export default function PurchaseOrderFields({ doc, onChange, materials, busy, nodes, defaultNode, errors = {} }: {
  doc: OrderDocument; onChange: (doc: OrderDocument) => void; materials: ProcurementItem[]; busy: boolean;
  nodes: NodeOption[]; defaultNode: string; errors?: FieldErrors;
}) {
  useLanguage();
  const set = <K extends keyof OrderDocument>(key: K, value: OrderDocument[K]) => onChange({ ...doc, [key]: value });
  const lineSet = (id: string, patch: Partial<OrderLine>) => set('lines', doc.lines.map(l => l.id === id ? { ...l, ...patch } : l));
  const totals = reconcile(doc);
  const choices = [...materials].sort((a, b) => Number(b.wave === defaultNode) - Number(a.wave === defaultNode)).map(m => ({ value: String(m.id), label: `${materialName(m)} · ${nodes.find(n => n.value === m.wave)?.label || m.wave}` }));
  return <SpaceBetween size="m">
    <div className="proc-common-fields">
      <TextField error={errors.vendor} label={uiText("purchaseOrderEntry.procurement.channel.supplier")} value={doc.vendor} disabled={busy} onChange={v => set('vendor', v)} />
      <TextField error={errors.order_number} label={uiText("purchaseOrderFields.merchant.order.number")} value={doc.order_number} disabled={busy} onChange={v => set('order_number', v)} />
      <TextField error={errors.ordered_on} label={uiText("procurementItemRow.order.date")} date value={doc.ordered_on} disabled={busy} onChange={v => set('ordered_on', v || null)} />
      <TextField error={errors.total} label={uiText("purchaseOrderEntry.record.order.payment.usd")} numeric value={doc.total} disabled={busy} onChange={v => set('total', v || null)} />
    </div>
    <section className="proc-order-products"><Header variant="h2" actions={<Button disabled={busy} onClick={() => set('lines', [...doc.lines, newLine()])}>{uiText("purchaseOrderFields.add.item")}</Button>}>{uiText("purchaseOrderFields.what.was.purchased")}</Header>
      {doc.lines.map((line, index) => <section className="ui-order-line" key={line.id}>
        <Header variant="h3" actions={<Button variant="inline-link" ariaLabel={uiText("sentences.remove.item", { value1: (index + 1) })} disabled={busy || doc.receipts.some(r => r.lines.some(l => l.line_id === line.id)) || doc.adjustments.some(a => a.line_id === line.id)} onClick={() => set('lines', doc.lines.filter(l => l.id !== line.id))}>{uiText("purchaseOrderEntry.remove")}</Button>}>
          {line.name || uiText("sentences.procurement.item", { value1: (index + 1) })} · {moneyValue(lineAmount(line))}
        </Header>
        <div className="proc-line-edit">
          <Choice error={errors[`${line.id}.material`]} label={uiText("sentences.requirement.for.item", { value1: (index + 1) })} value={String(line.material_id || '')} disabled={busy || doc.receipts.some(r => r.lines.some(l => l.line_id === line.id))} options={choices} onChange={v => {
            const material = materials.find(m => m.id === Number(v));
            const previous = materials.find(m => m.id === line.material_id);
            lineSet(line.id, { material_id: Number(v), name: !line.name || line.name === previous?.name ? material?.name || '' : line.name, unit: material?.unit || line.unit });
          }} />
          <TextField error={errors[`${line.id}.quantity`]} hint={line.unit || uiText("purchaseOrderFields.unit.not.entered")} label={uiText("sentences.item.quantity", { value1: (index + 1) })} numeric value={line.quantity} disabled={busy} onChange={v => lineSet(line.id, { quantity: v || null })} />
          <TextField error={errors[`${line.id}.price`]} label={uiText("sentences.item.unit.price.usd", { value1: (index + 1) })} numeric value={line.unit_price} disabled={busy} onChange={v => lineSet(line.id, { unit_price: v || null })} />
          <TextField error={errors[`${line.id}.date`]} label={uiText("sentences.item.estimated.arrival.2", { value1: (index + 1) })} date value={line.expected_on} disabled={busy} onChange={v => lineSet(line.id, { expected_on: v || null })} />
          <div className="proc-line-issue"><TextField label={uiText("sentences.item.issue.notes", { value1: (index + 1) })} value={line.issue_note || ''} disabled={busy} onChange={issue_note => lineSet(line.id, { issue_note })} /></div>
        </div>
        {(line.brand || line.vendor || (line.delivery_address != null && line.delivery_address !== doc.delivery_address)) && <p className="proc-line-differences">{[line.brand && uiText("sentences.brand", { value1: (line.brand) }), line.vendor && uiText("sentences.seller", { value1: (line.vendor) }), line.delivery_address != null && line.delivery_address !== doc.delivery_address && uiText("sentences.deliver.item.to", { value1: (line.delivery_address || uiText("purchaseOrderFields.address.not.entered")) })].filter(Boolean).join(' · ')}</p>}
        <ExpandableSection headerText={uiText("sentences.item.specifications.seller.and.tracking", { value1: (index + 1) })}><div className="ui-order-grid">
          <TextField label={uiText("sentences.item.actual.seller", { value1: (index + 1) })} value={line.vendor} disabled={busy} onChange={v => lineSet(line.id, { vendor: v })} />
          <TextField label={uiText("sentences.item.brand", { value1: (index + 1) })} value={line.brand} disabled={busy} onChange={v => lineSet(line.id, { brand: v })} />
          <TextField label={uiText("sentences.item.name", { value1: (index + 1) })} value={line.name} disabled={busy} onChange={v => lineSet(line.id, { name: v })} />
          <TextField label={uiText("sentences.item.unit", { value1: (index + 1) })} value={line.unit} disabled={busy} onChange={v => lineSet(line.id, { unit: v })} />
          <TextField label={uiText("sentences.item.specifications", { value1: (index + 1) })} value={line.specification} disabled={busy} onChange={v => lineSet(line.id, { specification: v })} />
          <TextField label={uiText("sentences.item.model", { value1: (index + 1) })} value={line.model} disabled={busy} onChange={v => lineSet(line.id, { model: v })} />
          <TextField label={uiText("sentences.item.color", { value1: (index + 1) })} value={line.color} disabled={busy} onChange={v => lineSet(line.id, { color: v })} />
          <TextField label={uiText("sentences.item.product.link", { value1: (index + 1) })} value={line.product_url} disabled={busy} onChange={v => lineSet(line.id, { product_url: v || null })} />
          <TextField label={uiText("sentences.item.image.link", { value1: (index + 1) })} value={line.image_url} disabled={busy} onChange={v => lineSet(line.id, { image_url: v || null })} />
          <TextField label={uiText("sentences.item.subtotal.including.merchant.specific.discounts", { value1: (index + 1) })} numeric value={line.amount} disabled={busy} onChange={v => lineSet(line.id, { amount: v || null })} />
          <TextField label={uiText("sentences.item.canceled.quantity", { value1: (index + 1) })} numeric value={line.cancelled_quantity} disabled={busy} onChange={v => lineSet(line.id, { cancelled_quantity: v || '0' })} />
          <TextField label={uiText("sentences.item.notes", { value1: (index + 1) })} value={line.selection_note} disabled={busy} onChange={v => lineSet(line.id, { selection_note: v })} />
          <TextField label={uiText("sentences.item.delivery.address", { value1: (index + 1) })} value={line.delivery_address ?? doc.delivery_address ?? ''} disabled={busy} onChange={delivery_address => lineSet(line.id, { delivery_address })} />
          <Choice label={uiText("sentences.item.carrier.status.not.proof.of.receipt", { value1: (index + 1) })} value={line.website_status || 'unknown'} options={websiteStatuses} disabled={busy} onChange={v => lineSet(line.id, { website_status: v as Delivery['website_status'] })} />
          <TextField label={uiText("sentences.item.tracking.link", { value1: (index + 1) })} value={line.tracking_url || ''} disabled={busy} onChange={v => lineSet(line.id, { tracking_url: v || null })} />
        </div></ExpandableSection>
      </section>)}
    </section>
    <TextField label={uiText("procurementItemRow.delivery.address")} value={doc.delivery_address || ''} disabled={busy} onChange={v => set('delivery_address', v)} />
    <ExpandableSection headerText={uiText("purchaseOrderFields.tracking.notes.and.receipts")}><SpaceBetween size="m">
      <div className="ui-order-grid">
        <TextField label={uiText("purchaseOrderFields.pending.actions")} value={doc.follow_up} disabled={busy} onChange={v => set('follow_up', v)} />
        <TextField label={uiText("purchaseOrderFields.next.follow.up.date")} date value={doc.follow_up_on} disabled={busy} onChange={v => set('follow_up_on', v || null)} />
        <TextField label={uiText("purchaseOrderFields.last.manual.verification.date")} date value={doc.checked_on} disabled={busy} onChange={v => set('checked_on', v || null)} />
        <TextField label={uiText("purchaseOrderFields.order.notes")} value={doc.note} disabled={busy} onChange={v => set('note', v)} />
        <TextField label={uiText("purchaseOrderFields.original.order.link")} value={doc.order_url} disabled={busy} onChange={v => set('order_url', v || null)} />
        <TextField label={uiText("purchaseOrderEntry.proof.of.purchase.link")} value={doc.voucher_url} disabled={busy} onChange={v => set('voucher_url', v || null)} />
        <TextField label={uiText("purchaseOrderFields.actual.seller.store")} value={doc.seller} disabled={busy} onChange={v => set('seller', v)} />
        <TextField label={uiText("purchaseOrderFields.purchasing.entity")} value={doc.purchasing_entity} disabled={busy} onChange={v => set('purchasing_entity', v)} />
      </div>
      {!!doc.deliveries.length && <ExpandableSection headerText={uiText("purchaseOrderFields.original.delivery.record.read.only")}>{doc.deliveries.map(d => <Box key={d.id}>{systemText(d.label)} · {d.address} {uiText("purchaseOrderFields.estimated")} {d.expected_on || uiText("procurementItemRow.not.entered.2")} · {systemText(websiteStatuses.find(s => s.value === d.website_status)?.label)}{d.tracking_number ? ` · ${d.tracking_number}` : ''}</Box>)}</ExpandableSection>}
    </SpaceBetween></ExpandableSection>
    <ExpandableSection headerText={uiText("purchaseOrderFields.tax.shipping.and.amount.reconciliation")}><div className="ui-order-grid">
      {(['tax', 'shipping', 'discount'] as const).map((key, i) => <TextField key={key} label={systemText(['税费（USD）', '运费（USD）', '折扣（USD）'][i])} numeric value={doc[key]} disabled={busy} onChange={v => set(key, v || null)} />)}
      <TextField label={uiText("purchaseOrderFields.amount.reconciliation.notes")} value={doc.reconciliation_note} disabled={busy} onChange={v => set('reconciliation_note', v)} />
    </div><Box>{uiText("purchaseOrderEntry.item.total")} {moneyValue(totals.subtotal)} {uiText("purchaseOrderFields.calculated.total")} {moneyValue(totals.calculated)} {uiText("purchaseOrderFields.difference")} {moneyValue(totals.difference)}</Box></ExpandableSection>
  </SpaceBetween>;
}
