import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import Grid from '@cloudscape-design/components/grid';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Tabs from '@cloudscape-design/components/tabs';
import { api, MyTasks, Task, TodoRow } from '../api/client';
import MyTodoTable from '../components/MyTodoTable';
import PersonAvatar from '../components/PersonAvatar';
import ReviewTag from '../components/ReviewTag';
import TaskTimeline from '../components/TaskTimeline';
import TaskWaitModal from '../components/TaskWaitModal';
import { useActor } from '../lib/actor';
import { dateTime } from '../lib/format';
import { useFlash } from '../lib/flash';
import { useRole } from '../lib/role';
import { useMeta } from '../lib/meta';
import { stageKeyLabel } from '../lib/stageGroups';
import { GROUP_LABEL, MyGroupKey, dueText, groupMyTasks, statusActions, statusIndicator } from '../lib/taskGroups';

/**
 * 我的事项（KAN-75 块 1，目标图 15 的骨架）：左列表按「现在可做 / 等待中 / 提前准备 / 已完成」分组，
 * 右侧是选中任务的详情、开始 / 记录等待 / 恢复、活动记录。
 * 数据只按**登录账号**取（/api/me/tasks），不按角色。原来按角色匹配的旧待办收进底部折叠区做参考。
 * 「待我审核」页签是块 5 的位置，先只列出我是审核人的任务、不能操作。
 */
