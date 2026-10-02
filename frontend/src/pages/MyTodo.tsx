import TaskProjectRoadmap from '../components/TaskProjectRoadmap';
import TaskSignals from '../components/TaskSignals';
import { taskTitle } from '../i18n/templateNames.ts';
import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, MyTasks, Task } from '../api/client';
import css from '../components/ui/CollaborationLayout.module.css';
import CollaborationWorkspace from '../components/ui/CollaborationWorkspace';
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
  useLanguage();
  const navigate = useNavigate();
  const meta = useMeta();
  const { me } = useActor();
  const [params, setParams] = useSearchParams();
  const wanted = Number(params.get('task')) || null;
  const [data, setData] = useState<MyTasks | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(wanted);
  const tab = params.get('view') === 'review' ? 'review' : params.get('view') === 'assist' ? 'assist' : 'mine';
  const setTab = (value: string) => setParams(prev => { const n = new URLSearchParams(prev); n.set('view', value); return n; }, { replace: true });
  const query = params.get('q') ?? '';
  const setQuery = (value: string) => setParams(prev => { const n = new URLSearchParams(prev); value ? n.set('q', value) : n.delete('q'); return n; }, { replace: true });
  const projectFilter = params.get('project') ?? 'all';
  const setProjectFilter = (value: string) => setParams(prev => { const n = new URLSearchParams(prev); value === 'all' ? n.delete('project') : n.set('project', value); return n; }, { replace: true });

  const requestSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    if (!me) { setData(null); return; }
    try {
      const result = await api.myTasks();
      if (sequence === requestSequence.current) { setData(result); setErr(null); }
    } catch (e: any) { if (sequence === requestSequence.current) setErr(e.message); }
  }, [me]);
  useEffect(() => { void load(); return () => { requestSequence.current++; }; }, [load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 20000);
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer); };
  }, [load]);
  useEffect(() => { setSelectedId(wanted); }, [wanted]);
  useEffect(() => {
    if (!data || !wanted || params.has('view')) return;
    if (data.assisting?.some(t => t.id === wanted)) { setTab('assist'); return; }
    if (data.reviewing.some((t) => t.id === wanted) && (!data.assigned.some((t) => t.id === wanted) || data.reviewing.some((t) => t.id === wanted && t.exec_status === 'pending_review'))) setTab('review');
  }, [data, wanted]);

  const all = [...new Map([...(data?.assigned ?? []), ...(data?.assisting ?? []), ...(data?.reviewing ?? [])].map(t => [t.id, t])).values()];
  const selected = all.find((t) => t.id === selectedId) ?? null;
  const groups = groupMyTasks(data?.assigned ?? []);
  const pick = (t: Task) => { setSelectedId(t.id); setParams((prev) => { const n = new URLSearchParams(prev); n.set('task', String(t.id)); return n; }, { replace: true }); };
  const replace = (t: Task) => {
    setData((prev) => (prev ? { ...prev, assisting: prev.assisting?.map(x => x.id === t.id ? t : x), assigned: prev.assigned.map((x) => (x.id === t.id ? t : x)), reviewing: prev.reviewing.map((x) => (x.id === t.id ? t : x)) } : prev));
    void load();
  };

  const projectOptions = [{ value: 'all', label: uiText("founderDesign.all.projects") }, ...Array.from(new Map(all.map((t) => [t.project_id, { value: String(t.project_id), label: t.project_name }])).values())];
  const filtered = (rows: Task[]) => rows.filter((t) => (projectFilter === 'all' || String(t.project_id) === projectFilter) && (!query || `${t.title} ${t.project_name}`.toLowerCase().includes(query.toLowerCase())));
  const list = (rows: Task[], title: string, hint?: string) => {
    const visible = filtered(rows);
    return <section aria-label={title}>
      <Box padding={{ horizontal: 'm', top: 'm', bottom: 's' }}><Header variant="h3" counter={`(${visible.length})`} help={hint}>{title}</Header></Box>
      {!visible.length && <Box padding={{ horizontal: 'm', bottom: 'm' }} color="text-body-secondary">{uiText("myTodo.no.tasks")}</Box>}
      {visible.map((t) => <div key={t.id}><ReviewTag cardId="my-task-card" context={`${t.project_name} · ${taskTitle(t)}`} /><button type="button" className={css.taskPick} aria-pressed={t.id === selectedId} onClick={() => pick(t)}>
        <div className={css.pickTitle}>{taskTitle(t)}</div>{t.assistant?.id === me?.id && <Box fontWeight="bold">{uiText('assistant.mine')}</Box>}
        <Box variant="small" color="text-body-secondary">{t.project_name} · {stageKeyLabel(meta?.stage_groups, t.stage_key, t.stage_short)}</Box>
        <div className={css.pickMeta}><StatusIndicator type={statusIndicator(t.exec_status)}>{systemText(t.exec_status_label)}</StatusIndicator><Box variant="small" color="text-body-secondary">{uiText("taskTable.due")} {t.due_at ? dueText(t.due_at) : uiText("projectPreplan.not.set")}</Box></div>
      </button></div>)}
    </section>;
  };
  const pane = (subset: Task[]) => (selected && filtered(subset).some((t) => t.id === selected.id)
    ? <Container embedded cardId="task-processing" cardContext={selected?.title} header={<Header variant="h2" description={`${selected.project_name} · ${selected.project_address}`}>{taskTitle(selected)}</Header>}><TaskWorkbench task={selected} meId={me?.id ?? null} onChanged={replace} onConflict={load} /></Container>
    : <Container embedded cardId="task-processing"><Box color="text-body-secondary">{uiText("myTodo.select.a.task.to.review.its.requirements.and.take")}</Box></Container>);
  const layout = (left: JSX.Element, subset: Task[]) => <CollaborationWorkspace processing backLabel={uiText('collaborationWorkspace.back.to.task.list')} main={left} detail={pane(subset)} detailOpen={!!selected && filtered(subset).some((t) => t.id === selected.id)} onBack={() => {
    setSelectedId(null); setParams((prev) => { const next = new URLSearchParams(prev); next.delete('task'); return next; }, { replace: true });
  }} />;

  return (
    <ContentLayout maxContentWidth={1440} header={<Header variant="h1" help={me ? uiText("myTodo.handle.your.assignments.and.review.submitted.deliverables") : uiText("myTodo.sign.in.to.view.your.tasks")}>{uiText("app.my.tasks")}</Header>}>
      <SpaceBetween size="l">
        {!me && <Alert type="info" action={<Button onClick={() => navigate('/login')}>{uiText("cardRegistry.sign.in")}</Button>}>{uiText("myTodo.tasks.are.assigned.to.accounts.you.are.not.signed")}</Alert>}
        {err && <Alert type="error" action={<Button onClick={load}>{uiText("addProject.retry")}</Button>}>{systemText(err)}</Alert>}
        {wanted && data && !selected && <Alert type="info">{uiText("myTodo.this.task.is.outside.your.assignment.or.review.scope")}</Alert>}
        {me && !data && !err && <Box textAlign="center" padding="l"><Spinner /></Box>}
        {me && data && <div className={css.toolbar}><TextFilter filteringText={query} onChange={({ detail }) => setQuery(detail.filteringText)} filteringPlaceholder={uiText("myTodo.search.project.or.task")} filteringAriaLabel={uiText("myTodo.search.my.tasks")} /><Select selectedOption={projectOptions.find((o) => o.value === projectFilter)!} options={projectOptions} onChange={({ detail }) => setProjectFilter(detail.selectedOption.value!)} ariaLabel={uiText("myTodo.filter.by.project")} /></div>}
        {me && data && <TaskSignals signals={(data.signals ?? []).filter(signal => projectFilter === 'all' || String(signal.project_id) === projectFilter)} />}
        {me && data && (projectFilter !== 'all' || selected) && <TaskProjectRoadmap key={projectFilter !== 'all' ? projectFilter : selected!.project_id} projectId={projectFilter !== 'all' ? Number(projectFilter) : selected!.project_id} refreshKey={`${data.signals?.[0]?.id ?? ''}:${all.map(task => `${task.id}:${task.version}:${task.satisfied}`).join(',')}`} onChanged={load} />}
        {me && data && (
          <Tabs
            activeTabId={tab}
            onChange={({ detail }) => {
              setTab(detail.activeTabId);
              const rows = detail.activeTabId === 'review' ? data.reviewing : detail.activeTabId === 'assist' ? (data.assisting ?? []) : data.assigned;
              const first = rows.find((t) => t.exec_status === 'pending_review') ?? rows[0];
              if (first) pick(first); else { setSelectedId(null); setParams(prev => { const n = new URLSearchParams(prev); n.delete('task'); return n; }, { replace: true }); }
            }}
            tabs={[
              { id: 'assist', label: `${uiText('assistant.mine')} (${data.assisting?.length ?? 0})`, content: layout(<Container embedded cardId="my-task-list" cardContext={uiText('assistant.mine')} disableContentPaddings>{list(data.assisting ?? [], uiText('assistant.mine'), uiText('assistant.permissions'))}</Container>, data.assisting ?? []) },
              {
                id: 'mine', label: uiText("sentences.my.tasks", { value1: (data.assigned.length) }),
                content: layout(
                  <Container embedded cardId="my-task-list" disableContentPaddings>
                    <SpaceBetween size="xs">
                      {(['now', 'waiting', 'later'] as MyGroupKey[]).map((k) => list(groups[k], GROUP_LABEL[k], k === 'later' ? uiText("myTodo.this.stage.has.not.been.reached.review.requirements.ahead") : undefined))}
                      {groups.done.length > 0 && list(groups.done, GROUP_LABEL.done)}
                    </SpaceBetween>
                  </Container>,
                  data.assigned,
                ),
              },
              {
                id: 'review', label: uiText("sentences.awaiting.my.review", { value1: (data.reviewing.filter((t) => t.exec_status === 'pending_review').length) }),
                content: layout(
                  <Container embedded cardId="my-review-list" disableContentPaddings>
                    <SpaceBetween size="xs">
                      {list(data.reviewing.filter((t) => t.exec_status === 'pending_review'), uiText("myTodo.awaiting.my.confirmation"), uiText("myTodo.the.assignee.submitted.return.or.accept"))}
                      {list(data.reviewing.filter((t) => t.exec_status !== 'pending_review'), uiText("myTodo.other.tasks.i.review"))}
                    </SpaceBetween>
                  </Container>,
                  data.reviewing,
                ),
              },
            ]}
          />
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
