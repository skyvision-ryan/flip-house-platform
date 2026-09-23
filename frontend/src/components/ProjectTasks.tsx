import { useCallback, useEffect, useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Grid from '@cloudscape-design/components/grid';
import Spinner from '@cloudscape-design/components/spinner';
import { api, Project, Task, TaskList } from '../api/client';
import { useActor } from '../lib/actor';
import { useMeta } from '../lib/meta';
import { userCan } from '../lib/role';
import TaskAssignModal from './TaskAssignModal';
import TaskSummaryPanel from './TaskSummaryPanel';
import TaskTable from './TaskTable';

/**
 * 单套房的任务区（KAN-75 块 1）：左表右摘要，一套任务入口。
 * 分派按钮按**登录账号**判断（userCan）；演示模式没登录只能看，明说原因。
 * 保存成功后用服务器返回的那条替换本地，不做乐观更新；409 整体重读。
 */
export default function ProjectTasks({ project, onChanged, onGotoGates }: { project: Project; onChanged?: () => void; onGotoGates: () => void }) {
  const meta = useMeta();
  const { me } = useActor();
  const [data, setData] = useState<TaskList | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [assigning, setAssigning] = useState<Task | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    try { setData(await api.projectTasks(project.id)); setErr(null); } catch (e: any) { setErr(e.message); }
  }, [project.id]);
  useEffect(() => { load(); }, [load, project.updated_at]);

  const canAssign = userCan(meta, me, 'assign_tasks');
  const selected = data?.tasks.find((t) => t.id === selectedId) ?? null;
  const replace = (t: Task) => {
    setData((prev) => (prev ? { ...prev, tasks: prev.tasks.map((x) => (x.id === t.id ? t : x)) } : prev));
    setSelectedId(t.id);
    setRefreshKey((k) => k + 1);
    onChanged?.();
  };

  if (err) return <Alert type="error" header="读不到任务">{err}</Alert>;
  if (!data) return <Box textAlign="center" padding="m"><Spinner /></Box>;

  return (
    <>
      {!me && <Alert type="info">现在没有登录：任务表只能看。分派、开始、等待都要用真实账号登录后做。</Alert>}
      <Grid gridDefinition={[{ colspan: { default: 12, m: 8 } }, { colspan: { default: 12, m: 4 } }]}>
        <Container disableContentPaddings>
          <TaskTable data={data} selectedId={selectedId} onSelect={(t) => setSelectedId(t.id)} canAssign={canAssign} onAssign={setAssigning} />
        </Container>
        <TaskSummaryPanel task={selected} project={project} canAssign={canAssign} onAssign={setAssigning} onChanged={replace} onGotoGates={onGotoGates} refreshKey={refreshKey} />
      </Grid>
      {assigning && (
        <TaskAssignModal
          projectId={project.id}
          task={assigning}
          onDone={(t) => { setAssigning(null); replace(t); }}
          onConflict={() => { setAssigning(null); load(); }}
          onDismiss={() => setAssigning(null)}
        />
      )}
    </>
  );
}
