import CompletedTasksFeed from './CompletedTasksFeed';
import LanguageToggle from './LanguageToggle';
import { useCallback, useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { api, type Workbench, type WorkbenchProject, type Task, type TaskActivity } from '../api/client';
import { useActor } from '../lib/actor';
import { useMeta } from '../lib/meta';
import { useBusinessDate } from '../lib/useBusinessDate';
import { prioritizeToday } from '../lib/projectDates';
import { dueText, statusIndicator } from '../lib/taskGroups';
import { dateTime } from '../lib/format';
import { moneyValue } from '../lib/purchaseOrders';
import { taskTitle } from '../i18n/templateNames';
import { m, systemText } from '../i18n/core';
import { useLanguage } from '../i18n/LanguageProvider';
import NewTodayBadge from './NewTodayBadge';
import StagePositionBar from './StagePositionBar';
import TaskWorkbench from './TaskWorkbench';
import Header from './ui/Header';
import Container from './ui/Surface';

const activityLabels = {
  started:'workbench.change.started',submitted:'workbench.change.submitted',waiting:'workbench.change.waiting',resumed:'workbench.change.resumed',returned:'workbench.change.returned',confirmed:'workbench.change.confirmed',node_confirmed:'workbench.change.node_confirmed',evidence_satisfied:'workbench.change.evidence_satisfied',evidence_missing:'workbench.change.evidence_missing',evidence_reviewed:'workbench.change.evidence_reviewed',evidence_invalidated:'workbench.change.evidence_invalidated',procurement_completed:'workbench.change.procurement_completed',procurement_reopened:'workbench.change.procurement_reopened',
} as const;

export default function WorkbenchFocus({refreshKey=0}: {refreshKey?:number}) {
  useLanguage(); const navigate=useNavigate(), meta=useMeta(), {me}=useActor(), day=useBusinessDate();
  const [params,setParams]=useSearchParams();
  const today=params.get('today')==='1', stage=params.get('workStage')??'', search=params.get('workSearch')??'';
  const [resultRevision,setResultRevision]=useState(0);
  const [data,setData]=useState<Workbench|null>(null), [err,setErr]=useState('');
  const [expanded,setExpanded]=useState<Set<number>>(new Set());
  const [detail,setDetail]=useState<Task|null>(null);
  const [activity,setActivity]=useState<{project:WorkbenchProject; until:string; data:TaskActivity|null}|null>(null);
  const [activityBusy,setActivityBusy]=useState(false);
  const generation=useRef(0);
  const reload=useCallback(async()=>{const request=++generation.current;try { const d=await api.workbench({new_today:today,stage_key:stage,search});if(request===generation.current){setData(d);setResultRevision(n=>n+1);setErr('');} }catch(e:any){setErr(e.message);}},[today,stage,search]);
  useEffect(()=>{void reload();},[reload,refreshKey,day]);
  useEffect(()=>{const focus=()=>{if(document.visibilityState==='visible')void reload();};window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);return()=>{window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};},[reload]);
  const filter=(key:string,value:string)=>setParams(prev=>{const next=new URLSearchParams(prev);value?next.set(key,value):next.delete(key);return next;},{replace:true});
  const open=async(t:Task)=>{try{setDetail(await api.task(t.project_id,t.id));}catch(e:any){setErr(e.message);}};
  const showActivity=async(p:WorkbenchProject)=>{const until=data?.activity_window?.until;if(!until)return;setActivity({project:p,until,data:null});setActivityBusy(true);try {const d=await api.taskActivity(p.project_id,until);setActivity({project:p,until,data:d});}catch(e:any){setErr(e.message);}finally{setActivityBusy(false);}};
  const more=async()=>{if(!activity?.data?.next_cursor)return;setActivityBusy(true);try{const d=await api.taskActivity(activity.project.project_id,activity.until,activity.data.next_cursor);setActivity({...activity,data:{...d,items:[...activity.data.items,...d.items]}});}catch(e:any){setErr(e.message);}finally{setActivityBusy(false);}};
  const people=(t:Task)=><div className="workbench-people"><span>{m('workbench.primary',{person:t.assignee?.display_name??m('personAvatar.unassigned')})}</span>{t.assistant&&<span>{m('workbench.helper',{person:t.assistant.display_name})}</span>}</div>;
  const tasks=(p:WorkbenchProject)=>{const items=p.in_progress_tasks??[];return <SpaceBetween size="s"><strong>{m('workbench.tasksCount',{count:items.length})}</strong>{!items.length&&<Box color="text-body-secondary">{m('workbench.noProgress')}</Box>}{(expanded.has(p.project_id)?items:items.slice(0,2)).map(t=><div key={t.id} className="workbench-task"><Button variant="inline-link" onClick={()=>void open(t)}>{taskTitle(t)}</Button><div className="workbench-task-meta"><StatusIndicator type={statusIndicator(t.exec_status)}>{systemText(t.exec_status_label)}</StatusIndicator>{t.due_at&&<span>{m('taskTable.due')} {dueText(t.due_at)}</span>}</div>{people(t)}</div>)}{items.length>2&&<Button variant="inline-link" onClick={()=>setExpanded(prev=>{const n=new Set(prev);n.has(p.project_id)?n.delete(p.project_id):n.add(p.project_id);return n;})}>{m(expanded.has(p.project_id)?'workbench.collapse':'workbench.showAll',{count:items.length})}</Button>}</SpaceBetween>;};
  const next=(p:WorkbenchProject)=>{
    const t=p.next_task,n=p.next_action;
    if(!n||!t)return <Box color="text-body-secondary">{m('workbenchFocus.all.current.stage.tasks.assigned')}</Box>;
    const alreadyShown=(expanded.has(p.project_id)?p.in_progress_tasks:p.in_progress_tasks?.slice(0,2))?.some(item=>item.id===t.id);
    return <div className="workbench-next">
      <Button variant="inline-link" onClick={()=>void open(t)}>{taskTitle(t)}</Button>
      <div>{m(n.kind==='review'?'workbench.nextReview':n.kind==='assign'?'workbench.needsAssignment':'workbench.nextWork')}</div>
      {/* Next actor is a responsibility distinct from the primary/helper. */}
      {n.actor ? <div>{m('workbench.nextActor',{person:n.actor.display_name})}</div> : n.kind==='review'&&<div>{m('review.authorizedReviewer')}</div>}
      {!alreadyShown&&<><StatusIndicator type={statusIndicator(t.exec_status)}>{systemText(t.exec_status_label)}</StatusIndicator>{people(t)}<div className="workbench-task-meta">{m('taskTable.due')} {dueText(t.due_at)}</div></>}
    </div>;
  };
  const procurement=(p:WorkbenchProject)=>p.procurement?<SpaceBetween size="xs"><Button variant="inline-link" onClick={()=>navigate(`/projects/${p.project_id}?tab=procurement`)}>{p.procurement.owner??m('personAvatar.unassigned')} · {p.procurement.ready}/{p.procurement.total} {m('workbenchFocus.requirements.met')}</Button><Box>{m('purchaseOrderCoverage.recorded.net.order.amount')} {p.procurement.order_count?moneyValue(p.procurement.order_count===p.procurement.missing_totals?null:p.procurement.spent):m('purchaseOrderCoverage.no.orders')}</Box>{p.procurement.missing_totals>0&&<Box>{m('sentences.orders.lack.payment.amounts.the.total.is.incomplete',{value1:p.procurement.missing_totals})}</Box>}{p.procurement.problems.length>0&&<Box>{m('sentences.items.need.action',{value1:p.procurement.problems.length,value2:p.procurement.problems[0].name,value3:p.procurement.problems[0].note})}</Box>}{!!p.procurement.arrival_checks&&<Box>{m('workbenchFocus.arrival.checks',{value1:p.procurement.arrival_checks})}</Box>}</SpaceBetween>:'—';
  const visible=prioritizeToday(data?.projects??[],p=>p.project_id,day);
  const stages=[{value:'',label:m('workbench.allStages')},...(meta?.stage_groups??[]).flatMap(g=>g.subs.length?g.subs.map(s=>({value:s.stage,label:`${systemText(g.label)} · ${systemText(s.label)}`})):g.stages.map(value=>({value,label:systemText(g.label)})))];
  return <SpaceBetween size="m">
    {err&&<Alert type="error">{systemText(err)}</Alert>}
    <Container cardId="workbench-projects" header={<Header variant="h2" counter={data?`(${visible.length})`:undefined} actions={<SpaceBetween direction="horizontal" size="xs"><Button iconName="refresh" onClick={()=>void reload()}>{m('workbench.refresh')}</Button><Button onClick={()=>navigate('/projects')}>{m('workbenchFocus.view.all.projects')}</Button></SpaceBetween>}>{m('workbenchFocus.project.focus')}</Header>}>
      <div className="workbench-filters"><Input ariaLabel={m('workbench.search')} placeholder={m('workbench.search')} value={search} onChange={({detail})=>filter('workSearch',detail.value)}/><Select ariaLabel={m('workbench.allStages')} options={stages} selectedOption={stages.find(s=>s.value===stage)??stages[0]} onChange={({detail})=>filter('workStage',detail.selectedOption.value??'')}/><Checkbox checked={today} onChange={({detail})=>filter('today',detail.checked?'1':'')}>{m('newToday.filter')}</Checkbox></div>
      <Box color="text-body-secondary">{m('workbench.scope')}</Box>
      {!data&&!err&&<StatusIndicator type="loading">{m('workbench.loadingProjects')}</StatusIndicator>}
      <div className="workbench-rows" role="list" aria-label={m('workbenchFocus.project.focus')}>
        <div className="workbench-columns" aria-hidden="true"><span>{m('workbench.propertyPosition')}</span><span>{m('workbench.inProgress')}</span><span>{m('workbench.action')}</span><span>{m('app.procurement')}</span><span>{m('workbench.activity')}</span></div>
        {visible.map(p=><article key={p.project_id} className="workbench-row" role="listitem" aria-label={p.project_name}>
          <div><Button variant="inline-link" onClick={()=>navigate(`/projects/${p.project_id}?tab=overview`)}>{p.project_name}</Button> <NewTodayBadge createdAt={p.created_at} day={day}/>{p.address.trim()!==p.project_name.trim()&&<Box color="text-body-secondary">{p.address}</Box>}<StagePositionBar position={p.group_position} compact/></div>
          <div><strong className="workbench-mobile-label">{m('workbench.inProgress')}</strong>{tasks(p)}</div>
          <div><strong className="workbench-mobile-label">{m('workbench.action')}</strong>{next(p)}</div>
          <div><strong className="workbench-mobile-label">{m('app.procurement')}</strong>{procurement(p)}</div>
          <div><strong className="workbench-mobile-label">{m('workbench.activity')}</strong><Button variant="inline-link" onClick={()=>void showActivity(p)}>{p.activity_count??0}</Button></div>
        </article>)}
        {data&&!visible.length&&<Box padding="l">{m(search||stage||today?'dashboard.no.matching.projects':'workbenchFocus.no.projects.yet')}</Box>}
      </div>
      {data?.activity_window?.complete_from&&<Box color="text-body-secondary">{m('workbench.completeFrom',{at:dateTime(data.activity_window.complete_from)})}</Box>}
    </Container>
    <CompletedTasksFeed refreshKey={resultRevision} onChanged={()=>void reload()}/>
    {detail&&<Modal visible size="large" header={taskTitle(detail)} onDismiss={()=>{setDetail(null);void reload();}} footer={<SpaceBetween direction="horizontal" size="m"><LanguageToggle/><Button onClick={()=>{setDetail(null);void reload();}}>{m('workbench.close')}</Button></SpaceBetween>}><TaskWorkbench task={detail} meId={me?.id??null} onChanged={t=>{setDetail(t);void reload();}} onConflict={()=>void open(detail)}/></Modal>}
    {activity&&<Modal visible header={`${activity.project.project_name} · ${m('workbench.activity')}`} onDismiss={()=>setActivity(null)} footer={<Button onClick={()=>setActivity(null)}>{m('workbench.close')}</Button>}><SpaceBetween size="m">{activity.data&&<Box>{m('workbench.window',{from:dateTime(activity.data.window.from),until:dateTime(activity.data.window.until),count:activity.data.total})}</Box>}{activity.data?.items.map(e=><div key={e.id} className="workbench-task"><Button variant="inline-link" onClick={async()=>{try{setDetail(await api.task(activity.project.project_id,e.task_id));setActivity(null);}catch(error:any){setErr(error.message);}}}>{taskTitle(e)}</Button><Box>{m(activityLabels[e.kind as keyof typeof activityLabels]??'workbench.change.started')} · {e.actor?.display_name??m('taskSummaryPanel.system')} · {dateTime(e.created_at)}</Box>{e.reason&&<Box>{e.reason}</Box>}</div>)}{activity.data?.next_cursor&&<Button loading={activityBusy} onClick={()=>void more()}>{m('workbench.loadMore')}</Button>}{!activity.data&&<Button loading={activityBusy}>{m('workbench.activity')}</Button>}</SpaceBetween></Modal>}
  </SpaceBetween>;
}
