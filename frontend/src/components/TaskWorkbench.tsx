import Select from '@cloudscape-design/components/select';
import TaskCollaboration from './TaskCollaboration';
import SubmissionList from './TaskSubmissionList';
import EvidenceTaskWorkbench from './EvidenceTaskWorkbench';
import { taskTitle } from '../i18n/templateNames.ts';
import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Tabs from '@cloudscape-design/components/tabs';
import Textarea from '@cloudscape-design/components/textarea';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, FileRow, Submission, Task } from '../api/client';
import { useFlash } from '../lib/flash';
import { dateTime } from '../lib/format';
import { useMeta } from '../lib/meta';
import { stageKeyLabel } from '../lib/stageGroups';
import { dueText, statusActions, statusIndicator } from '../lib/taskGroups';
import HelpText from './HelpText';
import PersonAvatar from './PersonAvatar';
import TaskTimeline from './TaskTimeline';
import TaskWaitModal from './TaskWaitModal';
import ExpandableSection from './ui/ExpandableSection';
import KeyValuePairs from './ui/Facts';
import FormField from './ui/FormField';
import Header from './ui/Header';
import Container from './ui/Surface';
import ImageViewer from './ui/ImageViewer';
import UploadForm from './UploadForm';

// In-memory drafts survive task/tab navigation, scoped to the signed-in account.
// No project content is persisted to browser storage.
const deliveryDrafts = new Map<string, { note: string; reason: string; picked: number[] }>();
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * 任务处理组件（KAN-75 块 5，目标图 13 / 14 / 16）：详情 / 交付 / 活动记录 三个页签，
 * 负责人在「交付」里选文件、写说明、提交审核；审核人在同一处看文件、当前生效要求，退回或确认。
 * 三个入口（我的事项、总览、活动记录页）共用同一条任务，不复制状态。
 */
