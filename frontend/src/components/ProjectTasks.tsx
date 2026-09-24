import { useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import CollaborationWorkspace from './ui/CollaborationWorkspace';
import Spinner from '@cloudscape-design/components/spinner';
import { Project, Task, TaskList } from '../api/client';
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
export default function ProjectTasks({ project, data, error, reload, onChanged, onGotoGates }: { project: Project; data: TaskList | null; error: string | null; reload: () => Promise<any>; onChanged?: () => void; onGotoGates: () => void }) {
  const meta = useMeta();
  const { me } = useActor();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [assigning, setAssigning] = useState<Task[] | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const err = error;
  const load = reload;

  const canAssign = userCan(meta, me, 'assign_tasks');
  const selected = data?.tasks.find((t) => t.id === selectedId) ?? null;
  // 保存成功后整体重读（头卡三条事实也要跟着变），不做乐观更新
  const replace = (t: Task) => {
    setSelectedId(t.id);
    setRefreshKey((k) => k + 1);
    load();
    onChanged?.();
  };

  if (err) return <Alert type="error" header="读不到任务">{err}</Alert>;
  if (!data) return <Box textAlign="center" padding="m"><Spinner /></Box>;

  return (
    <>
      {!me && <Alert type="info">现在没有登录：任务表只能看。分派、开始、等待都要用真实账号登录后做。</Alert>}
      <CollaborationWorkspace detailOpen={!!selected} onBack={() => setSelectedId(null)} main={
          <TaskTable data={data} selectedId={selectedId} onSelect={(t) => setSelectedId(t.id)} canAssign={canAssign} onAssign={(ts) => setAssigning(ts)} />
        } detail={<TaskSummaryPanel task={selected} project={project} canAssign={canAssign} onAssign={(t) => setAssigning([t])} onChanged={replace} onGotoGates={onGotoGates} refreshKey={refreshKey} />
      } />
      {assigning && assigning.length > 0 && (
        <TaskAssignModal
          projectId={project.id}
          tasks={assigning}
          onDone={(t) => { setAssigning(null); replace(t); }}
          onConflict={() => { setAssigning(null); load(); }}
          onDismiss={() => setAssigning(null)}
        />
      )}
    </>
  );
}
