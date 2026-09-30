import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import { useEffect, useRef, useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { Choice, TextField } from './PurchaseOrderFields';
import type { NodeOption } from '../lib/orderStages';

export default function ProcurementRequirementForm({ stages, defaultStage = '', onSave, onCancel }: {
  stages: NodeOption[]; defaultStage?: string; onSave: (name: string, stage: string) => Promise<void>; onCancel: () => void;
}) {
  useLanguage();
  const form = useRef<HTMLElement>(null);
  useEffect(()=>{form.current?.querySelector('input')?.focus();},[]);
  const [name, setName] = useState(''); const [stage, setStage] = useState(defaultStage);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <section ref={form} className="ui-proc-requirement" aria-label={uiText("procurementRequirementForm.new.procurement.requirement")}><SpaceBetween size="s">
    <h3>{uiText("procurementRequirementForm.add.requirement.for.this.property")}</h3><div className="ui-order-grid"><TextField label={uiText("procurementRequirementForm.requirement.name.required")} value={name} onChange={setName} disabled={busy} />
      <Choice label={uiText("procurementRequirementForm.use.milestone.required")} value={stage} options={stages} onChange={setStage} disabled={busy} /></div>
    {error && <Alert type="error">{systemText(error)}</Alert>}
    <SpaceBetween direction="horizontal" size="s"><Button variant="primary" loading={busy} disabled={!name.trim() || name.trim().length > 200 || !stage} onClick={async () => {
      setBusy(true); setError(''); try { await onSave(name.trim(), stage); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}>{uiText("procurementRequirementForm.add.requirement")}</Button><Button disabled={busy} onClick={onCancel}>{uiText("fieldWithSource.cancel")}</Button></SpaceBetween>
  </SpaceBetween></section>;
}
