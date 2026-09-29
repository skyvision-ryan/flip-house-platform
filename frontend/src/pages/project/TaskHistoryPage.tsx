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

  if (err) return <ContentLayout header={<Header variant="h1">任务活动记录</Header>}><Alert type="error">{err}</Alert></ContentLayout>;
  if (!task) return <Box padding="xxl" textAlign="center"><Spinner size="large" /></Box>;
  const mine = !!me && (task.assignee?.id === me.id || task.reviewer?.id === me.id);

  return (
    <ContentLayout
      breadcrumbs={<BreadcrumbGroup items={[{ text: '工作台', href: '/' }, { text: '项目', href: '/projects' }, { text: task.project_name, href: `/projects/${pid}` }, { text: `${task.title} · 活动记录`, href: `/projects/${pid}/tasks/${tid}` }]} onFollow={(e) => { e.preventDefault(); navigate(e.detail.href); }} />}
      header={
        <Header
          variant="h1"
          description={`${task.project_name} · ${task.project_address}`}
          actions={<SpaceBetween direction="horizontal" size="xs">{task.step_key==='purchase' && <Button onClick={()=>navigate(procurementReturnTo(params.get('returnTo'),String(pid)))}>返回本房采购</Button>}<Button onClick={() => navigate(`/projects/${pid}?tab=overview`)} iconName="arrow-left">返回项目总览</Button></SpaceBetween>}
        >
          <span>{task.title} · 活动记录　<StatusIndicator type={statusIndicator(task.exec_status)}>{task.exec_status_label}</StatusIndicator></span>
        </Header>
      }
    >
      <Grid gridDefinition={[{ colspan: { default: 12, m: 8 } }, { colspan: { default: 12, m: 4 } }]}>
        <Container cardId="task-history" header={<Header variant="h2" help="每一步是谁、什么时候、做了什么。只读。">活动记录</Header>}>
          <TaskTimeline projectId={pid} taskId={tid} />
          {task.step_key==='purchase' && <section><Header variant="h3">需求范围与订单记录</Header>{updatesError ? <Alert type="error">{updatesError}</Alert> : purchaseUpdates.length ? purchaseUpdates.map(r=><div className="ui-event-row" key={r.id}><Box fontSize="body-s">{r.created_at.replace('T',' ')}</Box><div>{r.text}</div></div>) : <Box>暂无采购范围调整记录。</Box>}<Box fontSize="body-s">显示最近 200 条项目记录中的采购活动；具体订单与收货版本保留在订单详情。</Box></section>}
        </Container>
        <SpaceBetween size="l">
          <Container cardId="history-summary" header={<Header variant="h2">任务摘要</Header>}>
            <KeyValuePairs columns={1} items={[
              { label: '任务', value: <div><Box fontWeight="bold">{task.title}</Box><Box variant="small" color="text-body-secondary">{stageKeyLabel(meta?.stage_groups, task.stage_key, task.stage_label)}{task.ws ? ` · ${task.ws}` : ''}</Box></div> },
              { label: '负责人', value: <PersonAvatar user={task.assignee} /> },
              ...(task.step_key==='purchase' ? [] : [{ label: '审核人', value: task.reviewer ? <PersonAvatar user={task.reviewer} /> : '—' }]),
              { label: '截止', value: task.due_at ? dueText(task.due_at) : <Box color="text-body-secondary">未设定</Box> },
              { label: '当前状态', value: <StatusIndicator type={statusIndicator(task.exec_status)}>{task.exec_status_label}</StatusIndicator> },
              { label: task.step_key==='purchase' ? '水电前材料齐备' : '证据判定', value: task.satisfied ? <StatusIndicator type="success">已满足</StatusIndicator> : <Box color="text-body-secondary">未满足</Box> },
              { label: '来源', value: task.source === 'node_confirmation' ? '节点确认' : task.source === 'template' ? '项目模板' : task.source === 'adhoc' ? '临时新增' : '需求变更' },
            ]} />
          </Container>
          <Container cardId="history-entry" header={<Header variant="h2" help="任务详情与交付在「我的事项」处理。">处理入口</Header>}>
            <SpaceBetween size="s">
              {task.step_key==='purchase' ? <Button onClick={()=>navigate(procurementReturnTo(params.get('returnTo'),String(pid)))}>查看本房需求与订单</Button> : (mine || task.node_confirmation?.can_confirm) ? <Button variant="primary" onClick={() => navigate(`/todo?task=${task.id}${task.node_confirmation ? "&view=review" : ""}`)}>前往我的事项</Button> : <Box color="text-body-secondary">这项任务不在你名下；负责人和审核人在「我的事项」处理。</Box>}

            </SpaceBetween>
          </Container>
        </SpaceBetween>
      </Grid>
    </ContentLayout>
  );
}
