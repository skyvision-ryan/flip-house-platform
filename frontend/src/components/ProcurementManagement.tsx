import { materialName } from '../i18n/templateNames.ts';
import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
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
  useLanguage();
  const [query,setQuery]=useState('');
  const matches=(i:ProcurementItem)=>`${i.name} ${i.specification || ''}`.toLowerCase().includes(query.trim().toLowerCase());
  const meta=useMeta(); const {me}=useActor();
  const [selected,setSelected]=useState(items.filter(i=>i.in_worklist).map(i=>i.id));
  const [excluded,setExcluded]=useState<number[]>([]); const [reason,setReason]=useState('');
  const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [assign,setAssign]=useState(false);
  const changed=items.filter(i=>i.status!=='na' && !!i.in_worklist!==selected.includes(i.id));
  return <Modal visible size="large" header={uiText("procurementManagement.manage.this.property.s.procurement")} onDismiss={()=>{if(!busy && !changed.length && !excluded.length && !reason) onClose(); else setError(uiText("procurementManagement.save.your.changes.or.select.discard.and.close"));}}
    footer={<SpaceBetween direction="horizontal" size="s"><Button disabled={busy} onClick={onClose}>{changed.length || excluded.length || reason ? uiText("procurementManagement.discard.and.close"):uiText("myTodoTable.close")}</Button></SpaceBetween>}>
    <div className="procurement-surface proc-management"><SpaceBetween size="m">
      {error && <Alert type="error">{systemText(error)}</Alert>}
      <div>{uiText("procurementManagement.procurement.lead")}<strong>{task?.assignee?.display_name || uiText("personAvatar.unassigned")}</strong>{task?.due_at ? uiText("sentences.due", { value1: (task.due_at) }) : ''}</div>
      {task && userCan(meta,me,'assign_tasks') && <Button disabled={busy || !!changed.length || !!excluded.length || !!reason} onClick={()=>setAssign(true)}>{uiText("procurementManagement.change.lead.due.date")}</Button>}
      <TextFilter filteringText={query} filteringPlaceholder={uiText("procurementManagement.find.requirements.to.update")} filteringAriaLabel={uiText("procurementManagement.search.procurement.requirements")} onChange={({detail})=>setQuery(detail.filteringText)} />
      <ExpandableSection headerText={uiText("sentences.adjust.displayed.requirements.shown", { value1: (selected.length) })}>
        <SpaceBetween size="s"><p>{uiText("procurementManagement.new.properties.show.the.full.template.automatically.existing.property")}</p>
          {items.filter(i=>i.status!=='na' && matches(i)).map(i=><Checkbox key={i.id} checked={selected.includes(i.id)} disabled={busy || !task?.assignee || !!i.order_managed || !!i.attention_reasons?.length} onChange={({detail})=>setSelected(detail.checked ? [...selected,i.id] : selected.filter(id=>id!==i.id))}>{materialName(i)} · {systemText(meta?.procurement_waves.find(w=>w.value===i.wave)?.label)}{i.order_managed ? uiText("procurementManagement.has.linked.orders") : ''}</Checkbox>)}
          {!items.some(i=>i.status!=='na' && matches(i)) && <p>{uiText("procurementManagement.no.matching.requirements.try.another.search")}</p>}
          <Button disabled={!changed.length || busy || !!excluded.length || !!reason} loading={busy} onClick={async()=>{setBusy(true);setError('');try{await api.procurementWorklist(projectId,changed.map(i=>({id:i.id,updated_at:i.updated_at,selected:selected.includes(i.id)})));await onSaved();onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{uiText("procurementManagement.save.scope")}</Button>
        </SpaceBetween>
      </ExpandableSection>
      <ExpandableSection headerText={uiText("sentences.adjust.items.not.needed.here.currently.excluded", { value1: (items.filter(i=>i.status==='na').length) })} defaultExpanded>
        <SpaceBetween size="s"><p>{uiText("procurementManagement.mark.only.requirements.without.linked.orders.as.not.needed")}</p>
          {items.filter(i=>!i.order_managed && i.status!=='na' && matches(i)).map(i=><Checkbox key={i.id} checked={excluded.includes(i.id)} disabled={busy || !!changed.length} onChange={({detail})=>setExcluded(detail.checked?[...excluded,i.id]:excluded.filter(id=>id!==i.id))}>{materialName(i)}</Checkbox>)}
          <FormField label={uiText("procurementManagement.reason.not.needed")}><Textarea disabled={busy || !!changed.length} value={reason} onChange={({detail})=>setReason(detail.value)} /></FormField>
          <Button disabled={!excluded.length || !reason.trim() || busy || !!changed.length} loading={busy} onClick={async()=>{setBusy(true);setError('');try{await api.procurementNotNeeded(projectId,{reason,items:excluded.map(id=>({id,updated_at:items.find(i=>i.id===id)!.updated_at}))});await onSaved();onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{uiText("procurementManagement.save.excluded.items")}</Button>
        </SpaceBetween>
      </ExpandableSection>
      {assign && task && <TaskAssignModal projectId={projectId} tasks={[task]} onDismiss={()=>setAssign(false)} onDone={()=>{setAssign(false);void onSaved();}} onConflict={()=>{setAssign(false);void onSaved();}} />}
    </SpaceBetween></div>
  </Modal>;
}
