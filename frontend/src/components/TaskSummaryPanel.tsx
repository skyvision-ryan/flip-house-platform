import { useEffect, useState } from 'react';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import DatePicker from '@cloudscape-design/components/date-picker';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useNavigate } from 'react-router-dom';
import { api, Project, Task } from '../api/client';
import { useActor } from '../lib/actor';
import { dateTime } from '../lib/format';
import { useFlash } from '../lib/flash';
import { useMeta } from '../lib/meta';
import { stageKeyLabel } from '../lib/stageGroups';
import { dueText, statusIndicator } from '../lib/taskGroups';
import { OwnerDot } from './OwnerTag';
import PersonAvatar from './PersonAvatar';
import TaskTimeline from './TaskTimeline';

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
      <Container header={<Header variant="h2" description={task ? undefined : '在左侧任务表点一行。'}>任务摘要</Header>}>
        {task ? (
          <SpaceBetween size="m">
            <KeyValuePairs
              columns={2}
              items={[
                { label: '任务', value: <div><Box fontWeight="bold">{task.title}</Box><Box variant="small" color="text-body-secondary">{stageKeyLabel(meta?.stage_groups, task.stage_key, task.stage_label)}{task.ws ? ` · ${task.ws}` : ''}</Box></div> },
                { label: '状态', value: <div><StatusIndicator type={statusIndicator(task.exec_status)}>{task.exec_status_label}</StatusIndicator>{task.exec_status === 'waiting' && <Box variant="small" color="text-body-secondary">等 {task.wait_for || '—'}：{task.wait_reason}{task.wait_until ? `（预计 ${dueText(task.wait_until)}）` : ''}</Box>}</div> },
                { label: '主要负责人', value: <PersonAvatar user={task.assignee} /> },
                { label: '审核人', value: task.reviewer ? <PersonAvatar user={task.reviewer} /> : <Box color="text-body-secondary">分派时默认为分派的人</Box> },
                {
                  label: '截止日期',
                  value: editDue ? (
                    <SpaceBetween size="xs">
                      <DatePicker value={due} onChange={({ detail }) => setDue(detail.value)} placeholder="YYYY/MM/DD" />
                      <Button variant="primary" loading={saving} onClick={saveDue}>保存</Button>
                      <Button variant="link" onClick={() => { setEditDue(false); setDue(task.due_at ?? ''); }}>取消</Button>
                    </SpaceBetween>
                  ) : (
                    <span>{task.due_at ? dueText(task.due_at) : <Box variant="span" color="text-body-secondary">未设定</Box>}{canAssign && <Button variant="inline-link" iconName="edit" onClick={() => setEditDue(true)} ariaLabel="改截止日期">改</Button>}</span>
                  ),
                },
                { label: '证据判定', value: task.satisfied ? <div><StatusIndicator type="success">已满足</StatusIndicator>{task.satisfied_evidence && <Box variant="small" color="text-body-secondary">依据：{task.satisfied_evidence}</Box>}</div> : <Box color="text-body-secondary">未满足{task.deliverable ? `：要交 ${task.deliverable.label}` : ''}</Box> },
                { label: '最新动态', value: task.last_event ? <div><div>{task.last_event.text}</div><Box variant="small" color="text-body-secondary">{task.last_event.actor?.display_name ?? '系统'} · {dateTime(task.last_event.created_at)}</Box></div> : <Box color="text-body-secondary">还没有记录</Box> },
              ]}
            />
            {task.exec_status !== 'done' && task.satisfied && <Box fontSize="body-s" color="text-status-info">证据已满足但任务还没确认完成——确认在「我的事项」里做。</Box>}
            <SpaceBetween direction="horizontal" size="xs">
              {canAssign && <Button onClick={() => onAssign(task)} iconName={task.assignee ? 'edit' : 'add-plus'}>{task.assignee ? '改派 / 调整安排' : '分派'}</Button>}
              {me && (task.assignee?.id === me.id || task.reviewer?.id === me.id) && <Button onClick={() => navigate(`/todo?task=${task.id}`)}>{task.exec_status === 'pending_review' && task.reviewer?.id === me.id ? '去我的事项审核' : '去我的事项处理'}</Button>}
              <Button variant="link" onClick={() => navigate(`/projects/${task.project_id}/tasks/${task.id}`)}>完整活动记录</Button>
            </SpaceBetween>
            <ExpandableSection headerText="活动记录" variant="footer">
              <TaskTimeline projectId={task.project_id} taskId={task.id} refreshKey={refreshKey} limit={6} />
            </ExpandableSection>
          </SpaceBetween>
        ) : (
          <Box color="text-body-secondary">这里显示选中任务的负责人、状态、截止日期和最新动态。</Box>
        )}
      </Container>
      <Container header={<Header variant="h2" description="D、J 各确认一次才过门；这里只看现状，确认在下方清单区。">关键节点状态</Header>}>
        {gates.length ? (
          <SpaceBetween size="xs">
            {gates.map((g) => (
              <div key={g.key} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <Box fontWeight="bold">{g.title}</Box>
                {g.done ? <StatusIndicator type="success">已过</StatusIndicator> : (
                  ['D', 'J'].map((c) => <span key={c}><OwnerDot code={c} />{g.confirmed.includes(c) ? <Box variant="span" color="text-status-success">已确认</Box> : <Box variant="span" color="text-body-secondary">待确认</Box>}</span>)
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
