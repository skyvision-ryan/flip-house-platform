import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Tabs from '@cloudscape-design/components/tabs';
import TextFilter from '@cloudscape-design/components/text-filter';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, MyTasks, Task } from '../api/client';
import css from '../components/ui/CollaborationLayout.module.css';
import ReviewTag from '../components/ReviewTag';
import TaskWorkbench from '../components/TaskWorkbench';
import Header from '../components/ui/Header';
import Container from '../components/ui/Surface';
import { useActor } from '../lib/actor';
import { useMeta } from '../lib/meta';
import { stageKeyLabel } from '../lib/stageGroups';
import { dueText, GROUP_LABEL, groupMyTasks, MyGroupKey, statusIndicator } from '../lib/taskGroups';

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
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');

  const load = useCallback(async () => {
    if (!me) { setData(null); return; }
    try { setData(await api.myTasks()); setErr(null); } catch (e: any) { setErr(e.message); }
  }, [me]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (wanted) setSelectedId(wanted); }, [wanted]);
  useEffect(() => {
    if (!data || !wanted) return;
    if (data.reviewing.some((t) => t.id === wanted) && (!data.assigned.some((t) => t.id === wanted) || data.reviewing.some((t) => t.id === wanted && t.exec_status === 'pending_review'))) setTab('review');
  }, [data, wanted]);

  const all = [...(data?.assigned ?? []), ...(data?.reviewing ?? [])];
  const selected = all.find((t) => t.id === selectedId) ?? null;
  const groups = groupMyTasks(data?.assigned ?? []);
  const pick = (t: Task) => { setSelectedId(t.id); setParams((prev) => { const n = new URLSearchParams(prev); n.set('task', String(t.id)); return n; }, { replace: true }); };
  const replace = (t: Task) => setData((prev) => (prev ? { assigned: prev.assigned.map((x) => (x.id === t.id ? t : x)), reviewing: prev.reviewing.map((x) => (x.id === t.id ? t : x)) } : prev));

  const projectOptions = [{ value: 'all', label: '全部项目' }, ...Array.from(new Map(all.map((t) => [t.project_id, { value: String(t.project_id), label: t.project_name }])).values())];
  const filtered = (rows: Task[]) => rows.filter((t) => (projectFilter === 'all' || String(t.project_id) === projectFilter) && (!query || `${t.title} ${t.project_name}`.toLowerCase().includes(query.toLowerCase())));
  const list = (rows: Task[], title: string, hint?: string) => {
    const visible = filtered(rows);
    return <section aria-label={title}>
      <Box padding={{ horizontal: 'm', top: 'm', bottom: 's' }}><Header variant="h3" counter={`(${visible.length})`} help={hint}>{title}</Header></Box>
      {!visible.length && <Box padding={{ horizontal: 'm', bottom: 'm' }} color="text-body-secondary">暂无事项</Box>}
      {visible.map((t) => <div key={t.id}><ReviewTag cardId="my-task-card" context={`${t.project_name} · ${t.title}`} /><button type="button" className={css.taskPick} aria-pressed={t.id === selectedId} onClick={() => pick(t)}>
        <div className={css.pickTitle}>{t.title}</div>
        <Box variant="small" color="text-body-secondary">{t.project_name} · {stageKeyLabel(meta?.stage_groups, t.stage_key, t.stage_short)}</Box>
        <div className={css.pickMeta}><StatusIndicator type={statusIndicator(t.exec_status)}>{t.exec_status_label}</StatusIndicator><Box variant="small" color="text-body-secondary">截止 {t.due_at ? dueText(t.due_at) : '未设定'}</Box></div>
      </button></div>)}
    </section>;
  };
  const pane = (subset: Task[]) => (selected && filtered(subset).some((t) => t.id === selected.id)
    ? <Container cardId="task-processing" cardContext={selected?.title} header={<Header variant="h2" description={`${selected.project_name} · ${selected.project_address}`}>{selected.title}</Header>}><TaskWorkbench task={selected} meId={me?.id ?? null} onChanged={replace} onConflict={load} /></Container>
    : <Container cardId="task-processing"><Box color="text-body-secondary">左边点一项，在这里处理。</Box></Container>);
  const layout = (left: JSX.Element, subset: Task[]) => <div className={css.scope}><div className={css.review}>{left}{pane(subset)}</div></div>;

  return (
    <ContentLayout maxContentWidth={1440} header={<Header variant="h1" help={me ? '处理分派给你的任务，以及等你审核的交付。' : '登录后查看你的任务。'}>我的事项</Header>}>
      <SpaceBetween size="l">
        {!me && <Alert type="info" action={<Button onClick={() => navigate('/login')}>登录</Button>}>任务按账号分派。现在没有登录，这里没有内容；演示访客可以到工作台看「按角色」的参考待办小组件。</Alert>}
        {err && <Alert type="error">{err}</Alert>}
        {me && !data && !err && <Box textAlign="center" padding="l"><Spinner /></Box>}
        {me && data && <div className={css.toolbar}><TextFilter filteringText={query} onChange={({ detail }) => setQuery(detail.filteringText)} filteringPlaceholder="搜索项目或任务" filteringAriaLabel="搜索我的事项" /><Select selectedOption={projectOptions.find((o) => o.value === projectFilter)!} options={projectOptions} onChange={({ detail }) => setProjectFilter(detail.selectedOption.value!)} ariaLabel="筛选项目" /></div>}
        {me && data && (
          <Tabs
            activeTabId={tab}
            onChange={({ detail }) => {
              setTab(detail.activeTabId);
              const rows = detail.activeTabId === 'review' ? data.reviewing : data.assigned;
              const first = rows.find((t) => t.exec_status === 'pending_review') ?? rows[0];
              if (first) pick(first); else setSelectedId(null);
            }}
            tabs={[
              {
                id: 'mine', label: `我的任务 (${data.assigned.length})`,
                content: layout(
                  <Container cardId="my-task-list" disableContentPaddings>
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
                  <Container cardId="my-review-list" disableContentPaddings>
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
                content: <Container cardId="my-changes"><Box color="text-body-secondary">需求确认功能准备中。当前事项可在「我的任务」和「待我审核」中处理。</Box></Container>,
              },
            ]}
          />
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
