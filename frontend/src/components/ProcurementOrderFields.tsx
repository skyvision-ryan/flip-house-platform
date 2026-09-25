import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import Textarea from '@cloudscape-design/components/textarea';
import SpaceBetween from '@cloudscape-design/components/space-between';
import FormField from './ui/FormField';
import { shipmentStatuses, type ProcurementDraft } from '../lib/procurement';

export default function ProcurementOrderFields({ draft, onChange, disabled = false }: { draft: ProcurementDraft; onChange: (draft: ProcurementDraft) => void; disabled?: boolean }) {
  const set = (key: keyof ProcurementDraft, value: string) => onChange({ ...draft, [key]: value });
  return <SpaceBetween size="m">
    {([['retailer', '商家 / 网站', 'Amazon / Wayfair / Home Depot / 其他'], ['order_number', '订单号', ''], ['order_url', '订单链接', 'https://'], ['carrier', '承运商', ''], ['tracking_number', '物流单号', ''], ['tracking_url', '物流链接', 'https://']] as const).map(([key, label, placeholder]) => <FormField key={key} label={label}>
      <Input disabled={disabled} type={key.endsWith('_url') ? 'url' : 'text'} value={draft[key]} placeholder={placeholder} onChange={({ detail }) => set(key, detail.value)} />
    </FormField>)}
    <FormField label="网站物流状态" description="人工核对后登记；网站送达不等于现场已收货。"><Select disabled={disabled} options={shipmentStatuses} selectedOption={shipmentStatuses.find(s => s.value === draft.shipment_status) ?? shipmentStatuses[0]} onChange={({ detail }) => set('shipment_status', detail.selectedOption.value!)} /></FormField>
    <FormField label="待处理事项" description="例如改收货地址、联系商家、核对缺件；处理完后清空。"><Textarea disabled={disabled} value={draft.follow_up} onChange={({ detail }) => set('follow_up', detail.value)} /></FormField>
  </SpaceBetween>;
}