function TaskWorkbenchBody({ task, meId, onChanged, onConflict }: { task: Task; meId: number | null; onChanged: (t: Task) => void; onConflict: () => void }) {
  useLanguage();
  const meta = useMeta();
  const flash = useFlash();
  const navigate = useNavigate();
  const isAssignee = meId != null && task.assignee?.id === meId;
  const isReviewer = meId != null && task.reviewer?.id === meId;
  const canSubmit = task.actions?.submit ?? (isAssignee && !['pending_review', 'done'].includes(task.exec_status));
  const canReview = task.actions?.review ?? (isReviewer && task.exec_status === 'pending_review');
  const [confirmAs,setConfirmAs]=useState<string|null>(null);
  const [tab, setTab] = useState<string>(canReview ? 'deliver' : 'detail');
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { setTab(canReview || canSubmit ? 'deliver' : 'detail'); }, [task.id, canReview, canSubmit]);
  useEffect(() => { setWaiting(false); }, [task.project_id, task.id]);

  const bump = (t: Task) => { setRefreshKey((k) => k + 1); onChanged(t); };
  const handle = async (fn: () => Promise<Task>, ok: string) => {
    if (busy) return;
    setBusy(true);
    try { const changed = await fn(); deliveryDrafts.delete(`${meId}:${task.project_id}:${task.id}`); bump(changed); flash({ type: 'success', content: ok }); } catch (e: any) {
      const msg = String(e.message ?? e);
      flash({ type: e.status === 409 ? 'warning' : 'error', content: msg });
      if (e.status === 409) onConflict();
    } finally { setBusy(false); }
  };

  if (task.node_confirmation) {
    const node = task.node_confirmation;
    return <SpaceBetween size="m">
      <StatusIndicator type={task.satisfied ? 'success' : node.ready ? 'pending' : 'warning'}>{systemText(task.exec_status_label)}</StatusIndicator>
      {node.needs_review && <Alert type="warning">{uiText("taskWorkbench.previously.confirmed.but.prerequisites.have.changed.review.them.again")}</Alert>}
      <Box>{systemText(node.evidence_hint)}</Box>
      {node.history_pending && <Alert type="info">{uiText("taskWorkbench.history.from.before.entry.requires.supporting.records.and.verification")}</Alert>}
      {node.confirmation && <Box color="text-body-secondary">{node.confirmation.name} · {dateTime(node.confirmation.at)} {uiText("myTodoTable.confirm")}</Box>}
      {node.confirmation_mode==='all'&&node.can_confirm&&<Select ariaLabel={uiText('review.confirmAs')} options={node.confirm.filter(role=>!node.confirmed.includes(role)).map(value=>({value,label:value}))} selectedOption={confirmAs?{value:confirmAs,label:confirmAs}:null} placeholder={uiText('review.confirmAs')} onChange={({detail})=>setConfirmAs(detail.selectedOption.value??null)}/>}
      {!task.satisfied && <Button variant="primary" loading={busy} disabled={!node.ready || !task.actions?.confirm_node || (node.confirmation_mode==='all'&&!confirmAs)} onClick={() => handle(() => api.confirmTask(task.project_id, task.id, { version: task.version, confirm_as:confirmAs??undefined }), uiText("sentences.conditions.confirmed", { value1: (taskTitle(task)) }))}>{uiText("myTodoTable.confirm.conditions.met")}</Button>}
      {!node.can_confirm && <Box color="text-body-secondary">{uiText("taskWorkbench.by")} {node.confirm.join(' / ')} {uiText("taskWorkbench.or.a.project.lead.account")}</Box>}
      <Button variant="link" onClick={() => navigate(`/projects/${task.project_id}?tab=overview&step=${task.step_key}&action=confirm`)}>{uiText("taskWorkbench.view.property.and.prerequisites")}</Button>
      <TaskTimeline projectId={task.project_id} taskId={task.id} refreshKey={task.version + refreshKey} />
    </SpaceBetween>;
  }

  if (task.completion_mode === 'evidence' || task.completion_mode === 'record') return <EvidenceTaskWorkbench key={`${task.project_id}:${task.id}`} task={task} onChanged={onChanged} />;

  if (task.step_key === 'purchase') return <SpaceBetween size="m"><Alert type="info" action={<Button onClick={() => navigate(`/procurement?project=${task.project_id}`)}>{uiText("taskWorkbench.open.property.procurement")}</Button>}>{uiText("taskWorkbench.procurement.lead")}{task.assignee?.display_name || uiText("personAvatar.unassigned")} · {task.procurement_progress?.ready ?? 0} / {task.procurement_progress?.total ?? 0} {uiText("taskWorkbench.items.ready.procurement.progress.updates.from.the.list.automatically")}</Alert><TaskTimeline projectId={task.project_id} taskId={task.id} refreshKey={task.version} /></SpaceBetween>;

  const detail = (
    <SpaceBetween size="m">
      <KeyValuePairs columns={2} items={[
        { label: uiText("taskSummaryPanel.status"), value: <div><StatusIndicator type={statusIndicator(task.exec_status)}>{systemText(task.exec_status_label)}</StatusIndicator>{task.exec_status === 'waiting' && <Box variant="small" color="text-body-secondary">{uiText("taskSummaryPanel.waiting.for")} {task.wait_for || '—'}：{task.wait_reason}{task.wait_until ? uiText("sentences.expected.2", { value1: (dueText(task.wait_until)) }) : ''}</Box>}{task.exec_status === 'done' && task.done_at && <Box variant="small" color="text-body-secondary">{uiText("taskWorkbench.confirmed.on")} {dateTime(task.done_at)}</Box>}</div> },
        { label: uiText("taskTable.due"), value: task.due_at ? dueText(task.due_at) : <Box color="text-body-secondary">{uiText("projectPreplan.not.set")}</Box> },
        { label: uiText('task.assignee'), value: <PersonAvatar user={task.assignee} /> },
        { label: uiText("taskSummaryPanel.reviewer"), value: task.reviewer ? <PersonAvatar user={task.reviewer} /> : '—' },
        { label: uiText("taskWorkbench.process.position"), value: `${stageKeyLabel(meta?.stage_groups, task.stage_key, task.stage_label)}${task.stage_index > task.project_current_stage_index ? uiText("taskWorkbench.the.project.has.not.reached.this.point.yet.but") : ''}` },
        { label: uiText("taskSummaryPanel.evidence.assessment"), value: task.satisfied ? <div><StatusIndicator type="success">{uiText("taskSummaryPanel.requirements.met")}</StatusIndicator>{task.satisfied_evidence && <Box variant="small" color="text-body-secondary">{systemText(task.satisfied_evidence)}</Box>}</div> : <Box color="text-body-secondary">{uiText("taskSummaryPanel.requirements.not.met")}</Box> },
      ]} />
      {task.purpose && <div><Box fontWeight="bold">{uiText("taskDetail.task.purpose")}</Box><Box>{systemText(task.purpose)}</Box></div>}
      {task.deliverable && <div><Box fontWeight="bold">{uiText("taskDetail.required.deliverable")}</Box><Box>{systemText(task.deliverable.label)}{task.requires_file ? '' : uiText("taskWorkbench.explanation.only")}</Box></div>}
      {task.done_when && <div><Box fontWeight="bold">{uiText("taskWorkbench.requirements.to.satisfy")}</Box><Box>{systemText(task.done_when)}</Box></div>}
      <SpaceBetween direction="horizontal" size="xs">
        {statusActions(task, meId).map((a) => (
          a === 'start' ? <Button key={a} variant="primary" loading={busy} onClick={() => handle(() => api.taskStatus(task.project_id, task.id, { version: task.version, action: 'start' }), uiText("sentences.started", { value1: (taskTitle(task)) }))}>{uiText("taskWorkbench.start.work")}</Button>
            : a === 'resume' ? <Button key={a} variant="primary" loading={busy} onClick={() => handle(() => api.taskStatus(task.project_id, task.id, { version: task.version, action: 'resume' }), uiText("sentences.resumed", { value1: (taskTitle(task)) }))}>{uiText("taskWorkbench.resume.work")}</Button>
              : <Button key={a} onClick={() => setWaiting(true)}>{uiText("taskWorkbench.record.waiting")}</Button>
        ))}
        {canSubmit && <Button onClick={() => setTab('deliver')}>{uiText("taskWorkbench.provide.deliverables")}</Button>}
        <Button variant="link" onClick={() => navigate(`/projects/${task.project_id}?tab=overview`)}>{uiText("taskWorkbench.project.overview")}</Button>
      </SpaceBetween>
      {task.exec_status === 'done' && task.satisfied === false && <Alert type="warning">{uiText("taskWorkbench.the.reviewer.confirmed.completion.but.corresponding.project.evidence.is")}{task.deliverable?.label ?? uiText("taskWorkbench.deliverable")}{uiText("taskWorkbench.these.are.shown.separately.neither.replaces.the.other")}</Alert>}
    </SpaceBetween>
  );

  return (
    <SpaceBetween size="m">
      <Tabs
        activeTabId={tab}
        onChange={({ detail }) => setTab(detail.activeTabId)}
        tabs={[
          { id: 'detail', label: uiText("taskWorkbench.details"), content: detail },
          { id: 'deliver', label: canReview ? uiText("taskWorkbench.review") : uiText("taskWorkbench.delivery"), content: <DeliverTab key={`${task.project_id}:${task.id}`} task={task} meId={meId} canSubmit={canSubmit} canReview={canReview} busy={busy} onAction={handle} /> },
          { id: 'history', label: uiText("taskSummaryPanel.activity.history"), content: <TaskTimeline projectId={task.project_id} taskId={task.id} refreshKey={refreshKey} /> },
        ]}
      />
      {waiting && <TaskWaitModal key={`${task.project_id}:${task.id}`} task={task} onDone={(t) => { setWaiting(false); bump(t); flash({ type: 'success', content: uiText("sentences.waiting.recorded", { value1: (taskTitle(t)) }) }); }} onConflict={onConflict} onDismiss={() => setWaiting(false)} />}
    </SpaceBetween>
  );
}


