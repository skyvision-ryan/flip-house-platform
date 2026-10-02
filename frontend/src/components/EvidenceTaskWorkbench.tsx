import Textarea from '@cloudscape-design/components/textarea';
import FormField from './ui/FormField';
import SubmissionList from './TaskSubmissionList';
import Link from '@cloudscape-design/components/link';
import ImageViewer from './ui/ImageViewer';
import TaskWaitModal from './TaskWaitModal';
import { useActor } from '../lib/actor';
import { useCallback, useEffect, useState, useRef } from 'react';
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
import { labelOf, useMeta } from '../lib/meta';

export default function EvidenceTaskWorkbench({ task, onChanged }: { task: Task; onChanged: (t: Task) => void }) {
  useLanguage(); const navigate = useNavigate();const meta=useMeta();
  const [data, setData] = useState<{ project: Project; steps: Steps; files: FileRow[] } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const { me } = useActor(); const [waiting, setWaiting] = useState(false);
  const [busy,setBusy]=useState(false),[returnReason,setReturnReason]=useState('');
  const request=useRef<{revision:number;key:string}|null>(null);
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
  const state=task.evidence_review;
  const facts=state?.facts?.facts??{};
  const utilities=Object.entries(facts).filter(([key])=>key.startsWith('utilities:')).flatMap(([,value])=>value as {id:number;kind:string;status:string}[]);
  const analysis=Object.entries(facts).find(([key])=>key.startsWith('analysis:'))?.[1] as {id:number;outputs:Record<string,number>}|null|undefined;
  const mark=async()=>{if(!state?.fingerprint||busy)return;setBusy(true);setError('');
    if(request.current?.revision!==state.revision)request.current={revision:state.revision,key:crypto.randomUUID()};
    try{onChanged(await api.markEvidence(task.project_id,task.id,{version:task.version,revision:state.revision,fingerprint:state.fingerprint,request_key:request.current.key}));}catch(e:any){setError(e.message);}finally{setBusy(false);}};
  return <SpaceBetween size="m">
    {state&&<StatusIndicator type={state.state==='reviewed'?'success':state.state==='recheck'?'warning':'pending'}>{m(state.state==='reviewed'?'review.reviewed':state.state==='recheck'?'review.recheck':state.state==='pending'?'review.pending':'workbench.missingEvidence')}</StatusIndicator>}
    {state?.receipt&&<Box>{m(state.state==='reviewed'?'review.by':'review.previousBy',{person:state.receipt.reviewer?.display_name??m('taskSummaryPanel.system'),at:dateTime(state.receipt.reviewed_at)})}</Box>}

    {!state&&<StatusIndicator type="pending">{m(task.satisfied ? task.completion_mode === 'record' ? 'taskWorkflow.recordMet' : 'taskWorkflow.met' : 'workbench.missingEvidence')}</StatusIndicator>}
    <Box color="text-body-secondary">{m(task.completion_mode === 'record' ? 'taskWorkflow.continuingHint' : 'taskWorkflow.autoHint')}</Box>
    <Facts columns={3} items={[
      { label: m('task.assignee'), value: task.assignee?.display_name ?? m('taskWorkflow.notAssigned') },
      { label: m('assistant.label'), value: <>{task.assistant?.display_name ?? m('assistant.none')}{task.assistant?.id === me?.id && ` (${m('assistant.mine')})`}</> },
      { label: m('taskTable.due'), value: dateStr(task.due_at) },
      ...(task.exec_status === 'waiting' ? [{ label: m('taskSummaryPanel.waiting.for'), value: `${task.wait_for || '—'} · ${task.wait_reason || '—'}` }] : []),
      ...(task.exec_status === 'waiting' && task.wait_until ? [{ label: m('taskWaitModal.expected.response.date.optional'), value: dateStr(task.wait_until) }] : []),
    ]} />
    <section className="task-evidence-requirements"><h3>{m('taskWorkflow.criterion')}</h3><p>{systemText(task.done_when) || '—'}</p><h3>{m('taskWorkflow.currentEvidence')}</h3><p>{currentEvidence}</p></section>
    {(utilities.length>0||analysis)&&<ExpandableSection headerText={m('review.evidenceSummary')} defaultExpanded><Facts columns={2} items={[
      ...utilities.map(u=>({label:labelOf(meta?.utility_kinds,u.kind),value:labelOf(meta?.utility_statuses,u.status)})),
      ...(analysis?[
        {label:m('review.analysisVersion'),value:String(analysis.id)},
        {label:m('analysisTab.total.profit'),value:money(analysis.outputs.total_profit,2)},
        {label:m('analysisTab.return.on.total.cost'),value:`${analysis.outputs.profit_margin_pct??'—'}%`},
      ]:[]),
    ]}/></ExpandableSection>}
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
    {error && <Alert type="error" action={<Button onClick={refresh}>{m('review.refresh')}</Button>}>{systemText(error)}</Alert>}
    {!data && !error && <Box>{m('taskWorkflow.loading')}</Box>}
    <div className="task-evidence-actions">
    {task.actions?.mark_evidence&&<Button variant="primary" loading={busy} onClick={()=>void mark()}>{m('review.mark')}</Button>}
    {task.actions?.reopen_evidence&&<SpaceBetween size="s"><FormField label={m('review.reason')}><Textarea value={returnReason} onChange={({detail})=>setReturnReason(detail.value)}/></FormField><Button loading={busy} disabled={!returnReason.trim()} onClick={async()=>{setBusy(true);try{onChanged(await api.reopenEvidence(task.project_id,task.id,{version:task.version,reason:returnReason.trim()}));setReturnReason('');setError('');}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>{m('review.reopen')}</Button></SpaceBetween>}
    {task.completion_mode==='evidence'&&!task.actions?.review_evidence&&<Box color="text-body-secondary">{m('review.denied')}</Box>}

    {data && item && <MyTodoTable actionOnly actionVariant="normal" initialFieldValues={{ risks: data.project.risks, purchase_price: data.project.purchase_price }} rows={[{ project: { project_id: task.project_id, project_name: task.project_name, address: task.project_address, stage: data.project.stage }, stage: task.stage_label, item, is_current: task.stage_index === task.project_current_stage_index, for_confirm: false }]} onReload={refresh} />}
    {(task.actions?.wait || task.actions?.resume) && <Button onClick={async () => {
      if (task.exec_status !== 'waiting') { setWaiting(true); return; }
      try { onChanged(await api.taskStatus(task.project_id, task.id, { version: task.version, action: 'resume' })); } catch (e: any) { setError(e.message); }
    }}>{m(task.exec_status === 'waiting' ? 'taskWorkbench.resume.work' : 'taskWorkbench.record.waiting')}</Button>}
    {task.actions?.start&&<Button loading={busy} onClick={async()=>{setBusy(true);try{onChanged(await api.taskStatus(task.project_id,task.id,{version:task.version,action:'start'}));}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>{m('taskWorkbench.start.work')}</Button>}
    {waiting && <TaskWaitModal task={task} onDone={next => { setWaiting(false); onChanged(next); }} onDismiss={() => setWaiting(false)} onConflict={() => { void refresh(); }} />}
    <Button variant="link" onClick={() => navigate(`/projects/${task.project_id}?tab=overview&step=${task.step_key}`)}>{m('taskWorkflow.goProperty')}</Button>
    </div>
    <ExpandableSection headerText={m('taskWorkflow.history')}>
      <TaskTimeline projectId={task.project_id} taskId={task.id} refreshKey={task.version + (task.satisfied ? 1 : 0)} />
      <SubmissionList subs={task.submissions} />
    </ExpandableSection>
  </SpaceBetween>;
}
