import { systemText } from '../../i18n/core.ts';
import { useLanguage } from '../../i18n/LanguageProvider';
import { m as uiText } from '../../i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import DatePicker from '@cloudscape-design/components/date-picker';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useEffect, useRef, useState } from 'react';
import { api, Project } from '../../api/client';
import FormField from '../../components/ui/FormField';
import { useFlash } from '../../lib/flash';
import { useMeta } from '../../lib/meta';

interface Props { visible: boolean; project: Project; onDismiss: () => void; onSaved: () => void }

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
const str = (v: number | null | undefined) => (v == null ? '' : String(v));

export default function EditProjectModal({ visible, project, onDismiss, onSaved }: Props) {
  useLanguage();
  const meta = useMeta();
  const flash = useFlash();
  const [f, setF] = useState<any>({});
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const discardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (discard) discardRef.current?.focus(); }, [discard]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setDirty(false); setError(''); setDiscard(false);
      setF({
        name: project.name, strategy: project.strategy, stage: project.stage, substage: project.substage ?? '',
        lead_heat: project.lead_heat ?? 'warm_lead',
        purchase_price: str(project.purchase_price), target_arv: str(project.target_arv), sale_price: str(project.sale_price),
        purchase_date: project.purchase_date ?? '', construction_start: project.construction_start ?? '',
        construction_end: project.construction_end ?? '', list_date: project.list_date ?? '', sale_date: project.sale_date ?? '',
        status_override: project.status_override ?? '', status_override_reason: project.status_override_reason ?? '',
        risks: project.risks ?? '', notes: project.notes ?? '',
      });
    }
  }, [visible, project]);

  const set = (k: string, v: any) => { setDirty(true); setF((p: any) => ({ ...p, [k]: v })); };
  const close = () => { if (saving) return; if (dirty) setDiscard(true); else onDismiss(); };
  const substages = meta?.substages[f.stage] ?? [];
  const statusOptions = [{ label: uiText("editProjectModal.no.override.calculated.automatically"), value: '' }, ...(meta?.statuses.filter((s) => s.value !== 'done') ?? [])];
  const heatOptions = [{ label: uiText("leads.hot.lead"), value: 'hot_lead' }, { label: uiText("leads.warm.lead"), value: 'warm_lead' }];

  const save = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try {
      await api.patchProject(project.id, {
        name: f.name, strategy: f.strategy, stage: f.stage, substage: f.substage || null, lead_heat: f.lead_heat,
        purchase_price: numOrNull(f.purchase_price), target_arv: numOrNull(f.target_arv), sale_price: numOrNull(f.sale_price),
        purchase_date: f.purchase_date || null, construction_start: f.construction_start || null, construction_end: f.construction_end || null,
        list_date: f.list_date || null, sale_date: f.sale_date || null,
        status_override: f.status_override || null, status_override_reason: f.status_override ? f.status_override_reason : null,
        clear_status_override: !f.status_override,
        risks: f.risks || null, notes: f.notes || null,
      });
      flash({ type: 'success', content: uiText("editProjectModal.project.updated") });
      onSaved();
    } catch (e: any) {
      setError(uiText("sentences.not.saved", { value1: (e.message) }));
    } finally {
      setSaving(false);
    }
  };

  const date = (k: string, label: string) => (
    <FormField label={label}>
      <DatePicker value={f[k] ?? ''} onChange={({ detail }) => set(k, detail.value)} placeholder="YYYY/MM/DD" />
    </FormField>
  );

  return (
    <Modal
      visible={visible}
      onDismiss={close}
      size="large"
      header={uiText("editProjectModal.edit.project")}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={saving} onClick={close}>{uiText("fieldWithSource.cancel")}</Button>
            <Button variant="primary" loading={saving} onClick={save}>{uiText("fieldWithSource.save")}</Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="l">
        {error && <Alert type="error">{systemText(error)}</Alert>}
        {discard && <div ref={discardRef} tabIndex={-1}><Alert type="warning" header={uiText("analysisTab.unsaved.changes")} action={<SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setDiscard(false)}>{uiText("editProjectModal.continue.editing")}</Button><Button onClick={onDismiss}>{uiText("procurementItemPage.discard.changes")}</Button></SpaceBetween>}>{uiText("editProjectModal.closing.discards.these.inputs")}</Alert></div>}
        <ColumnLayout columns={3}>
          <FormField label={uiText("addProject.project.name")}><Input value={f.name ?? ''} onChange={({ detail }) => set('name', detail.value)} /></FormField>
          <FormField label={uiText("addProject.investment.strategy")}>
            <Select selectedOption={meta?.strategies.find((s) => s.value === f.strategy) ?? null} options={meta?.strategies ?? []} onChange={({ detail }) => set('strategy', detail.selectedOption.value)} />
          </FormField>
          <FormField label={uiText("myTodoTable.stage")} description={uiText("editProjectModal.advanced.by.checklist.milestones.cannot.be.edited.manually")}>
            <Select disabled selectedOption={meta?.stages.find((s) => s.value === f.stage) ?? null} options={meta?.stages ?? []} onChange={() => undefined} />
          </FormField>
          <FormField label={uiText("editProjectModal.substage")} description={uiText("editProjectModal.only.lead.follow.up.and.priority.can.be.edited")}>
            <Select disabled={f.stage !== 'lead'} selectedOption={substages.find((s) => s.value === f.substage) ?? null} options={substages} onChange={({ detail }) => set('substage', detail.selectedOption.value)} />
          </FormField>
          {f.stage === 'lead' && (
            <FormField label={uiText("editProjectModal.lead.priority")}>
              <Select selectedOption={heatOptions.find((h) => h.value === f.lead_heat) ?? null} options={heatOptions} onChange={({ detail }) => set('lead_heat', detail.selectedOption.value)} />
            </FormField>
          )}
        </ColumnLayout>
        <ColumnLayout columns={3}>
          <FormField label={uiText("stepActions.purchase.price.usd")}><Input type="number" value={f.purchase_price ?? ''} onChange={({ detail }) => set('purchase_price', detail.value)} /></FormField>
          <FormField label={uiText("addProject.after.repair.value.arv.usd")}><Input type="number" value={f.target_arv ?? ''} onChange={({ detail }) => set('target_arv', detail.value)} /></FormField>
          <FormField label={uiText("editProjectModal.actual.sale.price.usd")}><Input type="number" value={f.sale_price ?? ''} onChange={({ detail }) => set('sale_price', detail.value)} /></FormField>
        </ColumnLayout>
        <ColumnLayout columns={3}>
          {date('purchase_date', uiText("leadershipProjectDetail.purchase.date"))}
          {date('construction_start', uiText("stepActions.construction.start.date"))}
          {date('construction_end', uiText("leadershipProjectDetail.planned.finish.date"))}
          {date('list_date', uiText("stepActions.listing.date"))}
          {date('sale_date', uiText("stepActions.closing.date"))}
        </ColumnLayout>
        <ColumnLayout columns={2}>
          <FormField label={uiText("editProjectModal.status.override")} description={uiText("editProjectModal.calculated.from.budget.and.progress.by.default.override.with")}>
            <Select selectedOption={statusOptions.find((s) => s.value === f.status_override) ?? statusOptions[0]} options={statusOptions} onChange={({ detail }) => set('status_override', detail.selectedOption.value)} />
          </FormField>
          <FormField label={uiText("editProjectModal.override.reason")}>
            <Input value={f.status_override_reason ?? ''} disabled={!f.status_override} onChange={({ detail }) => set('status_override_reason', detail.value)} />
          </FormField>
        </ColumnLayout>
        <FormField label={uiText("cardRegistry.risk")} stretch><Textarea value={f.risks ?? ''} rows={3} onChange={({ detail }) => set('risks', detail.value)} /></FormField>
        <FormField label={uiText("inspectionsPanel.notes")} stretch><Textarea value={f.notes ?? ''} rows={2} onChange={({ detail }) => set('notes', detail.value)} /></FormField>
      </SpaceBetween>
    </Modal>
  );
}
