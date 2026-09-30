import { eventText } from '../i18n/taskDisplay.ts';
import { taskTitle } from '../i18n/templateNames.ts';
import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import TaskWorkbench from './TaskWorkbench';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import DatePicker from '@cloudscape-design/components/date-picker';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, Project, Task } from '../api/client';
import { useActor } from '../lib/actor';
import { useFlash } from '../lib/flash';
import { dateTime } from '../lib/format';
import { useMeta } from '../lib/meta';
import { stageKeyLabel } from '../lib/stageGroups';
import { dueText, statusIndicator } from '../lib/taskGroups';
import PersonAvatar from './PersonAvatar';
import AssigneeButton from './AssigneeButton';
import HelpText from './HelpText';
import { RoleLabel } from './RoleLabel';
import TaskTimeline from './TaskTimeline';
import ExpandableSection from './ui/ExpandableSection';
import KeyValuePairs from './ui/Facts';
import Header from './ui/Header';
import Container from './ui/Surface';

/**
 * 右侧「任务摘要」（KAN-75 块 1，目标图 04–06 右栏的骨架）。只看不做：
 * 负责人、审核人、状态、满足、截止（统筹可改）、最新动态、活动记录。上传、提交、审核都不在这里。
 * 下面挂一条「关键节点状态」小条：当前段的 D/J 确认现状，只读，去确认走原来的清单区。
 */
