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
      flash({ type: 'success', content: `「${task.title}」截止日期：${due ? dueText(due) : '未设定'}` });
      setEditDue(false);
    } catch (e: any) { flash({ type: 'error', content: e.message }); } finally { setSaving(false); }
  };

  const cur = project.stage_progress.find((s) => s.key === project.current_stage?.key);
  const gates = cur?.gates ?? [];

  return (
    <SpaceBetween size="l">
      <Container embedded cardId="task-summary" cardContext={task?.title} header={<Header variant="h2" help="点击左侧任务，查看安排与处理入口。">任务摘要</Header>}>
        {task ? (
          <SpaceBetween size="m">
            <h3 className="ui-summary-title">{task.title}</h3>
            <div className="ui-muted">{stageKeyLabel(meta?.stage_groups, task.stage_key, task.stage_label)}</div>
            {task.ws && <HelpText inline>{task.ws}</HelpText>}
            <KeyValuePairs
              layout="rows" columns={1}
              items={[
                { label: '状态', value: <div><StatusIndicator type={statusIndicator(task.exec_status)}>{task.exec_status_label}</StatusIndicator>{task.exec_status === 'waiting' && <Box variant="small" color="text-body-secondary">等 {task.wait_for || '—'}：{task.wait_reason}{task.wait_until ? `（预计 ${dueText(task.wait_until)}）` : ''}</Box>}</div> },
                { label: '主要负责人', value: canAssign ? <AssigneeButton user={task.assignee} label={`调整负责人：${task.title}`} onClick={() => onAssign(task)} /> : <PersonAvatar user={task.assignee} showRole={false} /> },
                { label: '审核人', value: task.reviewer ? <PersonAvatar user={task.reviewer} showRole={false} /> : <Box color="text-body-secondary">未指定</Box> },
                {
                  label: '截止日期',
                  value: editDue ? (
                    <SpaceBetween size="xs">
                      <DatePicker value={due} onChange={({ detail }) => setDue(detail.value)} placeholder="YYYY/MM/DD" />
                      <Button variant="primary" loading={saving} onClick={saveDue}>保存</Button>
                      <Button variant="link" onClick={() => { setEditDue(false); setDue(task.due_at ?? ''); }}>取消</Button>
                    </SpaceBetween>
                  ) : (
                    <span className="ui-inline-edit">{task.due_at ? dueText(task.due_at) : <Box variant="span" color="text-body-secondary">未设定</Box>}{canAssign && <Button variant="inline-icon" iconName="edit" onClick={() => setEditDue(true)} ariaLabel="改截止日期" />}</span>
                  ),
                },
                { label: '证据判定', value: task.satisfied ? <div><StatusIndicator type="success">已满足</StatusIndicator>{task.satisfied_evidence && <Box variant="small" color="text-body-secondary">依据：{task.satisfied_evidence}</Box>}</div> : <Box color="text-body-secondary">未满足{task.deliverable ? `：要交 ${task.deliverable.label}` : ''}</Box> },
                { label: '最新动态', value: task.last_event ? <div><div>{task.last_event.text}</div><Box variant="small" color="text-body-secondary">{task.last_event.actor?.display_name ?? '系统'} · {dateTime(task.last_event.created_at)}</Box></div> : <Box color="text-body-secondary">还没有记录</Box> },
              ]}
            />
            {task.exec_status !== 'done' && task.satisfied && <Box fontSize="body-s" color="text-status-info">证据已满足，任务仍待确认。</Box>}
            <div className="ui-actions ui-actions-start">
              {me && (task.assignee?.id === me.id || task.reviewer?.id === me.id) && <Button onClick={() => navigate(`/todo?task=${task.id}`)}>{task.exec_status === 'pending_review' && task.reviewer?.id === me.id ? '去我的事项审核' : '去我的事项处理'}</Button>}
              <Button variant="link" onClick={() => navigate(`/projects/${task.project_id}/tasks/${task.id}`)}>完整活动记录</Button>
            </div>
            <ExpandableSection headerText="活动记录" variant="footer">
              <TaskTimeline projectId={task.project_id} taskId={task.id} refreshKey={refreshKey} limit={6} />
            </ExpandableSection>
          </SpaceBetween>
        ) : (
          <Box color="text-body-secondary">请选择一项任务。</Box>
        )}
      </Container>
      <Container embedded cardId="task-gates" header={<Header variant="h2" help="关键节点按 D / J 规则确认，可在下方证据清单中处理。">关键节点状态</Header>}>
        {gates.length ? (
          <SpaceBetween size="xs">
            {gates.map((g) => (
              <div key={g.key} className="ui-row-wrap">
                <Box fontWeight="bold">{g.title}</Box>
                {g.done ? <StatusIndicator type="success">已过</StatusIndicator> : (
                  ['D', 'J'].map((c) => <span key={c}><RoleLabel code={c} />{g.confirmed.includes(c) ? <Box variant="span" color="text-status-success">已确认</Box> : <Box variant="span" color="text-body-secondary">待确认</Box>}</span>)
                )}
              </div>
            ))}
            <Link onFollow={(e) => { e.preventDefault(); onGotoGates(); }} href="#gates">去确认 / 看证据清单</Link>
          </SpaceBetween>
        ) : <Box color="text-body-secondary">本段没有关键节点。</Box>}
      </Container>
    </SpaceBetween>
  );
}
