import { projectUpdateText } from '../../i18n/taskDisplay.ts';
import { eventText } from '../../i18n/taskDisplay.ts';
import { taskTitle } from '../../i18n/templateNames.ts';
import { systemText } from '../../i18n/core.ts';
import { useLanguage } from '../../i18n/LanguageProvider';
import { m as uiText } from '../../i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group';
import Button from '@cloudscape-design/components/button';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Grid from '@cloudscape-design/components/grid';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, Task, type Update } from '../../api/client';
import {procurementReturnTo} from '../../lib/procurementForm';
import PersonAvatar from '../../components/PersonAvatar';
import TaskTimeline from '../../components/TaskTimeline';
import KeyValuePairs from '../../components/ui/Facts';
import Header from '../../components/ui/Header';
import Container from '../../components/ui/Surface';
import { useActor } from '../../lib/actor';
import { useMeta } from '../../lib/meta';
import { stageKeyLabel } from '../../lib/stageGroups';
import { dueText, statusIndicator } from '../../lib/taskGroups';

/**
 * 项目内的任务活动记录页（KAN-75 块 4，目标图 12）。共享留痕：谁分派、谁开始、谁等待、谁改派，全在这里。
 * 只看不做：详情与交付在「我的事项」处理，这里只给入口。邮件提醒按钮等块 3。
 */