function DeliverTab({ task, meId, canSubmit, canReview, busy, onAction }: { task: Task; meId: number | null; canSubmit: boolean; canReview: boolean; busy: boolean; onAction: (fn: () => Promise<Task>, ok: string) => Promise<void> }) {
  useLanguage();
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const draftKey = `${meId}:${task.project_id}:${task.id}`;
  const [picked, setPicked] = useState<number[]>(() => deliveryDrafts.get(draftKey)?.picked ?? []);
  const [note, setNote] = useState(() => deliveryDrafts.get(draftKey)?.note ?? '');
  const [reason, setReason] = useState(() => deliveryDrafts.get(draftKey)?.reason ?? '');
  const [fileError, setFileError] = useState('');
  useEffect(() => {
    if (!(canSubmit || canReview)) { deliveryDrafts.delete(draftKey); return; }
    deliveryDrafts.set(draftKey, { note, reason, picked });
    const prevent = (e: BeforeUnloadEvent) => { if (note || reason || picked.length) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [draftKey, note, reason, picked, canSubmit, canReview]);
  const [showUpload, setShowUpload] = useState(false);
  const docType = task.deliverable?.doc_type ?? null;
  useEffect(() => {
    let active = true;
    setFiles(null); setFileError(''); setShowUpload(false);
    if (canSubmit) {
      api.files(task.project_id).then(rows => { if (active) setFiles(rows); })
        .catch(e => { if (active) { setFiles([]); setFileError(e.message); } });
    }
    return () => { active = false; };
  }, [task.project_id, task.id, canSubmit]);
  const latest = task.submissions[0] ?? null;
  const candidates = (files ?? []).filter((f) => f.step_key === task.step_key || (docType && f.doc_type === docType));
  const others = (files ?? []).filter((f) => !candidates.includes(f));
  const requirement = (
    <Container embedded cardId="task-requirement" cardContext={taskTitle(task)} header={<Header variant="h3">{uiText("taskWorkbench.current.requirements")}</Header>}>
      <SpaceBetween size="xs">
        <Box>{task.deliverable ? task.deliverable.label : uiText("taskWorkbench.follow.the.task.instructions")}{task.requires_file ? '' : uiText("taskWorkbench.explanation.only")}</Box>
        {task.done_when && <Box variant="small" color="text-body-secondary">{systemText(task.done_when)}</Box>}
      </SpaceBetween>
    </Container>
  );

  if (canReview && latest) {
    return (
      <SpaceBetween size="m">
        <Container embedded cardId="task-submission" cardContext={taskTitle(task)} header={<Header variant="h2" description={`${latest.submitted_by?.display_name ?? '—'} · ${dateTime(latest.submitted_at)}`}>{uiText("taskWorkbench.number")} {latest.seq} {uiText("taskWorkbench.submission")}</Header>}>
          <SpaceBetween size="s">
            {latest.note && <Box>{latest.note}</Box>}
            {latest.files.length ? latest.files.map((f) => (
              <div key={f.id} className="ui-file-choice">
                {(f.mime ?? '').startsWith('image/') && <img src={`/api/files/${f.id}/download`} alt="" className="ui-thumbnail ui-thumbnail-delivery" />}
                <div>{f.mime?.startsWith('image/') ? <Button variant="inline-link" onClick={() => setPreview(f.id)}>{f.filename} {uiText("taskWorkbench.view.image")}</Button> : <Link href={`/api/files/${f.id}/download`} external>{f.filename}</Link>}<Box variant="small" color="text-body-secondary">{kb(f.size)}{f.uploaded_at ? ` · ${dateTime(f.uploaded_at)}` : ''}</Box></div>
              </div>
            )) : <Box color="text-body-secondary">{uiText("taskWorkbench.no.files.explanation.only")}</Box>}
          </SpaceBetween>
        </Container>
        {preview != null && <ImageViewer images={latest.files.filter(f => f.mime?.startsWith('image/')).map(f => ({ id: f.id, src: `/api/files/${f.id}/download`, label: f.filename }))} selectedId={preview} onClose={() => setPreview(null)} />}
        {requirement}
        <FormField label={uiText("taskWorkbench.review.notes.required.when.returning")} description={uiText("taskWorkbench.describe.the.changes.needed.optional.when.accepting")} stretch>
          <Textarea value={reason} rows={3} onChange={({ detail }) => setReason(detail.value)} />
        </FormField>
        <SpaceBetween direction="horizontal" size="xs">
          <Button loading={busy} onClick={() => { if (!reason.trim()) { return; } onAction(() => api.returnTask(task.project_id, task.id, { version: task.version, reason: reason.trim() }), uiText("sentences.returned.for.changes", { value1: (taskTitle(task)) })); }} disabled={!reason.trim()}>{uiText("taskWorkbench.return.for.changes")}</Button>
          <Button variant="primary" loading={busy} onClick={() => onAction(() => api.confirmTask(task.project_id, task.id, { version: task.version, reason: reason.trim() || null }), uiText("sentences.confirmed.completion.of", { value1: (taskTitle(task)) }))}>{uiText("taskWorkbench.accept.this.submission")}</Button>
        </SpaceBetween>
        <HelpText>{uiText("taskWorkbench.acceptance.completes.the.task.and.updates.the.workspace.project")}</HelpText>
        <SubmissionList subs={task.submissions.slice(1)} />
      </SpaceBetween>
    );
  }

  if (canSubmit) {
    return (
      <SpaceBetween size="m">
        {requirement}
        {latest?.decision === 'returned' && <Alert type="warning" header={uiText("sentences.submission.was.returned", { value1: (latest.seq) })}>{latest.decision_reason}</Alert>}
        {fileError && <Alert type="error" header={uiText("taskWorkbench.could.not.load.files")}>{fileError}</Alert>}
        <FormField label={task.requires_file ? uiText("taskWorkbench.files.for.this.submission.at.least.one") : uiText("taskWorkbench.attach.files.optional")} description={uiText("taskWorkbench.select.files.already.uploaded.to.this.property.or.upload")}>
          {files === null ? <Box color="text-body-secondary">{uiText("taskWorkbench.loading.files")}</Box> : (
            <SpaceBetween size="xs">
              {candidates.length === 0 && others.length === 0 && <Box color="text-body-secondary">{uiText("taskWorkbench.this.property.has.no.files.yet")}</Box>}
              {candidates.map((f) => <Checkbox key={f.id} checked={picked.includes(f.id)} onChange={({ detail }) => setPicked((p) => detail.checked ? [...p, f.id] : p.filter((x) => x !== f.id))}>{f.filename}<Box variant="span" color="text-body-secondary" fontSize="body-s">　{f.uploaded_by ?? '—'} · {dateTime(f.uploaded_at)}</Box></Checkbox>)}
              {others.length > 0 && (
                <ExpandableSection headerText={uiText("sentences.other.files.for.this.property", { value1: (others.length) })} variant="footer">
                  <SpaceBetween size="xxs">
                    {others.map((f) => <Checkbox key={f.id} checked={picked.includes(f.id)} onChange={({ detail }) => setPicked((p) => detail.checked ? [...p, f.id] : p.filter((x) => x !== f.id))}>{f.filename}<Box variant="span" color="text-body-secondary" fontSize="body-s">　{f.doc_type ?? ''} · {dateTime(f.uploaded_at)}</Box></Checkbox>)}
                  </SpaceBetween>
                </ExpandableSection>
              )}
              <Button variant="normal" iconName="upload" onClick={() => setShowUpload((v) => !v)}>{showUpload ? uiText("taskWorkbench.collapse.upload") : uiText("taskWorkbench.upload.new.file")}</Button>
              {showUpload && <Container embedded cardId="task-upload" cardContext={taskTitle(task)}><UploadForm projectId={task.project_id} docType={docType ?? 'other'} lockType={!!docType} stepKey={task.step_key} photoOnly={task.deliverable?.kind === 'photo'} compact onDone={async () => { const before = new Set((files ?? []).map((f) => f.id)); const after = await api.files(task.project_id); setFiles(after); setPicked((p) => [...p, ...after.filter((f) => !before.has(f.id)).map((f) => f.id)]); setShowUpload(false); }} /></Container>}
            </SpaceBetween>
          )}
        </FormField>
        <FormField label={task.requires_file ? uiText("taskWorkbench.delivery.notes.optional") : uiText("taskWorkbench.delivery.notes.required")} constraintText={uiText("taskWorkbench.unsubmitted.content.stays.in.this.page.session.only.it")} stretch>
          <Textarea value={note} rows={3} onChange={({ detail }) => setNote(detail.value)} placeholder={task.requires_file ? uiText("taskWorkbench.for.example.entrance.dimensions.have.been.added") : uiText("taskWorkbench.describe.what.you.did.and.the.result")} />
        </FormField>
        <SpaceBetween direction="horizontal" size="xs">
          <Button variant="primary" loading={busy} disabled={(task.requires_file && !picked.length) || (!task.requires_file && !note.trim() && !picked.length)} onClick={() => onAction(() => api.submitTask(task.project_id, task.id, { version: task.version, note: note.trim() || null, file_ids: picked }), uiText("sentences.submitted.awaiting.confirmation", { value1: (taskTitle(task)), value2: (task.reviewer?.display_name ?? uiText("taskSummaryPanel.reviewer")) }))}>{uiText("taskWorkbench.submit.for.review")}</Button>
          <HelpText>{uiText("taskWorkbench.uploading.does.not.submit.the.task.after.submission.it")} {task.reviewer?.display_name ?? uiText("taskSummaryPanel.reviewer")} {uiText("taskWorkbench.who.can.return.or.accept.it")}</HelpText>
        </SpaceBetween>
        <SubmissionList subs={task.submissions} />
      </SpaceBetween>
    );
  }

  return (
    <SpaceBetween size="m">
      {requirement}
      {task.exec_status === 'pending_review' && <Alert type="info">{uiText("taskWorkbench.submitted.awaiting")} {task.reviewer?.display_name ?? uiText("taskSummaryPanel.reviewer")} {uiText("taskWorkbench.confirmation")}</Alert>}
      {task.exec_status === 'done' && <Alert type="success">{uiText("taskWorkbench.handled.by")} {latest?.decided_by?.display_name ?? uiText("taskSummaryPanel.reviewer")} {uiText("myTodoTable.confirm.completion")}{task.done_at ? `（${dateTime(task.done_at)}）` : ''}。</Alert>}
      {meId != null && !canSubmit && !canReview && task.exec_status !== 'done' && task.exec_status !== 'pending_review' && <Box color="text-body-secondary">{uiText("taskWorkbench.this.task.is.assigned.to")} {task.assignee?.display_name ?? uiText("personAvatar.unassigned")} {uiText("taskWorkbench.and.reviewed.by")}{task.reviewer?.display_name ?? uiText("taskSummaryPanel.not.specified")} {uiText("taskWorkbench.you.have.read.only.access")}</Box>}
      <SubmissionList subs={task.submissions} />
    </SpaceBetween>
  );
}

export default function TaskWorkbench(props: {task: Task; meId: number | null; onChanged: (t: Task) => void; onConflict: () => void}) {
  return <SpaceBetween size="m"><TaskWorkbenchBody {...props} />{!props.task.node_confirmation && <TaskCollaboration key={`${props.meId}:${props.task.id}`} task={props.task} meId={props.meId} onChanged={props.onChanged} />}</SpaceBetween>;
}
