import { eventText } from '../i18n/taskDisplay.ts';
import { taskTitle } from '../i18n/templateNames.ts';
import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
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
import { useActor } from '../lib/actor';
import { useRole } from '../lib/role';
import { dateTime } from '../lib/format';
import { moneyValue } from '../lib/purchaseOrders';
import { dueText, statusIndicator } from '../lib/taskGroups';
import CollaborationWorkspace from './ui/CollaborationWorkspace';
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
  useLanguage();
  const navigate = useNavigate();
  const role = useRole();
  const { me } = useActor();
  const [data, setData] = useState<Workbench | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.workbench().then(setData).catch((e) => setErr(e.message)); }, [refreshKey]);
  if (err) return <Alert type="error" header={uiText("workbenchFocus.cannot.load.project.focus")}>{systemText(err)}</Alert>;
  const c = data?.counts;
  const actionText = (p: WorkbenchProject) => {
    const n = p.next_action;
    if (!n) return <Box color="text-body-secondary">{uiText("workbenchFocus.all.current.stage.tasks.assigned")}</Box>;
    const label = n.kind === 'review' ? uiText("sentences.review", { value1: (taskTitle(n)) }) : n.kind === 'assign' ? uiText("sentences.assign.2", { value1: (taskTitle(n)) }) : taskTitle(n);
    const href = n.kind === 'review' && n.actor?.id === me?.id ? `/todo?task=${n.task_id}` : `/projects/${p.project_id}?tab=overview&task=${n.task_id}`;
    return <Link href={href} onFollow={(e) => { e.preventDefault(); navigate(href); }}>{label}</Link>;
  };
  return (
    <SpaceBetween size="l">
      <div className="ui-metrics">
        {[
          { label: uiText("workbenchFocus.active.projects"), icon: 'folder', value: c?.projects, help: uiText("workbenchFocus.properties.whose.process.is.not.yet.complete") },
          { label: uiText("workbenchFocus.awaiting.my.confirmation"), icon: 'check', value: c?.pending_review_mine, help: uiText("workbenchFocus.submitted.tasks.awaiting.your.review") },
          { label: uiText("personAvatar.unassigned"), icon: 'group', value: c?.unassigned_current, help: uiText("workbenchFocus.current.stage.tasks.without.an.assignee") },
          { label: uiText("workbenchFocus.awaiting.response"), icon: 'status-pending', value: c?.waiting, help: uiText("workbenchFocus.tasks.waiting.for.feedback") },
        ].map((m) => <CardFrame key={m.icon} cardId="workbench-metrics" cardContext={systemText(m.label)}><div className="ui-metric"><div className="ui-metric-label"><span className="ui-metric-icon" aria-hidden="true"><Icon name={m.icon as IconProps.Name} /></span>{systemText(m.label)}</div><div className="ui-metric-value">{m.value ?? '—'}</div><HelpText inline>{m.help}</HelpText></div></CardFrame>)}
      </div>
      <CollaborationWorkspace wide main={
        <Table cardId="workbench-projects"
          variant="embedded"
          loading={!data}
          loadingText={uiText("workbenchFocus.checking.each.property.s.progress")}
          items={data?.projects ?? []}
          trackBy="project_id"
          header={<Header variant="h2" description={data?.projects.some(p => p.procurement) ? uiText("workbenchFocus.procurement.amounts.include.recorded.order.payments.less.refunds.excluding") : undefined} counter={data ? `(${data.projects.length})` : undefined} help={uiText("workbenchFocus.stage.bar.light.blue.is.passed.dark.blue.is")} actions={role.canReadMoney ? <Button iconName="folder" onClick={() => navigate('/projects')}>{uiText("workbenchFocus.view.all.projects")}</Button> : undefined}>{uiText("workbenchFocus.project.focus")}</Header>}
          empty={<Box textAlign="center" padding="l" color="text-body-secondary">{uiText("workbenchFocus.no.projects.yet")}</Box>}
          columnDefinitions={[
            { id: 'p', header: uiText("app.projects"), minWidth: 160, cell: (p) => <div title={p.address} className="ui-wrap-anywhere"><Link href={`/projects/${p.project_id}`} onFollow={(e) => { e.preventDefault(); navigate(`/projects/${p.project_id}?tab=overview`); }}>{p.project_name}</Link></div> },
            { id: 'pos', header: uiText("stagePositionBar.current.position"), minWidth: 110, cell: (p) => <div onClick={(e) => e.stopPropagation()}><StagePositionBar position={p.group_position} compact /></div> },
            { id: 'next', header: uiText("workbenchFocus.next.action"), minWidth: 150, cell: (p) => <div onClick={(e) => e.stopPropagation()}><div>{actionText(p)}</div>{p.next_action && <StatusIndicator type={statusIndicator(p.next_action.exec_status)}>{systemText(p.next_action.exec_status_label)}</StatusIndicator>}</div> },
            { id: 'who', header: uiText("workbenchFocus.action.by"), minWidth: 115, cell: (p) => (p.next_action ? <PersonAvatar user={p.next_action.actor} size="small" showRole={false} /> : '—') },
            ...(data?.projects.some(p => p.procurement) ? [{ id: 'procurement', header: uiText("app.procurement"), minWidth: 200, cell: (p: WorkbenchProject) => p.procurement ? <div onClick={e=>e.stopPropagation()}><Button variant="inline-link" onClick={()=>navigate(`/projects/${p.project_id}?tab=procurement`)}>{p.procurement.owner || uiText("personAvatar.unassigned")} · {p.procurement.ready}/{p.procurement.total} {uiText("workbenchFocus.requirements.met")}</Button><Box>{uiText("purchaseOrderCoverage.recorded.net.order.amount")} {p.procurement.order_count ? moneyValue(p.procurement.order_count === p.procurement.missing_totals ? null : p.procurement.spent) : uiText("purchaseOrderCoverage.no.orders")}{p.procurement.missing_totals ? uiText("sentences.orders.lack.payment.amounts.the.total.is.incomplete", { value1: (p.procurement.missing_totals) }) : ''}</Box><Box>{p.procurement.problems.length ? uiText("sentences.items.need.action", { value1: (p.procurement.problems.length), value2: (p.procurement.problems[0].name), value3: (p.procurement.problems[0].note) }) : uiText("workbenchFocus.no.pending.actions")}</Box></div> : '—' }] : []),
            { id: 'due', header: uiText("taskTable.due"), minWidth: 85, cell: (p) => <span className="ui-nowrap">{p.next_action?.due_at ? dueText(p.next_action.due_at) : <Box variant="span" color="text-body-secondary">{uiText("projectPreplan.not.set")}</Box>}</span> },
          ]}
        />
        } detail={<SpaceBetween size="l">
          <Container embedded cardId="workbench-pending" header={<Header variant="h2" counter={data ? `(${data.my_pending.length})` : undefined} help={uiText("workbenchFocus.submitted.for.your.review.return.or.accept.in.my")}>{uiText("workbenchFocus.needs.my.action")}</Header>}>
            {data && data.my_pending.length === 0 && <Box color="text-body-secondary">{uiText("workbenchFocus.no.submissions.await.your.confirmation")}</Box>}
            <SpaceBetween size="s">
              {(data?.my_pending ?? []).map((t) => (
                <div key={t.id} className="ui-list-item">
                  <div><Box fontWeight="bold" variant="span">{taskTitle(t)}</Box>　<StatusIndicator type="pending">{uiText("workbenchFocus.awaiting.my.review")}</StatusIndicator></div>
                  <Box variant="small" color="text-body-secondary">{t.project_name} · {t.assignee?.display_name ?? uiText("personAvatar.unassigned")} {uiText("workbenchFocus.submitted.due")} {dueText(t.due_at)}</Box>
                  <div><Button variant="normal" onClick={() => navigate(`/todo?task=${t.id}`)}>{uiText("workbenchFocus.start.review")}</Button></div>
                </div>
              ))}
            </SpaceBetween>
          </Container>
          <Container embedded cardId="workbench-handoffs" header={<Header variant="h2" help={uiText('taskWorkflow.recentHint')}>{uiText('taskWorkflow.recent')}</Header>}>
            {data && data.recent_handoffs.length === 0 && <Box color="text-body-secondary">{uiText('taskWorkflow.noChanges')}</Box>}
            <SpaceBetween size="xs">
              {(data?.recent_handoffs ?? []).map((e) => (
                <div key={e.id} className="ui-list-item">
                  <div><Box variant="span" fontWeight="bold">{e.actor?.display_name ?? uiText("taskSummaryPanel.system")}</Box> {eventText(e)}</div>
                  <Box variant="small" color="text-body-secondary">{e.project_name} · {e.task_display ? taskTitle(e.task_display) : e.task_title} · {dateTime(e.created_at)}</Box>
                </div>
              ))}
            </SpaceBetween>
          </Container>
        </SpaceBetween>
      } />
    </SpaceBetween>
  );
}
