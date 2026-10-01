import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import DatePicker from '@cloudscape-design/components/date-picker';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, Steps, TodoRow } from '../api/client';
import { useFlash } from '../lib/flash';
import { useRole } from '../lib/role';
import {
actionHref,
actionLabel,
actionMode,
canActOn,
FIELD_LABEL,
nextUpFlash
} from '../lib/stepActions';
import { RoleLabel } from './RoleLabel';
import FormField from './ui/FormField';
import Header from './ui/Header';
import Table from './ui/Table';
import UploadForm from './UploadForm';

const KIND_LABEL: Record<string, string> = { get file() { return uiText("myTodoTable.provide.files"); }, get photo() { return uiText("myTodoTable.provide.photos"); }, get field() { return uiText("myTodoTable.enter.data"); }, get record() { return uiText("myTodoTable.record"); }, get confirm() { return uiText("myTodoTable.confirm"); }, get tick() { return uiText("myTodoTable.mark.done"); } };

type Row = TodoRow;

/** “轮到我做的”表：待办页和工作台小组件共用。行由后端 /api/dashboard/role 给。 */
export default function MyTodoTable({ rows, onReload, compact = false, actionOnly = false, initialFieldValues = {} }: { rows: Row[] | null; onReload: () => Promise<void> | void; compact?: boolean; actionOnly?: boolean; initialFieldValues?: Record<string, string | number | null | undefined> }) {
  useLanguage();
  const navigate = useNavigate();
  const role = useRole();
  const flash = useFlash();
  const [modal, setModal] = useState<{ kind: 'upload' | 'field' | 'confirm' | 'tick'; row: Row } | null>(null);
  const [fieldVal, setFieldVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const afterDone = async (doneTitle: string, projectId: number) => {
    const steps = await api.steps(projectId).catch(() => null as Steps | null);
    flash({ type: 'success', content: steps ? nextUpFlash(doneTitle, steps) : uiText('taskWorkflow.saved', { title: systemText(doneTitle) }) });
    setModal(null);
    await onReload();
  };

  const openAction = (row: Row) => {
    const canDo = row.for_confirm ? true : canActOn(row.item, role);
    const mode = actionMode(row.item, { forConfirm: row.for_confirm });
    if (mode === 'navigate' || mode === 'view' || (!canDo && mode !== 'confirm')) {
      navigate(actionHref(row.project.project_id, row.item, { forConfirm: row.for_confirm }));
      return;
    }
    if (mode === 'tick') {
      setModal({ kind: 'tick', row });
      return;
    }
    if (mode === 'confirm') {
      setModal({ kind: 'confirm', row });
      return;
    }
    if (mode === 'upload') {
      setModal({ kind: 'upload', row });
      return;
    }
    if (mode === 'field') {
      setFieldVal(String(initialFieldValues[row.item.deliverable?.field ?? ''] ?? ''));
      setModal({ kind: 'field', row });
    }
  };

  const doTick = async () => {
    if (!modal || modal.kind !== 'tick') return;
    setBusy(true);
    try {
      await api.toggleStep(modal.row.project.project_id, modal.row.item.key, { done: true });
      await afterDone(modal.row.item.title, modal.row.project.project_id);
    } catch (e: any) {
      flash({ type: 'error', content: e.message });
    } finally {
      setBusy(false);
    }
  };

  const doConfirm = async (confirmAs: string) => {
    if (!modal || modal.kind !== 'confirm') return;
    setBusy(true);
    try {
      await api.toggleStep(modal.row.project.project_id, modal.row.item.key, { done: true, confirm_as: confirmAs });
      await afterDone(modal.row.item.title, modal.row.project.project_id);
    } catch (e: any) {
      flash({ type: 'error', content: e.message });
    } finally {
      setBusy(false);
    }
  };

  const saveField = async () => {
    if (!modal || modal.kind !== 'field' || !modal.row.item.deliverable?.field) return;
    setSaving(true);
    try {
      const f = modal.row.item.deliverable.field;
      await api.patchProject(modal.row.project.project_id, { [f]: f === 'purchase_price' ? Number(fieldVal) : fieldVal.trim() || null });
      await afterDone(modal.row.item.title, modal.row.project.project_id);
    } catch (e: any) {
      flash({ type: 'error', content: e.message });
    } finally {
      setSaving(false);
    }
  };

  const current = (rows ?? []).filter((r) => r.is_current);
  const confirmCodes = modal?.kind === 'confirm'
    ? modal.row.item.confirm.filter((c) => !modal.row.item.confirmed.includes(c) && (role.actor === c || role.can('confirm_for_others')))
    : [];

  return (
    <>
      {actionOnly ? <SpaceBetween direction="horizontal" size="s">{(rows ?? []).map(row => <Button key={row.item.key} variant="primary" onClick={() => openAction(row)}>{actionLabel(row.item, { actor: role.actor, canDo: canActOn(row.item, role) })}</Button>)}</SpaceBetween> : <Table cardId="legacy-todo"
        variant={compact ? 'embedded' : 'container'}
        loading={rows === null}
        loadingText={uiText("myTodoTable.checking.which.properties.need.your.action")}
        items={rows ?? []}
        header={compact ? undefined : <Header variant="h2" counter={rows ? `(${rows.length})` : undefined} description={current.length ? uiText("sentences.items.belong.to.the.current.stage.the.rest.are.outstanding", { value1: (current.length) }) : uiText("myTodoTable.no.tasks.need.your.action.right.now")}>{uiText("myTodoTable.my.next.actions")}</Header>}
        empty={<Box textAlign="center" padding="l">{uiText("myTodoTable.no.tasks.need.your.action.right.now")}</Box>}
        columnDefinitions={[
          { id: 'p', header: uiText("myTodoTable.property"), cell: (r) => <div><div>{r.project.project_name}</div><Box variant="small" color="text-body-secondary">{r.project.address}</Box></div> },
          { id: 's', header: uiText("myTodoTable.stage"), cell: (r) => <span>{r.stage}{r.is_current && <Box variant="span" color="text-status-info">　{uiText("myTodoTable.current.stage")}</Box>}{r.project.stage === 'portfolio' && <Box variant="span" color="text-body-secondary">　{uiText("myTodoTable.sold.closeout")}</Box>}</span> },
          { id: 't', header: uiText("myTodoTable.what.to.do"), cell: (r) => <span className={r.item.gate ? "ui-strong" : undefined}>{r.item.owners.map((o) => <RoleLabel key={o} code={o} />)}{r.item.title}</span> },
          { id: 'd', header: uiText("myTodoTable.what.to.provide"), cell: (r) => (r.item.deliverable ? `${KIND_LABEL[r.item.deliverable.kind]} · ${r.item.deliverable.label}` : '—') },
          {
            id: 'a', header: '', width: 160, minWidth: 160,
            cell: (r) => {
              const canDo = r.for_confirm || canActOn(r.item, role);
              const label = actionLabel(r.item, { actor: role.actor, canDo, forConfirm: r.for_confirm });
              return (
                <span className="ui-nowrap">
                  <Button variant="primary" onClick={() => openAction(r)}>{label}</Button>
                </span>
              );
            },
          },
        ]}
      />}

      <TaskActionDialog inline={actionOnly}
        visible={modal?.kind === 'upload'}
        onDismiss={() => setModal(null)}
        size="large"
        header={modal?.kind === 'upload' ? `${modal.row.item.deliverable?.kind === 'photo' ? uiText("myTodoTable.provide.photos") : uiText("myTodoTable.provide.files")}：${systemText(modal.row.item.title)}` : ''}
      >
        {modal?.kind === 'upload' && (
          <UploadForm
            projectId={modal.row.project.project_id}
            docType={modal.row.item.deliverable?.doc_type ?? 'other'}
            lockType
            stepKey={modal.row.item.key}
            photoOnly={modal.row.item.deliverable?.kind === 'photo'}
            compact
            onDone={() => { afterDone(modal.row.item.title, modal.row.project.project_id); }}
          />
        )}
      </TaskActionDialog>

      <TaskActionDialog inline={actionOnly}
        visible={modal?.kind === 'field'}
        onDismiss={() => setModal(null)}
        header={modal?.kind === 'field' ? `${systemText(modal.row.item.title)}：${systemText(FIELD_LABEL[modal.row.item.deliverable?.field ?? ''] ?? '')}` : ''}
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" onClick={() => setModal(null)}>{uiText("fieldWithSource.cancel")}</Button><Button variant="primary" loading={saving} disabled={!fieldVal.trim() || (modal?.row.item.deliverable?.field === 'purchase_price' && !Number.isFinite(Number(fieldVal)))} onClick={saveField}>{uiText("fieldWithSource.save")}</Button></SpaceBetween></Box>}
      >
        {modal?.kind === 'field' && (
          <FormField label={systemText(FIELD_LABEL[modal.row.item.deliverable?.field ?? ''] ?? '')}>
            {modal.row.item.deliverable?.field?.endsWith('_date')
              ? <DatePicker value={fieldVal} onChange={({ detail }) => setFieldVal(detail.value)} placeholder="YYYY/MM/DD" />
              : modal.row.item.deliverable?.field === 'risks'
                ? <Textarea value={fieldVal} rows={3} onChange={({ detail }) => setFieldVal(detail.value)} placeholder={uiText("myTodoTable.death.disclosures.unpermitted.square.footage.and.other.known.risks")} />
                : <Input type="number" value={fieldVal} onChange={({ detail }) => setFieldVal(detail.value)} />}
          </FormField>
        )}
      </TaskActionDialog>

      <Modal
        visible={modal?.kind === 'tick'}
        onDismiss={() => setModal(null)}
        header={modal?.kind === 'tick' ? uiText("sentences.mark.complete", { value1: (modal.row.item.title) }) : ''}
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" onClick={() => setModal(null)}>{uiText("fieldWithSource.cancel")}</Button><Button variant="primary" loading={busy} onClick={doTick}>{uiText("myTodoTable.confirm.completion")}</Button></SpaceBetween></Box>}
      >
        {modal?.kind === 'tick' && (
          <Box>{uiText("myTodoTable.confirm.2")}{systemText(modal.row.item.title)}{uiText("myTodoTable.is.complete.the.next.responsible.role.will.then.be")}</Box>
        )}
      </Modal>

      <Modal
        visible={modal?.kind === 'confirm'}
        onDismiss={() => setModal(null)}
        header={modal?.kind === 'confirm' ? uiText("sentences.confirm.milestone", { value1: (modal.row.item.title) }) : ''}
        footer={<Box float="right"><Button variant="link" onClick={() => setModal(null)}>{uiText("myTodoTable.close")}</Button></Box>}
      >
        {modal?.kind === 'confirm' && (
          <SpaceBetween size="m">
            <Box>{modal.row.item.evidence_hint ?? uiText("myTodoTable.confirm.that.the.milestone.evidence.and.conditions.have.been")}</Box>
            <Box variant="small" color="text-body-secondary">{modal.row.project.project_name} · {modal.row.stage}</Box>
            <SpaceBetween direction="horizontal" size="s">
              {modal.row.item.confirmation_mode === "any" ? <Button variant="primary" loading={busy} disabled={!modal.row.item.ready || !confirmCodes.length} onClick={() => doConfirm(role.actor)}>{uiText("myTodoTable.confirm.conditions.met")}</Button> : confirmCodes.map((c) => (
                <Checkbox key={c} checked={false} disabled={busy} onChange={() => doConfirm(c)}>
                  <span className="ui-inline-tight">{uiText("myTodoTable.as")} {c} {uiText("myTodoTable.confirm")}</span>
                </Checkbox>
              ))}
              {!confirmCodes.length && <Box color="text-body-secondary">{uiText("myTodoTable.you.have.already.confirmed.or.do.not.have.permission")}</Box>}
            </SpaceBetween>
          </SpaceBetween>
        )}
      </Modal>
    </>
  );
}


/** Inline in MyTask so global display settings remain reachable without closing a draft. */
function TaskActionDialog({ inline, visible, header, onDismiss, footer, children, size }: {
  inline: boolean; visible: boolean; header: string; onDismiss: () => void; footer?: ReactNode; children: ReactNode; size?: 'large';
}) {
  useLanguage();
  if (!inline) return <Modal visible={visible} header={header} onDismiss={onDismiss} footer={footer} size={size}>{children}</Modal>;
  if (!visible) return null;
  return <section aria-label={header}><SpaceBetween size="m"><Header variant="h3">{header}</Header>{children}{footer ?? <Button onClick={onDismiss}>{uiText('fieldWithSource.cancel')}</Button>}</SpaceBetween></section>;
}
