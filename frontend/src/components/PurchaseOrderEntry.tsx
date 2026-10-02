import { materialName, orderLineName, materialSearchText } from '../i18n/templateNames.ts';
import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import { useState } from 'react';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import TextFilter from '@cloudscape-design/components/text-filter';
import { materialQuantityFacts } from '../lib/procurementSummary';
import Autosuggest from '@cloudscape-design/components/autosuggest';
import FormField from './ui/FormField';
import ProcurementRequirementForm from './ProcurementRequirementForm';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ProcurementItem } from '../api/client';
import Header from './ui/Header';
import { ExpandableSection } from './ui/Surface';
import { TextField } from './PurchaseOrderFields';
import ProductThumb from './ProductThumb';
import { type PurchaseOrder, type OrderDocument, type OrderLine, newLine, moneyValue, lineAmount, reconcile } from '../lib/purchaseOrders';
import type { FieldErrors } from '../lib/procurementForm';
import type { NodeOption } from '../lib/orderStages';

/** One merchant order, shared delivery defaults, and a short list of material quantities. */
export default function PurchaseOrderEntry({ doc, onChange, materials, orders, expectedOn, onExpectedChange, busy, nodes, defaultNode, onStageChange, onAddMaterial, onCustomizing, errors = {} }: {
  doc: OrderDocument; onChange: (doc: OrderDocument) => void; materials: ProcurementItem[]; orders: PurchaseOrder[]; expectedOn:string; onExpectedChange:(value:string)=>void; busy: boolean; nodes: NodeOption[]; defaultNode: string; onStageChange: (stage: string) => void; onAddMaterial: (name: string, stage: string) => Promise<ProcurementItem>; onCustomizing: (value: boolean) => void; errors?: FieldErrors;
}) {
  useLanguage();
  const [demandQuery, setDemandQuery] = useState('');
  const [showOther, setShowOther] = useState(false);
  const [customLine, setCustomLine] = useState<string | null>(null);
  const endCustom = () => { setCustomLine(null); onCustomizing(false); };
  const [expanded, setExpanded] = useState<string | null>(null);
  const common = { address: doc.delivery_address || '', expected_on: expectedOn || null };
  const set = onChange;
  const lineSet = (id: string, patch: Partial<OrderLine>) => set({ ...doc, lines: doc.lines.map(l => l.id === id ? { ...l, ...patch } : l) });
  const commonSet = (field: 'address' | 'expected_on', value: string) => { if(field==='expected_on') onExpectedChange(value); set(field === 'address'
    ? { ...doc, delivery_address: value }
    : { ...doc, lines: doc.lines.map(l => l.expected_on === common.expected_on || !l.expected_on ? { ...l, expected_on: value || null } : l) }); };
  const choices = materials.filter(m => m.status !== 'na' || doc.lines.some(l => l.material_id === m.id)).map(m => ({ value: String(m.id), label: materialName(m), description: nodes.find(n => n.value === m.wave)?.label }));
  const addDemand = (material: ProcurementItem) => {
    const qty = materialQuantityFacts(material, orders);
    const line = {...newLine(material.id), name:material.name, unit:material.unit || '件', quantity:qty.unplaced != null && qty.unplaced > 0 ? String(qty.unplaced) : null,
      specification:material.specification || '', product_url:material.product_url || null, needed_on:material.needed_on || null, location:material.use_location || '', expected_on:common.expected_on};
    set({...doc, lines:[...doc.lines.filter(l => l.material_id), line]});
    if (!defaultNode) onStageChange(material.wave);
  };
  const candidates = materials.filter(m => m.status !== 'na' && (showOther || m.in_worklist) && `${materialSearchText(m)} ${m.specification || ''}`.toLowerCase().includes(demandQuery.trim().toLowerCase()));
  return <SpaceBetween size="m">
    <div className="ui-order-entry-stage"><FormField label={uiText("procurementRequirementForm.use.milestone.required")} errorText={systemText(errors.stage)}><Select ariaLabel={uiText("purchaseOrderEntry.procurement.stage")} options={nodes} selectedOption={nodes.find(n => n.value === defaultNode) ?? null} placeholder={uiText("purchaseOrderEntry.select.the.main.use.milestone.for.this.order")} disabled={busy || !!customLine} onChange={({ detail }) => onStageChange(detail.selectedOption.value!)} /></FormField></div>
    <div className="ui-order-entry-common">
      <div className="ui-order-entry-title"><TextField label={uiText("purchaseOrderEntry.order.title.optional")} value={doc.title ?? ''} disabled={busy} onChange={title => set({ ...doc, title })} /></div>
      <FormField label={uiText("purchaseOrderEntry.procurement.channel.supplier.required")} errorText={systemText(errors.vendor)}><Autosuggest ariaLabel={uiText("purchaseOrderEntry.procurement.channel.supplier")} value={doc.vendor} options={['Home Depot', 'Amazon', 'Wayfair'].map(value => ({ value }))} placeholder={uiText("purchaseOrderEntry.select.or.enter.a.supplier")} disabled={busy} onChange={({ detail }) => set({ ...doc, vendor: detail.value })} /></FormField>
      <TextField error={errors.order_number} label={uiText("purchaseOrderEntry.order.number.required")} value={doc.order_number} disabled={busy} onChange={order_number => set({ ...doc, order_number })} />
      <TextField error={errors.ordered_on} label={uiText("procurementItemRow.order.date")} date value={doc.ordered_on} disabled={busy} onChange={ordered_on => set({ ...doc, ordered_on: ordered_on || null })} />
      <TextField label={uiText("procurementItemRow.estimated.arrival")} date value={common.expected_on} disabled={busy} onChange={v => commonSet('expected_on', v)} />
      <div className="ui-order-entry-address"><TextField label={uiText("procurementItemRow.delivery.address")} value={common.address} disabled={busy} onChange={v => commonSet('address', v)} /></div>
    </div>
    <section aria-label={uiText("purchaseOrderEntry.order.items")}>
      <Header variant="h2" description={uiText("purchaseOrderEntry.select.existing.requirements.then.verify.order.quantities.and.unit")}>{uiText("purchaseOrderEntry.select.requirements")}</Header>
      <div className="proc-demand-picker">
        <TextFilter filteringText={demandQuery} filteringPlaceholder={uiText("purchaseOrderEntry.search.this.property.s.requirements")} filteringAriaLabel={uiText("purchaseOrderEntry.search.available.requirements")} onChange={({detail})=>setDemandQuery(detail.filteringText)} />
        {nodes.filter(n=>candidates.some(m=>m.wave===n.value)).map(n=><section key={n.value}><h3>{systemText(n.label)}</h3>{candidates.filter(m=>m.wave===n.value).map(m=>{
          const quantity=materialQuantityFacts(m,orders); const checked=doc.lines.some(l=>l.material_id===m.id);
          return <div className="proc-demand-option" key={m.id}><Checkbox checked={checked} disabled={busy || !!customLine} onChange={({detail})=> detail.checked ? addDemand(m) : set({...doc,lines:doc.lines.filter(l=>l.material_id!==m.id)})}>{materialName(m)}{!m.in_worklist ? uiText("purchaseOrderEntry.outside.current.scope") : ''}</Checkbox><span>{m.specification || uiText("purchaseOrderEntry.specifications.not.entered")} {uiText("purchaseOrderEntry.required")} {m.required_quantity ?? uiText("procurementItemRow.not.entered")} {systemText(quantity.unit)}</span><small>{quantity.text}</small></div>;
        })}</section>)}
        {!candidates.length && <Box>{uiText("purchaseOrderEntry.no.matching.requirements")}</Box>}
        <Button variant="inline-link" disabled={busy || !!customLine} onClick={()=>setShowOther(!showOther)}>{showOther ? uiText("purchaseOrderEntry.show.only.current.procurement.requirements") : uiText("purchaseOrderEntry.view.this.property.s.other.requirements")}</Button>
      </div>
      <Header variant="h3" counter={`(${doc.lines.filter(l=>l.material_id).length})`}>{uiText("purchaseOrderEntry.items.in.this.order")}</Header>
      <div className="ui-order-entry-labels" aria-hidden="true"><span>{uiText("purchaseOrderEntry.procurement.item")}</span><span>{uiText("procurementItemRow.quantity")}</span><span>{uiText("purchaseOrderEntry.unit.price.usd")}</span><span>{uiText("purchaseOrderEntry.subtotal")}</span><span /></div>
      {doc.lines.map((line, index) => {
        const delivery = { address: line.delivery_address ?? common.address, expected_on: line.expected_on };
        const different = delivery.address !== common.address || delivery.expected_on !== common.expected_on || !!line.vendor || !!line.brand;
        return <div className="ui-order-entry-item" key={line.id}>
          <div className="ui-order-entry-row">
            <div><FormField errorText={systemText(errors[`${line.id}.material`])}><strong>{orderLineName(line, materials) || uiText("purchaseOrderEntry.requirement.not.linked")}</strong>{!line.material_id && <Select ariaLabel={uiText("sentences.link.imported.item", { value1: (index+1) })} disabled={busy} filteringType="auto" options={choices} selectedOption={null} placeholder={uiText("purchaseOrderEntry.select.a.requirement.from.this.property")} onChange={({detail})=>{const material=materials.find(m=>m.id===Number(detail.selectedOption.value));if(material){lineSet(line.id,{material_id:material.id,name:material.name,unit:material.unit || line.unit,specification:material.specification || line.specification,needed_on:material.needed_on || null,location:material.use_location || '',product_url:line.product_url || material.product_url || null});if(!defaultNode)onStageChange(material.wave);}}} />}<div className="proc-material-secondary">{line.specification}</div><small>{materials.find(m=>m.id===line.material_id) ? materialQuantityFacts(materials.find(m=>m.id===line.material_id)!,orders).text : ''}</small></FormField></div>
            <div><span className="ui-order-entry-mobile-label">{uiText("procurementItemRow.quantity")}</span><FormField errorText={systemText(errors[`${line.id}.quantity`])} constraintText={systemText(line.unit)}><Input ariaLabel={uiText("sentences.procurement.item.quantity", { value1: (index + 1) })} type="number" disabled={busy} value={String(line.quantity ?? '')} onChange={({ detail }) => lineSet(line.id, { quantity: detail.value || null })} /></FormField></div>
            <div><span className="ui-order-entry-mobile-label">{uiText("purchaseOrderEntry.unit.price.usd")}</span><FormField errorText={systemText(errors[`${line.id}.price`])}><Input ariaLabel={uiText("sentences.procurement.item.unit.price", { value1: (index + 1) })} type="number" disabled={busy} value={String(line.unit_price ?? '')} onChange={({ detail }) => lineSet(line.id, { unit_price: detail.value || null, amount: null })} /></FormField></div>
            <div className="ui-order-entry-subtotal"><span className="ui-order-entry-mobile-label">{uiText("purchaseOrderEntry.subtotal")}</span>{moneyValue(lineAmount(line))}</div>
            <Button variant="inline-link" ariaLabel={uiText("sentences.remove.procurement.item", { value1: (index + 1) })} disabled={busy || !!customLine} onClick={() => set({ ...doc, lines: doc.lines.filter(l => l.id !== line.id) })}>{uiText("purchaseOrderEntry.remove")}</Button>
          </div>
          <div className="proc-line-links">
            <ProductThumb src={line.image_url} label={orderLineName(line, materials)} />
            <TextField error={errors[`${line.id}.product_url`]} label={uiText("sentences.item.product.link", { value1: (index + 1) })} value={line.product_url} disabled={busy} onChange={v => lineSet(line.id, { product_url: v || null })} />
            <TextField error={errors[`${line.id}.image_url`]} label={uiText("sentences.item.image.link", { value1: (index + 1) })} value={line.image_url} disabled={busy} onChange={v => lineSet(line.id, { image_url: v || null })} />
            <TextField error={errors[`${line.id}.tracking_url`]} label={uiText("sentences.item.tracking.link", { value1: (index + 1) })} value={line.tracking_url || ''} disabled={busy} onChange={v => lineSet(line.id, { tracking_url: v || null })} />
          </div>
          {different && <p className="proc-line-differences">{[line.brand && uiText("sentences.brand", { value1: (line.brand) }), line.vendor && uiText("sentences.seller", { value1: (line.vendor) }), delivery.expected_on !== common.expected_on && uiText("sentences.item.estimated.arrival", { value1: (delivery.expected_on || uiText("procurementItemRow.not.entered.2")) }), delivery.address !== common.address && uiText("sentences.deliver.item.to", { value1: (delivery.address || uiText("procurementItemRow.not.entered.2")) })].filter(Boolean).join(' · ')}</p>}
          <Button variant="inline-link" disabled={busy || !!customLine} onClick={() => setExpanded(expanded === line.id ? null : line.id)}>{expanded === line.id ? uiText("procurementItemRow.collapse") : different ? uiText("purchaseOrderEntry.view.additional.product.details") : uiText("purchaseOrderEntry.brand.receiving.details")}</Button>
          {(expanded === line.id || !!errors[`${line.id}.date`]) && <div className="ui-order-grid">
            <TextField label={uiText("sentences.procurement.item.brand", { value1: (index + 1) })} value={line.brand} disabled={busy} onChange={brand => lineSet(line.id, { brand })} />
            <TextField label={uiText("sentences.procurement.item.delivery.address", { value1: (index + 1) })} value={delivery.address} disabled={busy} onChange={delivery_address => lineSet(line.id, { delivery_address })} />
            <TextField error={errors[`${line.id}.date`]} label={uiText("sentences.procurement.item.estimated.arrival", { value1: (index + 1) })} date value={line.expected_on || delivery.expected_on} disabled={busy} onChange={expected_on => lineSet(line.id, { expected_on: expected_on || null })} />
            <TextField label={uiText("sentences.procurement.item.actual.seller", { value1: (index + 1) })} value={line.vendor || doc.seller} disabled={busy} onChange={vendor => lineSet(line.id, { vendor })} />
          </div>}
        </div>;
      })}
      {!doc.lines.length && <Box>{uiText("purchaseOrderEntry.select.requirements.then.enter.quantities.and.unit.prices.here")}</Box>}
      <Button iconName="add-plus" disabled={busy || !!customLine} onClick={()=>{setCustomLine('new');onCustomizing(true);}}>{uiText("purchaseOrderEntry.add.procurement.requirement")}</Button>
      {customLine && <div className="proc-demand-new"><Box>{uiText("purchaseOrderEntry.saving.adds.the.requirement.to.this.property.and.this")}</Box><ProcurementRequirementForm stages={nodes} defaultStage={defaultNode} onCancel={endCustom} onSave={async(name,stage)=>{const material=await onAddMaterial(name,stage);addDemand(material);endCustom();}} /></div>}
    </section>
    <div className="ui-order-entry-total"><Box>{uiText("purchaseOrderEntry.item.total")} {moneyValue(reconcile(doc).subtotal)}</Box><TextField error={errors.total} hint={uiText("purchaseOrderEntry.leave.unknown.amounts.blank.enter.0.only.for.a")} label={uiText("purchaseOrderEntry.record.order.payment.usd")} numeric value={doc.total} disabled={busy} onChange={total => set({ ...doc, total: total || null })} /></div>
    <ExpandableSection headerText={uiText("purchaseOrderEntry.seller.notes.and.proof.of.purchase")}><div className="ui-order-grid">
      <TextField label={uiText("purchaseOrderEntry.actual.seller")} value={doc.seller} disabled={busy} onChange={seller => set({ ...doc, seller })} />
      <TextField label={uiText("inspectionsPanel.notes")} value={doc.note} disabled={busy} onChange={note => set({ ...doc, note })} />
      <TextField error={errors.voucher_url} label={uiText("purchaseOrderEntry.proof.of.purchase.link")} value={doc.voucher_url} disabled={busy} onChange={voucher_url => set({ ...doc, voucher_url: voucher_url || null })} />
      <TextField error={errors.order_url} label={uiText("purchaseOrderEntry.order.link")} value={doc.order_url} disabled={busy} onChange={order_url => set({ ...doc, order_url: order_url || null })} />
    </div></ExpandableSection>
  </SpaceBetween>;
}
