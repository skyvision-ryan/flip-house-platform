import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import DatePicker from '@cloudscape-design/components/date-picker';
import Input from '@cloudscape-design/components/input';
import Textarea from '@cloudscape-design/components/textarea';
import SpaceBetween from '@cloudscape-design/components/space-between';
import FormField from './ui/FormField';
import { type ProcurementDraft } from '../lib/procurement';

export default function ProcurementFields({ draft, onChange, disabled = false }: {
  draft: ProcurementDraft; onChange: (draft: ProcurementDraft) => void; disabled?: boolean;
}) {
  useLanguage();
  const set = (key: keyof ProcurementDraft, value: string) => onChange({ ...draft, [key]: value });
  return <SpaceBetween size="m">
    <FormField label={uiText("procurementFields.specifications.dimensions")}><Input disabled={disabled} value={draft.specification} onChange={({ detail }) => set('specification', detail.value)} /></FormField>
    <div className="ui-order-grid">
      <FormField label={uiText("procurementFields.required.quantity")}><Input disabled={disabled} type="number" value={draft.required_quantity} onChange={({ detail }) => set('required_quantity', detail.value)} /></FormField>
      <FormField label={uiText("procurementFields.requirement.unit")}><Input disabled={disabled} value={draft.unit} placeholder={uiText("procurementFields.each.box.sq.ft")} onChange={({ detail }) => set('unit', detail.value)} /></FormField>
      <FormField label={uiText("procurementFields.required.on.site.date")}><DatePicker disabled={disabled} value={draft.needed_on} placeholder="YYYY-MM-DD" onChange={({ detail }) => set('needed_on', detail.value)} /></FormField>
      <FormField label={uiText("procurementFields.requirement.budget.usd")} constraintText={uiText("procurementFields.procurement.planning.amount.separate.from.the.financial.budget.and")}><Input disabled={disabled} type="number" value={draft.budget_amount} onChange={({ detail }) => set('budget_amount', detail.value)} /></FormField>
      <FormField label={uiText("procurementFields.use.location")}><Input disabled={disabled} value={draft.use_location} onChange={({ detail }) => set('use_location', detail.value)} /></FormField>
    </div>
    <FormField label={uiText("procurementFields.requirement.notes")}><Textarea disabled={disabled} value={draft.note} onChange={({ detail }) => set('note', detail.value)} placeholder={uiText("procurementFields.dimension.checks.use.requirements.selection.questions")} /></FormField>

    <FormField label={uiText("procurementFields.reference.product.link")}><Input disabled={disabled} type="url" value={draft.product_url} onChange={({ detail }) => set('product_url', detail.value)} placeholder="https://" /></FormField>
  </SpaceBetween>;
}
