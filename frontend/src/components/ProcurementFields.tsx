import DatePicker from '@cloudscape-design/components/date-picker';
import Input from '@cloudscape-design/components/input';
import Textarea from '@cloudscape-design/components/textarea';
import SpaceBetween from '@cloudscape-design/components/space-between';
import FormField from './ui/FormField';
import { type ProcurementDraft } from '../lib/procurement';

export default function ProcurementFields({ draft, onChange, disabled = false }: {
  draft: ProcurementDraft; onChange: (draft: ProcurementDraft) => void; disabled?: boolean;
}) {
  const set = (key: keyof ProcurementDraft, value: string) => onChange({ ...draft, [key]: value });
  return <SpaceBetween size="m">
    <FormField label="规格 / 尺寸"><Input disabled={disabled} value={draft.specification} onChange={({ detail }) => set('specification', detail.value)} /></FormField>
    <div className="ui-order-grid">
      <FormField label="需求数量"><Input disabled={disabled} type="number" value={draft.required_quantity} onChange={({ detail }) => set('required_quantity', detail.value)} /></FormField>
      <FormField label="需求单位"><Input disabled={disabled} value={draft.unit} placeholder="件 / 箱 / 平方英尺…" onChange={({ detail }) => set('unit', detail.value)} /></FormField>
      <FormField label="需要到场日期"><DatePicker disabled={disabled} value={draft.needed_on} placeholder="YYYY-MM-DD" onChange={({ detail }) => set('needed_on', detail.value)} /></FormField>
      <FormField label="需求预算（USD）" constraintText="采购计划金额，独立于财务预算与已付款。"><Input disabled={disabled} type="number" value={draft.budget_amount} onChange={({ detail }) => set('budget_amount', detail.value)} /></FormField>
      <FormField label="使用位置"><Input disabled={disabled} value={draft.use_location} onChange={({ detail }) => set('use_location', detail.value)} /></FormField>
    </div>
    <FormField label="需求备注"><Textarea disabled={disabled} value={draft.note} onChange={({ detail }) => set('note', detail.value)} placeholder="尺寸核对、使用要求、选型问题…" /></FormField>

    <FormField label="商品参考链接"><Input disabled={disabled} type="url" value={draft.product_url} onChange={({ detail }) => set('product_url', detail.value)} placeholder="https://" /></FormField>
  </SpaceBetween>;
}
