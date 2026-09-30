import { useState } from 'react';
import TextFilter from '@cloudscape-design/components/text-filter';
import Modal from '@cloudscape-design/components/modal';
import Button from '@cloudscape-design/components/button';
import Alert from '@cloudscape-design/components/alert';
import Checkbox from '@cloudscape-design/components/checkbox';
import Textarea from '@cloudscape-design/components/textarea';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { api, type ProcurementItem, type Task } from '../api/client';
import { useActor } from '../lib/actor';
import { useMeta } from '../lib/meta';
import { userCan } from '../lib/role';
import TaskAssignModal from './TaskAssignModal';
import FormField from './ui/FormField';
import { ExpandableSection } from './ui/Surface';

export default function ProcurementManagement({projectId, items, task, onClose, onSaved}: {projectId:number;items:ProcurementItem[];task?:Task;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [query,setQuery]=useState('');
  const matches=(i:ProcurementItem)=>`${i.name} ${i.specification || ''}`.toLowerCase().includes(query.trim().toLowerCase());
  const meta=useMeta(); const {me}=useActor();
  const [selected,setSelected]=useState(items.filter(i=>i.in_worklist).map(i=>i.id));
  const [excluded,setExcluded]=useState<number[]>([]); const [reason,setReason]=useState('');
  const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [assign,setAssign]=useState(false);
  const changed=items.filter(i=>i.status!=='na' && !!i.in_worklist!==selected.includes(i.id));
  return <Modal visible size="large" header="管理本房采购" onDismiss={()=>{if(!busy && !changed.length && !excluded.length && !reason) onClose(); else setError('请先保存，或点击“放弃并关闭”。');}}
    footer={<SpaceBetween direction="horizontal" size="s"><Button disabled={busy} onClick={onClose}>{changed.length || excluded.length || reason ? '放弃并关闭':'关闭'}</Button></SpaceBetween>}>
    <div className="procurement-surface proc-management"><SpaceBetween size="m">
      {error && <Alert type="error">{error}</Alert>}
      <div>负责人：<strong>{task?.assignee?.display_name || '待分派'}</strong>{task?.due_at ? ` · 截止 ${task.due_at}` : ''}</div>
      {task && userCan(meta,me,'assign_tasks') && <Button disabled={busy || !!changed.length || !!excluded.length || !!reason} onClick={()=>setAssign(true)}>调整负责人 / 截止日期</Button>}
      <TextFilter filteringText={query} filteringPlaceholder="查找需要调整的需求" filteringAriaLabel="搜索管理采购需求" onChange={({detail})=>setQuery(detail.filteringText)} />
      <ExpandableSection headerText={`调整清单显示范围 · 已显示 ${selected.length} 项`}>
        <SpaceBetween size="s"><p>新房默认显示完整模板，无需再选范围。此处保留既有房屋的显示设置；不需要的材料请使用下方“不需要项”。</p>
          {items.filter(i=>i.status!=='na' && matches(i)).map(i=><Checkbox key={i.id} checked={selected.includes(i.id)} disabled={busy || !task?.assignee || !!i.order_managed || !!i.attention_reasons?.length} onChange={({detail})=>setSelected(detail.checked ? [...selected,i.id] : selected.filter(id=>id!==i.id))}>{i.name} · {meta?.procurement_waves.find(w=>w.value===i.wave)?.label}{i.order_managed ? ' · 已有关联订单' : ''}</Checkbox>)}
          {!items.some(i=>i.status!=='na' && matches(i)) && <p>没有匹配的需求，请更换搜索词。</p>}
          <Button disabled={!changed.length || busy || !!excluded.length || !!reason} loading={busy} onClick={async()=>{setBusy(true);setError('');try{await api.procurementWorklist(projectId,changed.map(i=>({id:i.id,updated_at:i.updated_at,selected:selected.includes(i.id)})));await onSaved();onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>保存本次范围</Button>
        </SpaceBetween>
      </ExpandableSection>
      <ExpandableSection headerText={`调整本房不需要项 · 当前 ${items.filter(i=>i.status==='na').length} 项`} defaultExpanded>
        <SpaceBetween size="s"><p>仅对尚未关联订单的需求标记不需要。原因与历史保留。</p>
          {items.filter(i=>!i.order_managed && i.status!=='na' && matches(i)).map(i=><Checkbox key={i.id} checked={excluded.includes(i.id)} disabled={busy || !!changed.length} onChange={({detail})=>setExcluded(detail.checked?[...excluded,i.id]:excluded.filter(id=>id!==i.id))}>{i.name}</Checkbox>)}
          <FormField label="不需要的原因"><Textarea disabled={busy || !!changed.length} value={reason} onChange={({detail})=>setReason(detail.value)} /></FormField>
          <Button disabled={!excluded.length || !reason.trim() || busy || !!changed.length} loading={busy} onClick={async()=>{setBusy(true);setError('');try{await api.procurementNotNeeded(projectId,{reason,items:excluded.map(id=>({id,updated_at:items.find(i=>i.id===id)!.updated_at}))});await onSaved();onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>保存不需要项</Button>
        </SpaceBetween>
      </ExpandableSection>
      {assign && task && <TaskAssignModal projectId={projectId} tasks={[task]} onDismiss={()=>setAssign(false)} onDone={()=>{setAssign(false);void onSaved();}} onConflict={()=>{setAssign(false);void onSaved();}} />}
    </SpaceBetween></div>
  </Modal>;
}
