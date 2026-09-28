import { useState } from 'react';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
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
import { type OrderDocument, type OrderLine, newLine, moneyValue, lineAmount, reconcile } from '../lib/purchaseOrders';
import type { FieldErrors } from '../lib/procurementForm';
import type { NodeOption } from '../lib/orderStages';

/** One merchant order, shared delivery defaults, and a short list of material quantities. */
export default function PurchaseOrderEntry({ doc, onChange, materials, busy, nodes, defaultNode, onStageChange, onAddMaterial, onCustomizing, errors = {} }: {
  doc: OrderDocument; onChange: (doc: OrderDocument) => void; materials: ProcurementItem[]; busy: boolean; nodes: NodeOption[]; defaultNode: string; onStageChange: (stage: string) => void; onAddMaterial: (name: string, stage: string) => Promise<ProcurementItem>; onCustomizing: (value: boolean) => void; errors?: FieldErrors;
}) {
  const [customLine, setCustomLine] = useState<string | null>(null);
  const endCustom = () => { setCustomLine(null); onCustomizing(false); };
  const [expanded, setExpanded] = useState<string | null>(null);
  const common = { address: doc.delivery_address || '', expected_on: doc.lines[0]?.expected_on || null };
  const set = onChange;
  const lineSet = (id: string, patch: Partial<OrderLine>) => set({ ...doc, lines: doc.lines.map(l => l.id === id ? { ...l, ...patch } : l) });
  const commonSet = (field: 'address' | 'expected_on', value: string) => set(field === 'address'
    ? { ...doc, delivery_address: value }
    : { ...doc, lines: doc.lines.map(l => l.expected_on === common.expected_on || !l.expected_on ? { ...l, expected_on: value || null } : l) });
  const choices = materials.map(m => ({ value: String(m.id), label: m.name, description: nodes.find(n => n.value === m.wave)?.label }));
  const options = [...nodes].sort((a, b) => Number(b.value === defaultNode) - Number(a.value === defaultNode)).map(n => ({ label: n.label, options: choices.filter(o => materials.find(m => m.id === Number(o.value))?.wave === n.value) })).filter(g => g.options.length);
  return <SpaceBetween size="m">
    <div className="ui-order-entry-stage"><FormField label="采购阶段（必选）" errorText={errors.stage}><Select ariaLabel="采购阶段" options={nodes} selectedOption={nodes.find(n => n.value === defaultNode) ?? null} placeholder="选择本次采购阶段" disabled={busy || !!customLine} onChange={({ detail }) => onStageChange(detail.selectedOption.value!)} /></FormField></div>
    <div className="ui-order-entry-common">
      <FormField label="采购渠道 / 供应商（必填）" errorText={errors.vendor}><Autosuggest ariaLabel="采购渠道 / 供应商" value={doc.vendor} options={['Home Depot', 'Amazon', 'Wayfair'].map(value => ({ value }))} placeholder="选择或输入供应商" disabled={busy} onChange={({ detail }) => set({ ...doc, vendor: detail.value })} /></FormField>
      <TextField error={errors.order_number} label="订单号（必填）" value={doc.order_number} disabled={busy} onChange={order_number => set({ ...doc, order_number })} />
      <TextField error={errors.ordered_on} label="下单日期" date value={doc.ordered_on} disabled={busy} onChange={ordered_on => set({ ...doc, ordered_on: ordered_on || null })} />
      <TextField label="预计到货" date value={common.expected_on} disabled={busy} onChange={v => commonSet('expected_on', v)} />
      <div className="ui-order-entry-address"><TextField label="收货地址" value={common.address} disabled={busy} onChange={v => commonSet('address', v)} /></div>
    </div>
    <section aria-label="订单采购项">
      <Header variant="h2">采购项</Header>
      <div className="ui-order-entry-labels" aria-hidden="true"><span>采购项</span><span>数量</span><span>单价（USD）</span><span>小计</span><span /></div>
      {doc.lines.map((line, index) => {
        const delivery = { address: line.delivery_address ?? common.address, expected_on: line.expected_on };
        const different = delivery.address !== common.address || delivery.expected_on !== common.expected_on || !!line.vendor || !!line.brand;
        return <div className="ui-order-entry-item" key={line.id}>
          <div className="ui-order-entry-row">
            <div><span className="ui-order-entry-mobile-label">采购项</span><FormField errorText={errors[`${line.id}.material`]}><Select ariaLabel={`采购项 ${index + 1}`} disabled={busy || !!customLine} filteringType="auto" options={[...options, { value: '__custom__', label: '新增自定义采购项…' }]} selectedOption={choices.find(o => o.value === String(line.material_id)) ?? null} placeholder="选择采购项" onChange={({ detail }) => {
              if (detail.selectedOption.value === '__custom__') { setCustomLine(line.id); onCustomizing(true); return; }
              const material = materials.find(m => m.id === Number(detail.selectedOption.value));
              if (!defaultNode && material) onStageChange(material.wave);
              lineSet(line.id, { material_id: material?.id || 0, name: material?.name || '', unit: material?.unit || '件', specification: material?.specification || '', needed_on: material?.needed_on || null, location: material?.use_location || '' });
            }} /></FormField></div>
            <div><span className="ui-order-entry-mobile-label">数量</span><FormField errorText={errors[`${line.id}.quantity`]} constraintText={line.unit}><Input ariaLabel={`采购项 ${index + 1} 数量`} type="number" disabled={busy} value={String(line.quantity ?? '')} onChange={({ detail }) => lineSet(line.id, { quantity: detail.value || null })} /></FormField></div>
            <div><span className="ui-order-entry-mobile-label">单价（USD）</span><FormField errorText={errors[`${line.id}.price`]}><Input ariaLabel={`采购项 ${index + 1} 单价`} type="number" disabled={busy} value={String(line.unit_price ?? '')} onChange={({ detail }) => lineSet(line.id, { unit_price: detail.value || null, amount: null })} /></FormField></div>
            <div className="ui-order-entry-subtotal"><span className="ui-order-entry-mobile-label">小计</span>{moneyValue(lineAmount(line))}</div>
            <Button variant="inline-link" ariaLabel={`移除采购项 ${index + 1}`} disabled={busy || !!customLine} onClick={() => set({ ...doc, lines: doc.lines.filter(l => l.id !== line.id) })}>移除</Button>
          </div>
          {customLine === line.id && <ProcurementRequirementForm stages={nodes} defaultStage={defaultNode} onCancel={endCustom} onSave={async (name, stage) => {
            const material = await onAddMaterial(name, stage);
            lineSet(line.id, { material_id: material.id, name: material.name, unit: material.unit || '件' });
            if (!defaultNode) onStageChange(stage);
            endCustom();
          }} />}
          {different && <p className="proc-line-differences">{[line.brand && `品牌 ${line.brand}`, line.vendor && `卖家 ${line.vendor}`, delivery.expected_on !== common.expected_on && `本项预计 ${delivery.expected_on || '未填'}`, delivery.address !== common.address && `本项送至 ${delivery.address || '未填'}`].filter(Boolean).join(' · ')}</p>}
          <Button variant="inline-link" disabled={busy || !!customLine} onClick={() => setExpanded(expanded === line.id ? null : line.id)}>{expanded === line.id ? '收起' : different ? '查看商品补充信息' : '品牌 / 收货信息'}</Button>
          {(expanded === line.id || !!errors[`${line.id}.date`]) && <div className="ui-order-grid">
            <TextField label={`采购项 ${index + 1} 品牌`} value={line.brand} disabled={busy} onChange={brand => lineSet(line.id, { brand })} />
            <TextField label={`采购项 ${index + 1} 收货地址`} value={delivery.address} disabled={busy} onChange={delivery_address => lineSet(line.id, { delivery_address })} />
            <TextField error={errors[`${line.id}.date`]} label={`采购项 ${index + 1} 预计到货`} date value={line.expected_on || delivery.expected_on} disabled={busy} onChange={expected_on => lineSet(line.id, { expected_on: expected_on || null })} />
            <TextField label={`采购项 ${index + 1} 实际卖家`} value={line.vendor || doc.seller} disabled={busy} onChange={vendor => lineSet(line.id, { vendor })} />
          </div>}
        </div>;
      })}
      <Button iconName="add-plus" disabled={busy || !!customLine} onClick={() => set({ ...doc, lines: [...doc.lines, { ...newLine(), quantity: '1', expected_on: common.expected_on }] })}>添加采购项</Button>
    </section>
    <div className="ui-order-entry-total"><Box>商品合计 {moneyValue(reconcile(doc).subtotal)}</Box><TextField error={errors.total} hint="未知留空，零金额填 0。" label="订单实付（USD）" numeric value={doc.total} disabled={busy} onChange={total => set({ ...doc, total: total || null })} /></div>
    <ExpandableSection headerText="实际卖家 / 备注 / 链接"><div className="ui-order-grid">
      <TextField label="实际卖家" value={doc.seller} disabled={busy} onChange={seller => set({ ...doc, seller })} />
      <TextField label="备注" value={doc.note} disabled={busy} onChange={note => set({ ...doc, note })} />
      <TextField label="订单链接" value={doc.order_url} disabled={busy} onChange={order_url => set({ ...doc, order_url: order_url || null })} />
    </div></ExpandableSection>
  </SpaceBetween>;
}
