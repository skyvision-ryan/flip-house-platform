import DatePicker from '@cloudscape-design/components/date-picker';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import Textarea from '@cloudscape-design/components/textarea';
import SpaceBetween from '@cloudscape-design/components/space-between';
import FormField from './ui/FormField';
import { destinations, type ProcurementDraft } from '../lib/procurement';

export default function ProcurementFields({ draft, onChange, projectAddress, disabled = false }: {
  draft: ProcurementDraft; onChange: (draft: ProcurementDraft) => void; projectAddress: string; disabled?: boolean;
}) {
  const set = (key: keyof ProcurementDraft, value: string) => onChange({ ...draft, [key]: value });
  return <SpaceBetween size="m">
    <FormField label="采购备注"><Textarea disabled={disabled} value={draft.note} onChange={({ detail }) => set('note', detail.value)} placeholder="规格核对、交期跟进、收货说明…" /></FormField>
    <div className="ui-proc-form-grid">
      {([['ordered_on', '下单日期'], ['expected_on', '预计到货'], ['received_on', '实际到货']] as const).map(([key, label]) => <FormField key={key} label={label}>
        <DatePicker disabled={disabled} value={draft[key]} onChange={({ detail }) => set(key, detail.value)} placeholder="YYYY-MM-DD" />
      </FormField>)}
    </div>
    <FormField label="收货地点"><Select disabled={disabled} selectedOption={destinations.find(d => d.value === draft.delivery_type) ?? null} placeholder="选择收货地点" options={[{ value: '', label: '未确定' }, ...destinations]}
      onChange={({ detail }) => { const kind = detail.selectedOption.value!; onChange({ ...draft, delivery_type: kind, delivery_address: kind === 'project' ? projectAddress : '' }); }} /></FormField>
    {draft.delivery_type && <FormField label={draft.delivery_type === 'project' ? '房屋收货地址' : draft.delivery_type === 'company' ? '公司地址 / 收货说明（选填）' : '自定义收货地址'}>
      <Input value={draft.delivery_address} disabled={disabled || draft.delivery_type === 'project'} onChange={({ detail }) => set('delivery_address', detail.value)} />
    </FormField>}
    <FormField label="采购项总金额（美元）" description="此条目的合计金额；付款由财务另行登记。未确定可留空，0 表示零金额。"><Input disabled={disabled} type="number" value={draft.amount} onChange={({ detail }) => set('amount', detail.value)} /></FormField>
    <FormField label="规格 / 尺寸"><Input disabled={disabled} value={draft.specification} onChange={({ detail }) => set('specification', detail.value)} /></FormField>
    <FormField label="数量"><Input disabled={disabled} type="number" value={draft.quantity} onChange={({ detail }) => set('quantity', detail.value)} /></FormField>
    <FormField label="商品链接"><Input disabled={disabled} type="url" value={draft.product_url} onChange={({ detail }) => set('product_url', detail.value)} placeholder="https://" /></FormField>
  </SpaceBetween>;
}
