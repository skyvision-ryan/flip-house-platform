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
import { type PurchaseOrder, type OrderDocument, type OrderLine, newLine, moneyValue, lineAmount, reconcile } from '../lib/purchaseOrders';
import type { FieldErrors } from '../lib/procurementForm';
import type { NodeOption } from '../lib/orderStages';

/** One merchant order, shared delivery defaults, and a short list of material quantities. */
export default function PurchaseOrderEntry({ doc, onChange, materials, orders, expectedOn, onExpectedChange, busy, nodes, defaultNode, onStageChange, onAddMaterial, onCustomizing, errors = {} }: {
  doc: OrderDocument; onChange: (doc: OrderDocument) => void; materials: ProcurementItem[]; orders: PurchaseOrder[]; expectedOn:string; onExpectedChange:(value:string)=>void; busy: boolean; nodes: NodeOption[]; defaultNode: string; onStageChange: (stage: string) => void; onAddMaterial: (name: string, stage: string) => Promise<ProcurementItem>; onCustomizing: (value: boolean) => void; errors?: FieldErrors;
}) {
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
  const choices = materials.filter(m => m.status !== 'na' || doc.lines.some(l => l.material_id === m.id)).map(m => ({ value: String(m.id), label: m.name, description: nodes.find(n => n.value === m.wave)?.label }));
  const addDemand = (material: ProcurementItem) => {
    const qty = materialQuantityFacts(material, orders);
    const line = {...newLine(material.id), name:material.name, unit:material.unit || '件', quantity:qty.unplaced != null && qty.unplaced > 0 ? String(qty.unplaced) : null,
      specification:material.specification || '', product_url:material.product_url || null, needed_on:material.needed_on || null, location:material.use_location || '', expected_on:common.expected_on};
    set({...doc, lines:[...doc.lines.filter(l => l.material_id), line]});
    if (!defaultNode) onStageChange(material.wave);
  };
  const candidates = materials.filter(m => m.status !== 'na' && (showOther || m.in_worklist) && `${m.name} ${m.specification || ''}`.toLowerCase().includes(demandQuery.trim().toLowerCase()));
  return <SpaceBetween size="m">
    <div className="ui-order-entry-stage"><FormField label="使用节点（必选）" errorText={errors.stage}><Select ariaLabel="采购阶段" options={nodes} selectedOption={nodes.find(n => n.value === defaultNode) ?? null} placeholder="选择本次主要使用节点" disabled={busy || !!customLine} onChange={({ detail }) => onStageChange(detail.selectedOption.value!)} /></FormField></div>
    <div className="ui-order-entry-common">
      <FormField label="采购渠道 / 供应商（必填）" errorText={errors.vendor}><Autosuggest ariaLabel="采购渠道 / 供应商" value={doc.vendor} options={['Home Depot', 'Amazon', 'Wayfair'].map(value => ({ value }))} placeholder="选择或输入供应商" disabled={busy} onChange={({ detail }) => set({ ...doc, vendor: detail.value })} /></FormField>
      <TextField error={errors.order_number} label="订单号（必填）" value={doc.order_number} disabled={busy} onChange={order_number => set({ ...doc, order_number })} />
      <TextField error={errors.ordered_on} label="下单日期" date value={doc.ordered_on} disabled={busy} onChange={ordered_on => set({ ...doc, ordered_on: ordered_on || null })} />
      <TextField label="预计到货" date value={common.expected_on} disabled={busy} onChange={v => commonSet('expected_on', v)} />
      <div className="ui-order-entry-address"><TextField label="收货地址" value={common.address} disabled={busy} onChange={v => commonSet('address', v)} /></div>
    </div>
    <section aria-label="订单采购项">
      <Header variant="h2" description="勾选已有需求，再核对本次订购数量与单价。">选择采购需求</Header>
      <div className="proc-demand-picker">
        <TextFilter filteringText={demandQuery} filteringPlaceholder="搜索本房需求" filteringAriaLabel="搜索可采购需求" onChange={({detail})=>setDemandQuery(detail.filteringText)} />
        {nodes.filter(n=>candidates.some(m=>m.wave===n.value)).map(n=><section key={n.value}><h3>{n.label}</h3>{candidates.filter(m=>m.wave===n.value).map(m=>{
          const quantity=materialQuantityFacts(m,orders); const checked=doc.lines.some(l=>l.material_id===m.id);
          return <div className="proc-demand-option" key={m.id}><Checkbox checked={checked} disabled={busy || !!customLine} onChange={({detail})=> detail.checked ? addDemand(m) : set({...doc,lines:doc.lines.filter(l=>l.material_id!==m.id)})}>{m.name}{!m.in_worklist ? ' · 尚未纳入本次' : ''}</Checkbox><span>{m.specification || '规格未填写'} · 需求 {m.required_quantity ?? '未填写'} {quantity.unit}</span><small>{quantity.text}</small></div>;
        })}</section>)}
        {!candidates.length && <Box>没有符合条件的需求。</Box>}
        <Button variant="inline-link" disabled={busy || !!customLine} onClick={()=>setShowOther(!showOther)}>{showOther ? '仅显示本次采购需求' : '查看本房其他已有需求'}</Button>
      </div>
      <Header variant="h3" counter={`(${doc.lines.filter(l=>l.material_id).length})`}>本单商品</Header>
      <div className="ui-order-entry-labels" aria-hidden="true"><span>采购项</span><span>数量</span><span>单价（USD）</span><span>小计</span><span /></div>
      {doc.lines.map((line, index) => {
        const delivery = { address: line.delivery_address ?? common.address, expected_on: line.expected_on };
        const different = delivery.address !== common.address || delivery.expected_on !== common.expected_on || !!line.vendor || !!line.brand;
        return <div className="ui-order-entry-item" key={line.id}>
          <div className="ui-order-entry-row">
            <div><FormField errorText={errors[`${line.id}.material`]}><strong>{choices.find(o => o.value === String(line.material_id))?.label || line.name || '待关联需求'}</strong>{!line.material_id && <Select ariaLabel={`关联导入商品 ${index+1}`} disabled={busy} filteringType="auto" options={choices} selectedOption={null} placeholder="选择本房需求以关联" onChange={({detail})=>{const material=materials.find(m=>m.id===Number(detail.selectedOption.value));if(material){lineSet(line.id,{material_id:material.id,name:material.name,unit:material.unit || line.unit,specification:material.specification || line.specification,needed_on:material.needed_on || null,location:material.use_location || ''});if(!defaultNode)onStageChange(material.wave);}}} />}<div className="proc-material-secondary">{line.specification}</div><small>{materials.find(m=>m.id===line.material_id) ? materialQuantityFacts(materials.find(m=>m.id===line.material_id)!,orders).text : ''}</small></FormField></div>
            <div><span className="ui-order-entry-mobile-label">数量</span><FormField errorText={errors[`${line.id}.quantity`]} constraintText={line.unit}><Input ariaLabel={`采购项 ${index + 1} 数量`} type="number" disabled={busy} value={String(line.quantity ?? '')} onChange={({ detail }) => lineSet(line.id, { quantity: detail.value || null })} /></FormField></div>
            <div><span className="ui-order-entry-mobile-label">单价（USD）</span><FormField errorText={errors[`${line.id}.price`]}><Input ariaLabel={`采购项 ${index + 1} 单价`} type="number" disabled={busy} value={String(line.unit_price ?? '')} onChange={({ detail }) => lineSet(line.id, { unit_price: detail.value || null, amount: null })} /></FormField></div>
            <div className="ui-order-entry-subtotal"><span className="ui-order-entry-mobile-label">小计</span>{moneyValue(lineAmount(line))}</div>
            <Button variant="inline-link" ariaLabel={`移除采购项 ${index + 1}`} disabled={busy || !!customLine} onClick={() => set({ ...doc, lines: doc.lines.filter(l => l.id !== line.id) })}>移除</Button>
          </div>
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
      {!doc.lines.length && <Box>勾选需求后，在这里填写本次订购数量和单价。</Box>}
      <Button iconName="add-plus" disabled={busy || !!customLine} onClick={()=>{setCustomLine('new');onCustomizing(true);}}>补充采购需求</Button>
      {customLine && <div className="proc-demand-new"><Box>保存后加入本房需求清单，并带入此订单；取消订单不会删除已补充的需求。</Box><ProcurementRequirementForm stages={nodes} defaultStage={defaultNode} onCancel={endCustom} onSave={async(name,stage)=>{const material=await onAddMaterial(name,stage);addDemand(material);endCustom();}} /></div>}
    </section>
    <div className="ui-order-entry-total"><Box>商品合计 {moneyValue(reconcile(doc).subtotal)}</Box><TextField error={errors.total} hint="未知留空，零金额填 0。" label="登记订单实付（USD）" numeric value={doc.total} disabled={busy} onChange={total => set({ ...doc, total: total || null })} /></div>
    <ExpandableSection headerText="卖家、备注与购买凭据"><div className="ui-order-grid">
      <TextField label="实际卖家" value={doc.seller} disabled={busy} onChange={seller => set({ ...doc, seller })} />
      <TextField label="备注" value={doc.note} disabled={busy} onChange={note => set({ ...doc, note })} />
      <TextField label="购买凭据链接" value={doc.voucher_url} disabled={busy} onChange={voucher_url => set({ ...doc, voucher_url: voucher_url || null })} />
      <TextField label="订单链接" value={doc.order_url} disabled={busy} onChange={order_url => set({ ...doc, order_url: order_url || null })} />
    </div></ExpandableSection>
  </SpaceBetween>;
}
