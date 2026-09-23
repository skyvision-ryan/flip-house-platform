import { useEffect, useState } from 'react';
import Box from '@cloudscape-design/components/box';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import { api, TaskEvent } from '../api/client';
import { dateTime } from '../lib/format';

/**
 * 任务活动记录（KAN-75）：谁、什么时候、做了什么，倒序。数据是结构化事件，不是自由文本，
 * 所以不复用 UpdatesList。块 4 的项目内活动记录页、块 5 的我的事项都用它。
 */
export default function TaskTimeline({ projectId, taskId, refreshKey = 0, limit }: { projectId: number; taskId: number; refreshKey?: number; limit?: number }) {
  const [events, setEvents] = useState<TaskEvent[] | null>(null);
  useEffect(() => {
    let alive = true;
    setEvents(null);
    api.taskEvents(projectId, taskId).then((e) => { if (alive) setEvents(e); }).catch(() => { if (alive) setEvents([]); });
    return () => { alive = false; };
  }, [projectId, taskId, refreshKey]);
  if (events === null) return <Box padding="s"><Spinner size="normal" /></Box>;
  if (!events.length) return <Box color="text-body-secondary" fontSize="body-s">还没有记录：这项任务还没分派、也没人动过。</Box>;
  const rows = limit ? events.slice(0, limit) : events;
  return (
    <SpaceBetween size="xs">
      {rows.map((e) => (
        <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '112px 1fr', gap: 8, alignItems: 'baseline' }}>
          <Box fontSize="body-s" color="text-body-secondary">{dateTime(e.created_at)}</Box>
          <div>
            <Box variant="span" fontWeight="bold">{e.actor ? e.actor.display_name : '系统'}</Box>
            {e.actor && <Box variant="span" color="text-body-secondary" fontSize="body-s">　{e.actor_role_snapshot ?? e.actor.role_code}</Box>}
            <div>{e.text}</div>
          </div>
        </div>
      ))}
      {limit && events.length > limit && <Box fontSize="body-s" color="text-body-secondary">还有 {events.length - limit} 条更早的记录。</Box>}
    </SpaceBetween>
  );
}