export default function MyTodo() {
  const navigate = useNavigate();
  const flash = useFlash();
  const role = useRole();
  const meta = useMeta();
  const { me } = useActor();
  const [data, setData] = useState<MyTasks | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState('mine');
  const [waiting, setWaiting] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [legacy, setLegacy] = useState<TodoRow[] | null>(null);

  const load = useCallback(async () => {
    if (!me) { setData(null); return; }
    try { setData(await api.myTasks()); setErr(null); } catch (e: any) { setErr(e.message); }
  }, [me]);
  useEffect(() => { load(); }, [load]);
  const loadLegacy = useCallback(async () => { setLegacy((await api.dashboardRole()).my_todo ?? []); }, []);

  const all = [...(data?.assigned ?? []), ...(data?.reviewing ?? [])];
  const selected = all.find((t) => t.id === selectedId) ?? null;
  const groups = groupMyTasks(data?.assigned ?? []);
  const replace = (t: Task) => {
    setData((prev) => (prev ? { assigned: prev.assigned.map((x) => (x.id === t.id ? t : x)), reviewing: prev.reviewing.map((x) => (x.id === t.id ? t : x)) } : prev));
    setRefreshKey((k) => k + 1);
  };
  const act = async (t: Task, action: 'start' | 'resume') => {
    setBusy(true);
    try {
      replace(await api.taskStatus(t.project_id, t.id, { version: t.version, action }));
      flash({ type: 'success', content: action === 'start' ? `已开始「${t.title}」` : `已恢复「${t.title}」` });
    } catch (e: any) {
      const msg = String(e.message ?? e);
      flash({ type: msg.startsWith('409') ? 'warning' : 'error', content: msg });
      if (msg.startsWith('409')) load();
    } finally { setBusy(false); }
  };

  const groupBlock = (key: MyGroupKey, rows: Task[]) => (
    <Container key={key} header={<Header variant="h3" counter={`(${rows.length})`}>{GROUP_LABEL[key]}</Header>}>
      {rows.length ? (
        <SpaceBetween size="xs">
          {rows.map((t) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedId(t.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(t.id); } }}
              style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', outline: t.id === selectedId ? '2px solid var(--awsui-color-border-item-focused, currentColor)' : 'none' }}
            >
              <div style={{ minWidth: 0 }}>
                <Box fontWeight="bold">{t.title}</Box>
                <Box variant="small" color="text-body-secondary">{t.project_name} · {stageKeyLabel(meta?.stage_groups, t.stage_key, t.stage_short)}{key === 'later' ? ' · 项目还没走到这一段' : ''}</Box>
              </div>
              <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <div><StatusIndicator type={statusIndicator(t.exec_status)}>{t.exec_status_label}</StatusIndicator></div>
                <Box variant="small" color="text-body-secondary">截止 {dueText(t.due_at)}</Box>
              </div>
            </div>
          ))}
        </SpaceBetween>
      ) : <Box color="text-body-secondary" fontSize="body-s">没有。</Box>}
    </Container>
  );

  const detail = selected && (
    <Container header={<Header variant="h2" description={`${selected.project_name} · ${selected.project_address}`}>{selected.title}</Header>}>
      <SpaceBetween size="m">
        <KeyValuePairs
          columns={2}
          items={[
            { label: '状态', value: <div><StatusIndicator type={statusIndicator(selected.exec_status)}>{selected.exec_status_label}</StatusIndicator>{selected.exec_status === 'waiting' && <Box variant="small" color="text-body-secondary">等 {selected.wait_for || '—'}：{selected.wait_reason}{selected.wait_until ? `（预计 ${dueText(selected.wait_until)}）` : ''}</Box>}</div> },
            { label: '截止日期', value: selected.due_at ? dueText(selected.due_at) : <Box color="text-body-secondary">未设定</Box> },
            { label: '负责人', value: <PersonAvatar user={selected.assignee} /> },
            { label: '审核人', value: selected.reviewer ? <PersonAvatar user={selected.reviewer} /> : '—' },
            { label: '所属位置', value: `${stageKeyLabel(meta?.stage_groups, selected.stage_key, selected.stage_label)}${selected.stage_index > selected.project_current_stage_index ? '（项目还没走到这里，可提前准备）' : ''}` },
            { label: '证据判定', value: selected.satisfied ? <StatusIndicator type="success">已满足</StatusIndicator> : <Box color="text-body-secondary">未满足</Box> },
          ]}
        />
        {selected.purpose && <div><Box fontWeight="bold">这件事是</Box><Box>{selected.purpose}</Box></div>}
        {selected.deliverable && <div><Box fontWeight="bold">要交</Box><Box>{selected.deliverable.label}</Box></div>}
        {selected.done_when && <div><Box fontWeight="bold">怎么算满足</Box><Box>{selected.done_when}</Box></div>}
        <SpaceBetween direction="horizontal" size="xs">
          {statusActions(selected, me?.id ?? null).map((a) => (
            a === 'start' ? <Button key={a} variant="primary" loading={busy} onClick={() => act(selected, 'start')}>开始处理</Button>
              : a === 'resume' ? <Button key={a} variant="primary" loading={busy} onClick={() => act(selected, 'resume')}>恢复处理</Button>
                : <Button key={a} onClick={() => setWaiting(selected)}>记录等待</Button>
          ))}
          <Button onClick={() => navigate(`/projects/${selected.project_id}?tab=overview&step=${selected.step_key ?? ''}`)}>去项目总览交东西</Button>
        </SpaceBetween>
        {selected.assignee?.id !== me?.id && <Box fontSize="body-s" color="text-body-secondary">这项由 {selected.assignee?.display_name ?? '待分派'} 负责，你是审核人；确认、退回在块 5 接上。</Box>}
        <Box fontSize="body-s" color="text-body-secondary">上传文件、填数据仍在项目总览的证据清单里做；提交审核与确认完成在后续块接上。这里没有「完成」按钮——完成由审核人确认。</Box>
        <ExpandableSection headerText="活动记录" variant="footer" defaultExpanded>
          <TaskTimeline projectId={selected.project_id} taskId={selected.id} refreshKey={refreshKey} />
        </ExpandableSection>
        {selected.last_event && <Box variant="small" color="text-body-secondary">最近：{selected.last_event.text} · {dateTime(selected.last_event.created_at)}</Box>}
      </SpaceBetween>
    </Container>
  );

  return (
    <ContentLayout header={<Header variant="h1" description={me ? `${me.display_name} · 分派给你账号的任务，按现在能不能做分组。` : '登录后才能看到分派给你的任务。'}><ReviewTag id="A" />我的事项</Header>}>
      <SpaceBetween size="l">
        {!me && <Alert type="info" action={<Button onClick={() => navigate('/login')}>登录</Button>}>任务是按账号分派的。现在没有登录，只能看下面按角色匹配的旧参考清单。</Alert>}
        {err && <Alert type="error">{err}</Alert>}
        {me && !data && !err && <Box textAlign="center" padding="l"><Spinner /></Box>}
        {me && data && (
          <Tabs
            activeTabId={tab}
            onChange={({ detail }) => setTab(detail.activeTabId)}
            tabs={[
              {
                id: 'mine', label: `我的任务 (${data.assigned.length})`,
                content: (
                  <Grid gridDefinition={[{ colspan: { default: 12, m: 5 } }, { colspan: { default: 12, m: 7 } }]}>
                    <SpaceBetween size="m">
                      {groupBlock('now', groups.now)}
                      {groupBlock('waiting', groups.waiting)}
                      {groupBlock('later', groups.later)}
                      {groups.done.length > 0 && groupBlock('done', groups.done)}
                      {!data.assigned.length && <Box color="text-body-secondary">还没有分派给你的任务。统筹在项目总览里把任务分给你之后，这里就会出现。</Box>}
                    </SpaceBetween>
                    {detail && selected && data.assigned.some((t) => t.id === selected.id) ? detail : <Container><Box color="text-body-secondary">左边点一项看详情。</Box></Container>}
                  </Grid>
                ),
              },
              {
                id: 'review', label: `待我审核 (${data.reviewing.length})`,
                content: (
                  <Grid gridDefinition={[{ colspan: { default: 12, m: 5 } }, { colspan: { default: 12, m: 7 } }]}>
                    <Container header={<Header variant="h3" description="你是审核人的任务。提交、退回、确认在块 5 接上；现在只能看。">待我审核</Header>}>
                      {data.reviewing.length ? (
                        <SpaceBetween size="xs">
                          {data.reviewing.map((t) => (
                            <div key={t.id}><Link href="#" onFollow={(e) => { e.preventDefault(); setSelectedId(t.id); }}>{t.title}</Link><Box variant="small" color="text-body-secondary">{t.project_name} · {t.assignee?.display_name ?? '待分派'} · {t.exec_status_label}</Box></div>
                          ))}
                        </SpaceBetween>
                      ) : <Box color="text-body-secondary">没有。</Box>}
                    </Container>
                    {detail && selected && data.reviewing.some((t) => t.id === selected.id) ? detail : <Container><Box color="text-body-secondary">左边点一项看详情。</Box></Container>}
                  </Grid>
                ),
              },
            ]}
          />
        )}
        <ExpandableSection variant="container" headerText="按角色匹配的参考待办（旧口径）" headerDescription={`按你的角色 ${role.actor} 匹配模板负责角色，不是按账号分派；只作参考，以后会去掉。`} onChange={({ detail }) => { if (detail.expanded && legacy === null) loadLegacy().catch(() => setLegacy([])); }}>
          <MyTodoTable rows={legacy} onReload={loadLegacy} compact />
        </ExpandableSection>
      </SpaceBetween>
      {waiting && <TaskWaitModal task={waiting} onDone={(t) => { setWaiting(null); replace(t); flash({ type: 'success', content: `已记录等待：${t.title}` }); }} onConflict={() => { setWaiting(null); load(); }} onDismiss={() => setWaiting(null)} />}
    </ContentLayout>
  );
}
