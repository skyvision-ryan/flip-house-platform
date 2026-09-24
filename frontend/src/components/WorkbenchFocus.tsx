import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Link from '@cloudscape-design/components/link';
import Icon, { type IconProps } from '@cloudscape-design/components/icon';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, Workbench, WorkbenchProject } from '../api/client';
import { dateTime } from '../lib/format';
import { dueText, statusIndicator } from '../lib/taskGroups';
import css from './CollaborationLayout.module.css';
import HelpText from './HelpText';
import PersonAvatar from './PersonAvatar';
import StagePositionBar from './StagePositionBar';
import Header from './ui/Header';
import Container, { CardFrame } from './ui/Surface';
import Table from './ui/Table';

/**
 * 工作台「项目关注」（KAN-75 块 4，目标图 01）。四个数 + 每套房一行 + 右侧待我处理。
 * 这里只看概况：房名进项目总览，下一动作进我的事项。数据全部来自任务表（/api/me/workbench），不另算一套。
 */
export default function WorkbenchFocus({ refreshKey = 0 }: { refreshKey?: number }) {
  const navigate = useNavigate();
  const [data, setData] = useState<Workbench | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.workbench().then(setData).catch((e) => setErr(e.message)); }, [refreshKey]);
  if (err) return <Alert type="error" header="读不到项目关注">{err}</Alert>;
  const c = data?.counts;
  const actionText = (p: WorkbenchProject) => {
    const n = p.next_action;
    if (!n) return <Box color="text-body-secondary">本段任务都已安排</Box>;
    const label = n.kind === 'review' ? `审核 ${n.title}` : n.kind === 'assign' ? `安排 ${n.title}` : n.title;
    const href = n.kind === 'review' ? `/todo?task=${n.task_id}` : `/projects/${p.project_id}?tab=overview`;
    return <Link href={href} onFollow={(e) => { e.preventDefault(); navigate(href); }}>{label}</Link>;
  };
  return (
    <SpaceBetween size="l">
      <div className="ui-metrics">
        {[
          { label: '关注项目', icon: 'folder', value: c?.projects, help: '尚未走完流程的房屋。' },
          { label: '待我确认', icon: 'check', value: c?.pending_review_mine, help: '已提交、等你审核的任务。' },
          { label: '待分派', icon: 'group', value: c?.unassigned_current, help: '当前阶段尚无负责人的任务。' },
          { label: '等待回复', icon: 'status-pending', value: c?.waiting, help: '正在等待反馈的任务。' },
        ].map((m) => <CardFrame key={m.label} cardId="workbench-metrics" cardContext={m.label}><div className="ui-metric"><div className="ui-metric-label"><span className="ui-metric-icon" aria-hidden="true"><Icon name={m.icon as IconProps.Name} /></span>{m.label}</div><div className="ui-metric-value">{m.value ?? '—'}</div><HelpText inline>{m.help}</HelpText></div></CardFrame>)}
      </div>
      <div className={css.scope}><div className={css.wideSplit}>
        <Table cardId="workbench-projects"
          variant="container"
          loading={!data}
          loadingText="正在看每套房走到哪"
          items={data?.projects ?? []}
          trackBy="project_id"
          onRowClick={({ detail }) => navigate(`/projects/${detail.item.project_id}?tab=overview`)}
          header={<Header variant="h2" counter={data ? `(${data.projects.length})` : undefined} help="阶段条：浅蓝已完成，深蓝当前位置，灰色未到达。点击房名进入项目，点击审核事项前往我的事项。" actions={<Button iconName="folder" onClick={() => navigate('/projects')}>查看全部项目</Button>}>项目关注</Header>}
          empty={<Box textAlign="center" padding="l" color="text-body-secondary">还没有项目。</Box>}
          columnDefinitions={[
            { id: 'p', header: '项目', minWidth: 160, cell: (p) => <div title={p.address} style={{ overflowWrap: 'anywhere' }}><Link href={`/projects/${p.project_id}`} onFollow={(e) => { e.preventDefault(); navigate(`/projects/${p.project_id}?tab=overview`); }}>{p.project_name}</Link></div> },
            { id: 'pos', header: '当前位置', width: 150, cell: (p) => <div onClick={(e) => e.stopPropagation()}><StagePositionBar position={p.group_position} compact /></div> },
            { id: 'next', header: '下一动作', minWidth: 150, cell: (p) => <div onClick={(e) => e.stopPropagation()}><div>{actionText(p)}</div>{p.next_action && <StatusIndicator type={statusIndicator(p.next_action.exec_status)}>{p.next_action.exec_status_label}</StatusIndicator>}</div> },
            { id: 'who', header: '行动者', width: 130, cell: (p) => (p.next_action ? <PersonAvatar user={p.next_action.actor} size="small" showRole={false} /> : '—') },
            { id: 'due', header: '截止', width: 96, cell: (p) => <span style={{ whiteSpace: 'nowrap' }}>{p.next_action?.due_at ? dueText(p.next_action.due_at) : <Box variant="span" color="text-body-secondary">未设定</Box>}</span> },
          ]}
        />
        <SpaceBetween size="l">
          <Container cardId="workbench-pending" header={<Header variant="h2" counter={data ? `(${data.my_pending.length})` : undefined} help="已提交、等你审核；在我的事项里退回或确认。">待我处理</Header>}>
            {data && data.my_pending.length === 0 && <Box color="text-body-secondary">现在没有等你确认的交付。</Box>}
            <SpaceBetween size="s">
              {(data?.my_pending ?? []).map((t) => (
                <div key={t.id} className="ui-list-item">
                  <div><Box fontWeight="bold" variant="span">{t.title}</Box>　<StatusIndicator type="pending">待我审核</StatusIndicator></div>
                  <Box variant="small" color="text-body-secondary">{t.project_name} · {t.assignee?.display_name ?? '待分派'} 已提交 · 截止 {dueText(t.due_at)}</Box>
                  <div><Button variant="normal" onClick={() => navigate(`/todo?task=${t.id}`)}>开始审核</Button></div>
                </div>
              ))}
            </SpaceBetween>
          </Container>
          <Container cardId="workbench-handoffs" header={<Header variant="h2" help="谁把什么交给了谁。">最近交接</Header>}>
            {data && data.recent_handoffs.length === 0 && <Box color="text-body-secondary">还没有提交、退回或改派。</Box>}
            <SpaceBetween size="xs">
              {(data?.recent_handoffs ?? []).map((e) => (
                <div key={e.id} className="ui-list-item">
                  <div><Box variant="span" fontWeight="bold">{e.actor?.display_name ?? '系统'}</Box> {e.text}</div>
                  <Box variant="small" color="text-body-secondary">{e.project_name} · {e.task_title} · {dateTime(e.created_at)}</Box>
                </div>
              ))}
            </SpaceBetween>
          </Container>
        </SpaceBetween>
      </div></div>
    </SpaceBetween>
  );
}
