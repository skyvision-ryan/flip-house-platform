import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Grid from '@cloudscape-design/components/grid';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table from '@cloudscape-design/components/table';
import Tabs from '@cloudscape-design/components/tabs';
import { api, MyTasks, Task } from '../api/client';
import ReviewTag from '../components/ReviewTag';
import TaskWorkbench from '../components/TaskWorkbench';
import { useActor } from '../lib/actor';
import { useMeta } from '../lib/meta';
import { stageKeyLabel } from '../lib/stageGroups';
import { GROUP_LABEL, MyGroupKey, dueText, groupMyTasks, statusIndicator } from '../lib/taskGroups';

/**
 * 我的事项（KAN-75 块 5，目标图 14 / 15 / 16）。三个页签：我的任务 / 待我审核 / 需求待确认。
 * 左边是按「现在可做 / 等待中 / 提前准备 / 已完成」分组的列表，右边是同一条任务的处理组件（详情 / 交付 / 活动记录）。
 * 数据只按登录账号取（/api/me/tasks），不按角色；按角色匹配的旧待办只留在工作台小组件里。
 */
export default function MyTodo() {
  const navigate = useNavigate();
  const meta = useMeta();
  const { me } = useActor();
  const [params, setParams] = useSearchParams();
  const wanted = Number(params.get('task')) || null;
  const [data, setData] = useState<MyTasks | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(wanted);
  const [tab, setTab] = useState('mine');

  const load = useCallback(async () => {
    if (!me) { setData(null); return; }
    try { setData(await api.myTasks()); setErr(null); } catch (e: any) { setErr(e.message); }
  }, [me]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data || !wanted) return;
    if (data.reviewing.some((t) => t.id === wanted) && !data.assigned.some((t) => t.id === wanted)) setTab('review');
  }, [data, wanted]);

  const all = [...(data?.assigned ?? []), ...(data?.reviewing ?? [])];
  const selected = all.find((t) => t.id === selectedId) ?? null;
  const groups = groupMyTasks(data?.assigned ?? []);
  const pick = (t: Task) => { setSelectedId(t.id); setParams((prev) => { const n = new URLSearchParams(prev); n.set('task', String(t.id)); return n; }, { replace: true }); };
  const replace = (t: Task) => setData((prev) => (prev ? { assigned: prev.assigned.map((x) => (x.id === t.id ? t : x)), reviewing: prev.reviewing.map((x) => (x.id === t.id ? t : x)) } : prev));

  const list = (rows: Task[], title: string, hint?: string) => (
    <Table
      variant="embedded"
      items={rows}
      trackBy="id"
      selectionType="single"
      selectedItems={selected ? rows.filter((t) => t.id === selected.id) : []}
      onSelectionChange={({ detail }) => { const t = detail.selectedItems[0]; if (t) pick(t); }}
      onRowClick={({ detail }) => pick(detail.item)}
      ariaLabels={{ selectionGroupLabel: title, itemSelectionLabel: (_, t) => t.title }}
      header={<Header variant="h3" counter={`(${rows.length})`} description={hint}>{title}</Header>}
      empty={<Box padding="s" color="text-body-secondary">没有。</Box>}
      columnDefinitions={[
        { id: 't', header: '任务', cell: (t) => <div><div style={{ fontWeight: t.id === selectedId ? 700 : 400 }}>{t.title}</div><Box variant="small" color="text-body-secondary">{t.project_name} · {stageKeyLabel(meta?.stage_groups, t.stage_key, t.stage_short)}</Box></div> },
        { id: 's', header: '状态', width: 120, cell: (t) => <StatusIndicator type={statusIndicator(t.exec_status)}>{t.exec_status_label}</StatusIndicator> },
        { id: 'd', header: '截止', width: 84, cell: (t) => (t.due_at ? dueText(t.due_at) : <Box color="text-body-secondary">未设定</Box>) },
      ]}
    />
  );
  const pane = (subset: Task[]) => (selected && subset.some((t) => t.id === selected.id)
    ? <Container header={<Header variant="h2" description={`${selected.project_name} · ${selected.project_address}`}>{selected.title}</Header>}><TaskWorkbench task={selected} meId={me?.id ?? null} onChanged={replace} onConflict={load} /></Container>
    : <Container><Box color="text-body-secondary">左边点一项，在这里处理。</Box></Container>);
  const layout = (left: JSX.Element, subset: Task[]) => <Grid gridDefinition={[{ colspan: { default: 12, m: 5, l: 4 } }, { colspan: { default: 12, m: 7, l: 8 } }]}>{left}{pane(subset)}</Grid>;

  return (
    <ContentLayout header={<Header variant="h1" description={me ? '分派给你账号的任务、等你审核的交付，都在这里处理。' : '登录后才能看到分派给你的任务。'}><ReviewTag id="A" />我的事项</Header>}>
      <SpaceBetween size="l">
        {!me && <Alert type="info" action={<Button onClick={() => navigate('/login')}>登录</Button>}>任务按账号分派。现在没有登录，这里没有内容；演示访客可以到工作台看「按角色」的参考待办小组件。</Alert>}
        {err && <Alert type="error">{err}</Alert>}
        {me && !data && !err && <Box textAlign="center" padding="l"><Spinner /></Box>}
        {me && data && (
          <Tabs
            activeTabId={tab}
            onChange={({ detail }) => setTab(detail.activeTabId)}
            tabs={[
              {
                id: 'mine', label: `我的任务 (${data.assigned.length})`,
                content: layout(
                  <Container disableContentPaddings>
                    <SpaceBetween size="xs">
                      {(['now', 'waiting', 'later'] as MyGroupKey[]).map((k) => list(groups[k], GROUP_LABEL[k], k === 'later' ? '项目还没走到这一段，先看要求' : undefined))}
                      {groups.done.length > 0 && list(groups.done, GROUP_LABEL.done)}
                    </SpaceBetween>
                  </Container>,
                  data.assigned,
                ),
              },
              {
                id: 'review', label: `待我审核 (${data.reviewing.filter((t) => t.exec_status === 'pending_review').length})`,
                content: layout(
                  <Container disableContentPaddings>
                    <SpaceBetween size="xs">
                      {list(data.reviewing.filter((t) => t.exec_status === 'pending_review'), '等我确认', '负责人已提交，退回或确认')}
                      {list(data.reviewing.filter((t) => t.exec_status !== 'pending_review'), '我审核的其他任务')}
                    </SpaceBetween>
                  </Container>,
                  data.reviewing,
                ),
              },
              {
                id: 'change', label: '需求待确认 (0)',
                content: <Container><Box color="text-body-secondary">临时新增和追加需求的确认在块 7 接上。</Box></Container>,
              },
            ]}
          />
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
