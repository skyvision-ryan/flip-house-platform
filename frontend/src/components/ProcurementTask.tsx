import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import { useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { type Task } from '../api/client';
import { useActor } from '../lib/actor';
import { useMeta } from '../lib/meta';
import { userCan } from '../lib/role';
import TaskAssignModal from './TaskAssignModal';

export default function ProcurementTask({ task, onChanged, readOnly = false, detailsOnly = false }: { task?: Task; onChanged: () => Promise<void>; readOnly?: boolean; detailsOnly?: boolean }) {
  useLanguage();
  const { me } = useActor(); const meta = useMeta(); const [assign, setAssign] = useState(false);
  if (!task) return <Alert type="info">{uiText("procurementTask.this.property.has.no.procurement.task.add.it.from")}</Alert>;
  const progress = task.procurement_progress;
  return <section className="ui-proc-task" aria-label={uiText("procurementTask.property.procurement.lead")}><SpaceBetween size="s">
    {!detailsOnly && <><div className="ui-row-between"><strong>{uiText("procurementTask.procurement.lead")} {task.assignee?.display_name || uiText("procurementTask.awaiting.jessie.assignment")}</strong><StatusIndicator type={progress?.complete ? 'success' : task.assignee ? 'in-progress' : 'pending'}>{progress?.complete ? uiText("procurementTask.all.required.items.ready") : task.assignee ? uiText("procurementTask.procurement.in.progress") : uiText("personAvatar.unassigned")}</StatusIndicator></div>
    <Box>{uiText("procurementTask.property.total")} {progress?.ready ?? 0} / {progress?.total ?? 0} {uiText("procurementTask.items.ready")}{task.due_at ? uiText("sentences.due", { value1: (task.due_at) }) : ''}</Box></>}
    <div className="proc-detail-links">{!readOnly && userCan(meta, me, 'assign_tasks') && <Button onClick={() => setAssign(true)}>{task.assignee ? uiText("procurementTask.change.lead.due.date") : uiText("procurementTask.assign.procurement.lead")}</Button>}<Button variant="inline-link" href={`/projects/${task.project_id}/tasks/${task.id}?returnTo=${encodeURIComponent(`/projects/${task.project_id}?tab=procurement`)}`}>{uiText("procurementTask.view.procurement.history")}</Button></div>
    {assign && <TaskAssignModal projectId={task.project_id} tasks={[task]} onDismiss={() => setAssign(false)} onDone={() => { setAssign(false); void onChanged(); }} onConflict={() => { setAssign(false); void onChanged(); }} />}
  </SpaceBetween></section>;
}