export default function TaskHistoryPage() {
  useLanguage();
  const { id, taskId } = useParams();
  const pid = Number(id); const tid = Number(taskId);
  const navigate = useNavigate(); const [params]=useSearchParams();
  const [purchaseUpdates,setPurchaseUpdates]=useState<Update[]>([]); const [updatesError,setUpdatesError]=useState('');
  const meta = useMeta();
  const { me } = useActor();
  const [task, setTask] = useState<Task | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.task(pid, tid).then(setTask).catch((e) => setErr(e.message)); }, [pid, tid]);

  useEffect(()=>{if(task?.step_key!=='purchase')return;let active=true;api.projectUpdates(pid,200).then(rows=>{if(active)setPurchaseUpdates(rows.filter(r=>r.kind==='procurement'));}).catch(e=>{if(active)setUpdatesError(e.message);});return()=>{active=false;};},[pid,task?.step_key]);

  if (err) return <ContentLayout header={<Header variant="h1">{uiText("taskHistoryPage.task.activity.history")}</Header>}><Alert type="error">{systemText(err)}</Alert></ContentLayout>;
  if (!task) return <Box padding="xxl" textAlign="center"><Spinner size="large" /></Box>;
  const mine = !!me && (task.assignee?.id === me.id || task.reviewer?.id === me.id);

  return (
    <ContentLayout
      breadcrumbs={<BreadcrumbGroup items={[{ text: uiText("app.workspace"), href: '/' }, { text: uiText("app.projects"), href: '/projects' }, { text: task.project_name, href: `/projects/${pid}` }, { text: uiText("sentences.activity.history", { value1: (taskTitle(task)) }), href: `/projects/${pid}/tasks/${tid}` }]} onFollow={(e) => { e.preventDefault(); navigate(e.detail.href); }} />}
      header={
        <Header
          variant="h1"
          description={`${task.project_name} · ${task.project_address}`}
          actions={<SpaceBetween direction="horizontal" size="xs">{task.step_key==='purchase' && <Button onClick={()=>navigate(procurementReturnTo(params.get('returnTo'),String(pid)))}>{uiText("purchaseOrders.back.to.property.procurement")}</Button>}<Button onClick={() => navigate(`/projects/${pid}?tab=overview`)} iconName="arrow-left">{uiText("taskHistoryPage.back.to.project.overview")}</Button></SpaceBetween>}
        >
          <span>{taskTitle(task)} {uiText("taskHistoryPage.activity.history")} <StatusIndicator type={statusIndicator(task.exec_status)}>{systemText(task.exec_status_label)}</StatusIndicator></span>
        </Header>
      }
    >
      <Grid gridDefinition={[{ colspan: { default: 12, m: 8 } }, { colspan: { default: 12, m: 4 } }]}>
        <Container cardId="task-history" header={<Header variant="h2" help={uiText("taskHistoryPage.who.did.what.and.when.read.only")}>{uiText("taskSummaryPanel.activity.history")}</Header>}>
          <TaskTimeline projectId={pid} taskId={tid} />
          {task.step_key==='purchase' && <section><Header variant="h3">{uiText("taskHistoryPage.requirement.scope.and.order.records")}</Header>{updatesError ? <Alert type="error">{updatesError}</Alert> : purchaseUpdates.length ? purchaseUpdates.map(r=><div className="ui-event-row" key={r.id}><Box fontSize="body-s">{r.created_at.replace('T',' ')}</Box><div>{projectUpdateText(r)}</div></div>) : <Box>{uiText("taskHistoryPage.no.procurement.scope.changes.recorded")}</Box>}<Box fontSize="body-s">{uiText("taskHistoryPage.procurement.activity.from.the.latest.200.project.records.detailed")}</Box></section>}
        </Container>
        <SpaceBetween size="l">
          <Container cardId="history-summary" header={<Header variant="h2">{uiText("taskSummaryPanel.task.summary")}</Header>}>
            <KeyValuePairs columns={1} items={[
              { label: uiText("taskTable.task"), value: <div><Box fontWeight="bold">{taskTitle(task)}</Box><Box variant="small" color="text-body-secondary">{stageKeyLabel(meta?.stage_groups, task.stage_key, task.stage_label)}{task.ws ? ` · ${systemText(task.ws)}` : ''}</Box></div> },
              { label: uiText('task.assignee'), value: <PersonAvatar user={task.assignee} /> },
              ...(task.step_key==='purchase' ? [] : [{ label: uiText("taskSummaryPanel.reviewer"), value: task.reviewer ? <PersonAvatar user={task.reviewer} /> : '—' }]),
              { label: uiText("taskTable.due"), value: task.due_at ? dueText(task.due_at) : <Box color="text-body-secondary">{uiText("projectPreplan.not.set")}</Box> },
              { label: uiText("taskHistoryPage.current.status"), value: <StatusIndicator type={statusIndicator(task.exec_status)}>{systemText(task.exec_status_label)}</StatusIndicator> },
              { label: task.step_key==='purchase' ? uiText("taskHistoryPage.materials.ready.before.rough.in") : uiText("taskSummaryPanel.evidence.assessment"), value: task.satisfied ? <StatusIndicator type="success">{uiText("taskSummaryPanel.requirements.met")}</StatusIndicator> : <Box color="text-body-secondary">{uiText("taskSummaryPanel.requirements.not.met")}</Box> },
              { label: uiText("fieldWithSource.source"), value: task.source === 'node_confirmation' ? uiText("taskHistoryPage.milestone.confirmation") : task.source === 'template' ? uiText("taskHistoryPage.project.template") : task.source === 'adhoc' ? uiText("taskHistoryPage.ad.hoc.task") : uiText("taskHistoryPage.requirement.change") },
            ]} />
          </Container>
          <Container cardId="history-entry" header={<Header variant="h2" help={uiText("taskHistoryPage.handle.task.details.and.deliverables.in.my.tasks")}>{uiText("taskHistoryPage.action.entry")}</Header>}>
            <SpaceBetween size="s">
              {task.step_key==='purchase' ? <Button onClick={()=>navigate(procurementReturnTo(params.get('returnTo'),String(pid)))}>{uiText("taskHistoryPage.view.property.requirements.and.orders")}</Button> : (mine || task.node_confirmation?.can_confirm) ? <Button variant="primary" onClick={() => navigate(`/todo?task=${task.id}${task.node_confirmation ? "&view=review" : ""}`)}>{uiText("taskHistoryPage.open.my.tasks")}</Button> : <Box color="text-body-secondary">{uiText("taskHistoryPage.this.task.is.not.assigned.to.you.its.assignee")}</Box>}

            </SpaceBetween>
          </Container>
        </SpaceBetween>
      </Grid>
    </ContentLayout>
  );
}
