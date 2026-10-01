import SubmissionList from './TaskSubmissionList';
import Link from '@cloudscape-design/components/link';
import ImageViewer from './ui/ImageViewer';
import TaskWaitModal from './TaskWaitModal';
import { useActor } from '../lib/actor';
import { useCallback, useEffect, useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useNavigate } from 'react-router-dom';
import { api, type Project, type Steps, type Task, type FileRow } from '../api/client';
import { m, systemText } from '../i18n/core';
import { useLanguage } from '../i18n/LanguageProvider';
import MyTodoTable from './MyTodoTable';
import TaskTimeline from './TaskTimeline';
import Facts from './ui/Facts';
import ExpandableSection from './ui/ExpandableSection';
import { dateStr, dateTime, money } from '../lib/format';

export default function EvidenceTaskWorkbench({ task, onChanged }: { task: Task; onChanged: (t: Task) => void }) {
  useLanguage(); const navigate = useNavigate();
  const [data, setData] = useState<{ project: Project; steps: Steps; files: FileRow[] } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const { me } = useActor(); const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => { const [project, steps, files] = await Promise.all([api.project(task.project_id), api.steps(task.project_id), ['photo', 'file'].includes(task.deliverable?.kind ?? '') ? api.files(task.project_id) : Promise.resolve([])]); return { project, steps, files }; }, [task.project_id, task.deliverable?.kind]);
  useEffect(() => { let active = true; void load().then(next => { if (active) { setData(next); setError(''); } }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [load, task.version, task.satisfied]);
  const refresh = async () => { try { const next = await load(); setData(next); onChanged(await api.task(task.project_id, task.id)); setError(''); } catch (e: any) { setError(e.message); } };
  const item = data?.steps.stages.flatMap(stage => stage.items).find(i => i.key === task.step_key);
  const evidenceFiles = (data?.files ?? []).filter(file => item?.deliverable?.kind === 'photo' ? file.step_key === task.step_key && file.mime?.startsWith('image/') : item?.deliverable?.kind === 'file' && file.doc_type === item.deliverable.doc_type);
  const images = evidenceFiles.filter(file => file.mime?.startsWith('image/')).map(file => ({ id: file.id, src: `/api/files/${file.id}/download`, label: file.filename }));
  const currentEvidence = !task.satisfied ? '—'
    : item?.how === 'manual_override' || item?.how === 'manual' ? systemText(task.satisfied_evidence) || '—'
    : task.step_key === 'screen' && data?.project.risks?.trim() ? m('taskWorkflow.riskRecorded', { value: data.project.risks })
    : task.step_key === 'price' && data ? data.project.money_hidden ? m('taskWorkflow.priceHidden') : m('taskWorkflow.priceRecorded', { value: money(data.project.purchase_price, 2) })
    : item?.deliverable?.kind === 'photo' ? m('taskWorkflow.photos', { count: item.photo_count ?? 0 })
    : item?.deliverable?.kind === 'file' ? m('taskWorkflow.files', { count: evidenceFiles.length })
    : item?.deliverable?.kind === 'record' ? m('taskWorkflow.recordMet') : '—';
  return <SpaceBetween size="m">
    <StatusIndicator type={task.satisfied ? 'success' : 'pending'}>{m(task.satisfied ? task.completion_mode === 'record' ? 'taskWorkflow.recordMet' : 'taskWorkflow.met' : 'taskWorkflow.missing')}</StatusIndicator>
    <Box color="text-body-secondary">{m(task.completion_mode === 'record' ? 'taskWorkflow.continuingHint' : 'taskWorkflow.autoHint')}</Box>
    <Facts columns={2} items={[
      { label: m('task.assignee'), value: task.assignee?.display_name ?? m('taskWorkflow.notAssigned') },
      { label: m('taskTable.due'), value: dateStr(task.due_at) },
      { label: m('taskWorkflow.criterion'), value: systemText(task.done_when) || '—' },
      ...(task.exec_status === 'waiting' ? [{ label: m('taskSummaryPanel.waiting.for'), value: `${task.wait_for || '—'} · ${task.wait_reason || '—'}` }] : []),
      { label: m('taskWorkflow.currentEvidence'), value: currentEvidence },
    ]} />
    {task.step_key === 'loan_insurance' && <Box color="text-body-secondary">{m('taskWorkflow.insuranceScope')}</Box>}
    {task.step_key === 'services_off' && <Box color="text-body-secondary">{m('taskWorkflow.utilityScope')}</Box>}
    {item?.deliverable?.kind === 'photo' && <Box color="text-body-secondary">{m('taskWorkflow.photoScope')}</Box>}
    {evidenceFiles.length > 0 && <ExpandableSection headerText={m('taskWorkflow.evidenceFiles')} defaultExpanded>
      <SpaceBetween size="s">{evidenceFiles.map(file => <div key={file.id} className="ui-task-signal">
        {file.mime?.startsWith('image/') ? <><img src={`/api/files/${file.id}/download`} alt="" className="ui-thumbnail ui-thumbnail-delivery" onError={event => { event.currentTarget.hidden = true; }} /><Button variant="inline-link" onClick={() => setPreview(file.id)}>{file.filename} {m('taskWorkbench.view.image')}</Button></> : <Link href={`/api/files/${file.id}/download`} external>{file.filename}</Link>}
        <Box variant="small" color="text-body-secondary">{file.uploaded_by ?? '—'} · {dateTime(file.uploaded_at)}</Box>
      </div>)}</SpaceBetween>
    </ExpandableSection>}
    {preview != null && <ImageViewer images={images} selectedId={preview} onClose={() => setPreview(null)} />}
    {error && <Alert type="error" action={<Button onClick={refresh}>{m('taskWorkflow.retry')}</Button>}>{systemText(error)}</Alert>}
    {!data && !error && <Box>{m('taskWorkflow.loading')}</Box>}
    {data && item && <MyTodoTable actionOnly initialFieldValues={{ risks: data.project.risks, purchase_price: data.project.purchase_price }} rows={[{ project: { project_id: task.project_id, project_name: task.project_name, address: task.project_address, stage: data.project.stage }, stage: task.stage_label, item, is_current: task.stage_index === task.project_current_stage_index, for_confirm: false }]} onReload={refresh} />}
    {task.assignee?.id === me?.id && task.exec_status !== 'done' && <Button onClick={async () => {
      if (task.exec_status !== 'waiting') { setWaiting(true); return; }
      try { onChanged(await api.taskStatus(task.project_id, task.id, { version: task.version, action: 'resume' })); } catch (e: any) { setError(e.message); }
    }}>{m(task.exec_status === 'waiting' ? 'taskWorkbench.resume.work' : 'taskWorkbench.record.waiting')}</Button>}
    {waiting && <TaskWaitModal task={task} onDone={next => { setWaiting(false); onChanged(next); }} onDismiss={() => setWaiting(false)} onConflict={() => { setWaiting(false); void refresh(); }} />}
    <Button variant="link" onClick={() => navigate(`/projects/${task.project_id}?tab=overview&step=${task.step_key}`)}>{m('taskWorkflow.goProperty')}</Button>
    <ExpandableSection headerText={m('taskWorkflow.history')} defaultExpanded>
      <TaskTimeline projectId={task.project_id} taskId={task.id} refreshKey={task.version + (task.satisfied ? 1 : 0)} />
      <SubmissionList subs={task.submissions} />
    </ExpandableSection>
  </SpaceBetween>;
}
