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
import TaskTimeline from './TaskTimeline';
import { ExpandableSection } from './ui/Surface';

export default function ProcurementTask({ task, onChanged, readOnly = false }: { task?: Task; onChanged: () => Promise<void>; readOnly?: boolean }) {
  const { me } = useActor(); const meta = useMeta(); const [assign, setAssign] = useState(false);
  if (!task) return <Alert type="info">本房尚未建立采购任务，请从项目任务区补齐。</Alert>;
  const progress = task.procurement_progress;
  return <section className="ui-proc-task" aria-label="本房采购负责人"><SpaceBetween size="s">
    <div className="ui-row-between"><strong>采购负责人 · {task.assignee?.display_name || '待 Jessie 分派'}</strong><StatusIndicator type={progress?.complete ? 'success' : 'in-progress'}>{progress?.complete ? '已备齐' : task.assignee ? '采购中' : '待分派'}</StatusIndicator></div>
    <Box>全房 {progress?.ready ?? 0} / {progress?.total ?? 0} 项已备齐 · 不需要 {progress?.excluded ?? 0} 项{task.due_at ? ` · 截止 ${task.due_at}` : ''}</Box>
    <ExpandableSection headerText="负责人设置与历史">{!readOnly && userCan(meta, me, 'assign_tasks') && <Button onClick={() => setAssign(true)}>{task.assignee ? '调整负责人 / 截止' : '分派采购负责人'}</Button>}<TaskTimeline key={task.version} projectId={task.project_id} taskId={task.id} refreshKey={task.version} /></ExpandableSection>
    {assign && <TaskAssignModal projectId={task.project_id} tasks={[task]} onDismiss={() => setAssign(false)} onDone={() => { setAssign(false); void onChanged(); }} onConflict={() => { setAssign(false); void onChanged(); }} />}
  </SpaceBetween></section>;
}
