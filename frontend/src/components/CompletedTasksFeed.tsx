import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { api, type CompletedTasks, type Task } from '../api/client';
import { useActor } from '../lib/actor';
import { dateTime } from '../lib/format';
import { m, systemText } from '../i18n/core';
import { useLanguage } from '../i18n/LanguageProvider';
import { taskTitle } from '../i18n/templateNames';
import Container from './ui/Surface';
import Header from './ui/Header';
import TaskWorkbench from './TaskWorkbench';
import LanguageToggle from './LanguageToggle';

/** One current-result feed for Jessie/Cody and other authorized project members. */
export default function CompletedTasksFeed({refreshKey,onChanged}:{refreshKey:number;onChanged:()=>void}) {
  useLanguage();const {me}=useActor();
  const [data,setData]=useState<CompletedTasks|null>(null),[search,setSearch]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[task,setTask]=useState<Task|null>(null);
  const generation=useRef(0);
  const load=useCallback(async()=>{const version=++generation.current;try{const value=await api.completedTasks({search});if(version===generation.current){setData(value);setError('');}}catch(e:any){if(version===generation.current)setError(e.message);}},[search]);
  useEffect(()=>{void load();},[load,refreshKey]);
  const open=async(t:Task)=>{try{setTask(await api.task(t.project_id,t.id));}catch(e:any){setError(e.message);}};
  const more=async()=>{if(!data?.next_cursor)return;const version=generation.current;setBusy(true);try{const value=await api.completedTasks({search,until:data.until,cursor:data.next_cursor});if(version===generation.current)setData({...value,items:[...data.items,...value.items]});}catch(e:any){if(version===generation.current)setError(e.message);}finally{setBusy(false);}};
  return <Container cardId="widget-completed" header={<Header variant="h2" counter={data?`(${data.total})`:undefined} actions={<Button iconName="refresh" onClick={()=>void load()}>{m('workbench.refresh')}</Button>}>{m('review.completed')}</Header>}>
    <SpaceBetween size="m"><Box color="text-body-secondary">{m('review.currentOnly')}</Box><Input ariaLabel={m('review.completedSearch')} placeholder={m('workbench.search')} value={search} onChange={({detail})=>setSearch(detail.value)}/>
      {error&&<Alert type="error">{systemText(error)}</Alert>}
      {data&&!data.items.length&&<Box>{m('review.noCompleted')}</Box>}
      {data?.items.map(r=><div className="ui-list-item" key={r.task.id}><Button variant="inline-link" onClick={()=>void open(r.task)}>{r.task.project_name} · {taskTitle(r.task)}</Button><Box>{m('workbench.primary',{person:r.task.assignee?.display_name??m('personAvatar.unassigned')})}{r.task.assistant?` · ${m('workbench.helper',{person:r.task.assistant.display_name})}`:''}</Box><Box>{r.automatic?m('review.automatic'):r.confirmed_by?.display_name??m('review.authorizedReviewer')} · {r.time_zone_known?dateTime(r.confirmed_at):r.confirmed_at}</Box>{!r.time_zone_known&&<Box color="text-body-secondary">{m('review.unknownTime')}</Box>}</div>)}
      {data?.next_cursor&&<Button loading={busy} onClick={()=>void more()}>{m('workbench.loadMore')}</Button>}
    </SpaceBetween>
    {task&&<Modal visible size="large" header={taskTitle(task)} onDismiss={()=>setTask(null)} footer={<SpaceBetween direction="horizontal" size="m"><LanguageToggle/><Button onClick={()=>setTask(null)}>{m('workbench.close')}</Button></SpaceBetween>}><TaskWorkbench task={task} meId={me?.id??null} onChanged={value=>{setTask(value);void load();onChanged();}} onConflict={()=>void open(task)}/></Modal>}
  </Container>;
}
