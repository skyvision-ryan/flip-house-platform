import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import DatePicker from '@cloudscape-design/components/date-picker';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useCallback, useEffect, useState } from 'react';
import { api, Inspection } from '../api/client';
import { useActor } from '../lib/actor';
import { useRole } from '../lib/role';
import { useFlash } from '../lib/flash';
import { dateStr, text } from '../lib/format';
import { labelOf, useMeta } from '../lib/meta';
import { RoleLabel } from './RoleLabel';
import FormField from './ui/FormField';
import Table from './ui/Table';

const RESULT_KIND: Record<string, 'success' | 'error' | 'pending'> = { passed: 'success', failed: 'error', scheduled: 'pending' };
const EMPTY = { name: '', date: '', result: 'scheduled', is_final: false, fixer: '', note: '' };

/** 总览里的“检查记录”：一次检查一行，次数不固定。最后一次标 final，通过了清单里的“final”大节点自动过。 */
export default function InspectionsPanel({ projectId, onChanged }: { projectId: number; onChanged?: () => void }) {
  useLanguage();
  const meta = useMeta();
  const flash = useFlash();
  const { actor } = useActor();
  const canEdit = useRole().can('inspections');
  const [rows, setRows] = useState<Inspection[] | null>(null);
  const [editing, setEditing] = useState<Inspection | 'new' | null>(null);
  const [draft, setDraft] = useState<typeof EMPTY>(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.inspections(projectId).then(setRows), [projectId]);
  useEffect(() => { load(); }, [load]);

  if (!rows) return <Box textAlign="center" padding="m"><Spinner /></Box>;

  const resultOptions = meta?.inspection_results ?? [];
  const open = (i: Inspection | 'new') => {
    setError(''); setEditing(i);
    setDraft(i === 'new' ? EMPTY : { name: i.name, date: i.date ?? '', result: i.result, is_final: i.is_final, fixer: i.fixer ?? '', note: i.note ?? '' });
  };
  const submit = async () => {
    if (busy) return;
    if (!draft.name.trim()) { setError(uiText("inspectionsPanel.enter.what.was.inspected")); return; }
    setError('');
    setBusy(true);
    try {
      const body = { name: draft.name.trim(), date: draft.date || null, result: draft.result, is_final: draft.is_final, fixer: draft.fixer || null, note: draft.note || null };
      setRows(editing === 'new' ? await api.addInspection(projectId, body) : await api.patchInspection((editing as Inspection).id, body));
      setEditing(null);
      flash({ type: 'success', content: uiText("sentences.inspection.saved", { value1: (actor) }) });
      onChanged?.();
    } catch (e: any) {
      setError(uiText("sentences.not.saved", { value1: (e.message) }));
    } finally {
      setBusy(false);
    }
  };

  const passed = rows.filter((r) => r.result === 'passed').length;
  const failed = rows.filter((r) => r.result === 'failed');
  const finalOk = rows.some((r) => r.is_final && r.result === 'passed');
  return (
    <SpaceBetween size="s">
      <Box color="text-body-secondary">
        {rows.length === 0 ? uiText("inspectionsPanel.no.inspection.records.yet")
          : finalOk ? <StatusIndicator type="success">{uiText("inspectionsPanel.final.inspection.passed.construction.finished")}</StatusIndicator>
          : failed.length ? <StatusIndicator type="error">{failed.length} {uiText("inspectionsPanel.failed.inspections.corrections.in.progress")}</StatusIndicator>
          : <StatusIndicator type="in-progress">{uiText("inspectionsPanel.passed")} {passed} {uiText("inspectionsPanel.inspections.final.not.yet.passed")}</StatusIndicator>}
      </Box>
      <Table
        variant="embedded"
        items={rows}
        empty={<Box textAlign="center" color="inherit">{uiText("inspectionsPanel.record.each.inspection.here.when.the.work.is.ready")}</Box>}
        columnDefinitions={[
          { id: 'n', header: uiText("inspectionsPanel.visit.number"), width: 70, cell: (i) => rows.indexOf(i) + 1 },
          { id: 'name', header: uiText("inspectionsPanel.inspection.scope"), cell: (i) => <span>{i.name}{i.is_final && <b className="ui-final-label">{uiText("terminology.finalInspection")}</b>}</span> },
          { id: 'date', header: uiText("inspectionsPanel.date"), width: 110, cell: (i) => dateStr(i.date) },
          { id: 'res', header: uiText("inspectionsPanel.result"), width: 130, cell: (i) => <StatusIndicator type={RESULT_KIND[i.result] ?? 'pending'}>{labelOf(resultOptions, i.result)}</StatusIndicator> },
          { id: 'fixer', header: uiText("inspectionsPanel.assigned.to.correct.failures"), cell: (i) => (i.result === 'failed' ? text(i.fixer) || <Box color="text-status-error">{uiText("inspectionsPanel.not.entered")}</Box> : '—') },
          { id: 'note', header: uiText("inspectionsPanel.notes"), cell: (i) => text(i.note) },
          { id: 'who', header: uiText("inspectionsPanel.recorded.by"), width: 80, cell: (i) => (i.recorded_by ? <RoleLabel code={i.recorded_by} /> : '—') },
          { id: 'act', header: '', width: 120, cell: (i) => canEdit ? (
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="inline-link" onClick={() => open(i)}>{uiText("inspectionsPanel.edit")}</Button>
              <Button variant="inline-link" onClick={async () => { setRows(await api.deleteInspection(i.id)); onChanged?.(); }}>{uiText("inspectionsPanel.delete")}</Button>
            </SpaceBetween>
          ) : null },
        ]}
      />
      <Box>{canEdit && <Button iconName="add-plus" onClick={() => open('new')}>{uiText("inspectionsPanel.record.inspection")}</Button>}</Box>

      <Modal
        visible={editing !== null}
        onDismiss={() => { if (!busy) setEditing(null); }}
        header={editing === 'new' ? uiText("inspectionsPanel.record.inspection") : uiText("inspectionsPanel.edit.inspection")}
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" disabled={busy} onClick={() => setEditing(null)}>{uiText("fieldWithSource.cancel")}</Button><Button variant="primary" loading={busy} onClick={submit}>{uiText("fieldWithSource.save")}</Button></SpaceBetween></Box>}
      >
        <SpaceBetween size="m">
          {error && <Alert type="error">{systemText(error)}</Alert>}
          <ColumnLayout columns={2}>
            <FormField label={uiText("inspectionsPanel.inspection.scope")} description={uiText("inspectionsPanel.for.example.framing.rough.plumbing.electrical.roofing.or.final")}>
              <Input value={draft.name} onChange={({ detail }) => setDraft((d) => ({ ...d, name: detail.value }))} />
            </FormField>
            <FormField label={uiText("inspectionsPanel.date")}><DatePicker value={draft.date} onChange={({ detail }) => setDraft((d) => ({ ...d, date: detail.value }))} placeholder="YYYY/MM/DD" /></FormField>
            <FormField label={uiText("inspectionsPanel.result")}>
              <Select selectedOption={resultOptions.find((o) => o.value === draft.result) ?? null} options={resultOptions} onChange={({ detail }) => setDraft((d) => ({ ...d, result: detail.selectedOption.value! }))} />
            </FormField>
            <FormField label={uiText("inspectionsPanel.assigned.to.correct.failures")} description={uiText("inspectionsPanel.usually.the.pm.and.contractor")}>
              <Input value={draft.fixer} disabled={draft.result !== 'failed'} placeholder={uiText("inspectionsPanel.pm.contractor.name")} onChange={({ detail }) => setDraft((d) => ({ ...d, fixer: detail.value }))} />
            </FormField>
          </ColumnLayout>
          <Checkbox checked={draft.is_final} onChange={({ detail }) => setDraft((d) => ({ ...d, is_final: detail.checked }))}>{uiText("inspectionsPanel.this.is.a.final.inspection.the.latest.result.serves")}</Checkbox>
          <FormField label={uiText("inspectionsPanel.notes")}><Input value={draft.note} onChange={({ detail }) => setDraft((d) => ({ ...d, note: detail.value }))} /></FormField>
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}