export default function TaskSummaryPanel({ task, project, canAssign, onAssign, onChanged, onGotoGates, refreshKey }: {
  task: Task | null; project: Project; canAssign: boolean; onAssign: (t: Task) => void; onChanged: (t: Task) => void; onGotoGates: () => void; refreshKey: number;
}) {
  useLanguage();
  const flash = useFlash();
  const meta = useMeta();
  const navigate = useNavigate();
  const { me } = useActor();
  const [editDue, setEditDue] = useState(false);
  const [due, setDue] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setEditDue(false); setDue(task?.due_at ?? ''); }, [task?.id, task?.due_at]);

  const saveDue = async () => {
    if (!task) return;
    setSaving(true);
    try {
      onChanged(await api.assignTask(task.project_id, task.id, { version: task.version, due_at: due || null }));
      flash({ type: 'success', content: uiText("sentences.due.date", { value1: (taskTitle(task)), value2: (due ? dueText(due) : uiText("projectPreplan.not.set")) }) });
      setEditDue(false);
    } catch (e: any) { flash({ type: 'error', content: e.message }); } finally { setSaving(false); }
  };

  const cur = project.stage_progress.find((s) => s.key === project.current_stage?.key);
  const gates = cur?.gates ?? [];

  return (
    <SpaceBetween size="l">
      <Container embedded cardId="task-summary" cardContext={task?.title} header={<Header variant="h2" help={uiText("taskSummaryPanel.select.a.task.on.the.left.to.view.its")}>{uiText("taskSummaryPanel.task.summary")}</Header>}>
        {task?.node_confirmation ? <TaskWorkbench task={task} meId={me?.id ?? null} onChanged={onChanged} onConflict={() => window.location.reload()} /> : task ? (
          <SpaceBetween size="m">
            <h3 className="ui-summary-title">{taskTitle(task)}</h3>
            <div className="ui-muted">{stageKeyLabel(meta?.stage_groups, task.stage_key, task.stage_label)}</div>
            {task.ws && <HelpText inline>{systemText(task.ws)}</HelpText>}
            <KeyValuePairs
              layout="rows" columns={1}
              items={[
                { label: uiText("taskSummaryPanel.status"), value: <div><StatusIndicator type={statusIndicator(task.exec_status)}>{systemText(task.exec_status_label)}</StatusIndicator>{task.exec_status === 'waiting' && <Box variant="small" color="text-body-secondary">{uiText("taskSummaryPanel.waiting.for")} {task.wait_for || '—'}：{task.wait_reason}{task.wait_until ? uiText("sentences.expected", { value1: (dueText(task.wait_until)) }) : ''}</Box>}</div> },
                { label: uiText("projectPreplan.primary.assignee"), value: canAssign ? <AssigneeButton user={task.assignee} label={uiText("sentences.change.assignee", { value1: (taskTitle(task)) })} onClick={() => onAssign(task)} /> : <PersonAvatar user={task.assignee} showRole={false} /> },
                { label: uiText("taskSummaryPanel.reviewer"), value: task.reviewer ? <PersonAvatar user={task.reviewer} showRole={false} /> : <Box color="text-body-secondary">{uiText("taskSummaryPanel.not.specified")}</Box> },
                {
                  label: uiText("projectPreplan.due.date"),
                  value: editDue ? (
                    <SpaceBetween size="xs">
                      <DatePicker value={due} onChange={({ detail }) => setDue(detail.value)} placeholder="YYYY/MM/DD" />
                      <Button variant="primary" loading={saving} onClick={saveDue}>{uiText("fieldWithSource.save")}</Button>
                      <Button variant="link" onClick={() => { setEditDue(false); setDue(task.due_at ?? ''); }}>{uiText("fieldWithSource.cancel")}</Button>
                    </SpaceBetween>
                  ) : (
                    <span className="ui-inline-edit">{task.due_at ? dueText(task.due_at) : <Box variant="span" color="text-body-secondary">{uiText("projectPreplan.not.set")}</Box>}{canAssign && <Button variant="inline-icon" iconName="edit" onClick={() => setEditDue(true)} ariaLabel={uiText("taskSummaryPanel.change.due.date")} />}</span>
                  ),
                },
                { label: uiText("taskSummaryPanel.evidence.assessment"), value: task.satisfied ? <div><StatusIndicator type="success">{uiText("taskSummaryPanel.requirements.met")}</StatusIndicator>{task.satisfied_evidence && <Box variant="small" color="text-body-secondary">{uiText("stepsPanel.evidence")}{systemText(task.satisfied_evidence)}</Box>}</div> : <Box color="text-body-secondary">{uiText("taskSummaryPanel.requirements.not.met")}{task.deliverable ? uiText("sentences.provide", { value1: (task.deliverable.label) }) : ''}</Box> },
                { label: uiText("taskSummaryPanel.latest.activity"), value: task.last_event ? <div><div>{eventText(task.last_event)}</div><Box variant="small" color="text-body-secondary">{task.last_event.actor?.display_name ?? uiText("taskSummaryPanel.system")} · {dateTime(task.last_event.created_at)}</Box></div> : <Box color="text-body-secondary">{uiText("taskSummaryPanel.no.records.yet")}</Box> },
              ]}
            />
            {task.exec_status !== 'done' && task.satisfied && <Box fontSize="body-s" color="text-status-info">{uiText("taskSummaryPanel.evidence.requirements.are.met.the.task.still.awaits.confirmation")}</Box>}
            <div className="ui-actions ui-actions-start">
              {me && (task.assignee?.id === me.id || task.reviewer?.id === me.id) && <Button onClick={() => navigate(`/todo?task=${task.id}`)}>{task.exec_status === 'pending_review' && task.reviewer?.id === me.id ? uiText("taskSummaryPanel.review.in.my.tasks") : uiText("taskSummaryPanel.handle.in.my.tasks")}</Button>}
              <Button variant="link" onClick={() => navigate(`/projects/${task.project_id}/tasks/${task.id}`)}>{uiText("taskSummaryPanel.full.activity.history")}</Button>
            </div>
            <ExpandableSection headerText={uiText("taskSummaryPanel.activity.history")} variant="footer">
              <TaskTimeline projectId={task.project_id} taskId={task.id} refreshKey={refreshKey} limit={6} />
            </ExpandableSection>
          </SpaceBetween>
        ) : (
          <Box color="text-body-secondary">{uiText("taskSummaryPanel.select.a.task")}</Box>
        )}
      </Container>
      <Container embedded cardId="task-gates" header={<Header variant="h2" help={uiText("taskSummaryPanel.confirm.milestones.according.to.their.conditions.and.permissions.from")}>{uiText("taskSummaryPanel.milestone.status")}</Header>}>
        {gates.length ? (
          <SpaceBetween size="xs">
            {gates.map((g) => (
              <div key={g.key} className="ui-row-wrap">
                <Box fontWeight="bold">{systemText(g.title)}</Box>
                {g.done ? <StatusIndicator type="success">{uiText("stepsPanel.passed")}</StatusIndicator> : g.confirmation_mode === 'any' ? <Box color={g.ready ? 'text-status-info' : 'text-body-secondary'}>{g.needs_review ? uiText("taskSummaryPanel.prerequisites.changed.review.required") : g.ready ? uiText("taskSummaryPanel.awaiting.one.authorized.confirmation") : uiText("sentences.missing", { value1: (g.missing?.map(value => systemText(value)).join(' / ')) })}</Box> : (
                  ['D', 'J'].map((c) => <span key={c}><RoleLabel code={c} />{g.confirmed.includes(c) ? <Box variant="span" color="text-status-success">{uiText("stepsPanel.confirmed")}</Box> : <Box variant="span" color="text-body-secondary">{uiText("taskSummaryPanel.awaiting.confirmation")}</Box>}</span>)
                )}
              </div>
            ))}
            <Link onFollow={(e) => { e.preventDefault(); onGotoGates(); }} href="#gates">{uiText("taskSummaryPanel.confirm.view.evidence.checklist")}</Link>
          </SpaceBetween>
        ) : <Box color="text-body-secondary">{uiText("taskSummaryPanel.no.milestones.in.this.stage")}</Box>}
      </Container>
    </SpaceBetween>
  );
}
