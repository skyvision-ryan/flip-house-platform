import { systemText } from '../i18n/core.ts';
import { eventText } from '../i18n/taskDisplay.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
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
  useLanguage();
  const [events, setEvents] = useState<TaskEvent[] | null>(null);
  useEffect(() => {
    let alive = true;
    setEvents(null);
    api.taskEvents(projectId, taskId).then((e) => { if (alive) setEvents(e); }).catch(() => { if (alive) setEvents([]); });
    return () => { alive = false; };
  }, [projectId, taskId, refreshKey]);
  if (events === null) return <Box padding="s"><Spinner size="normal" /></Box>;
  if (!events.length) return <Box color="text-body-secondary" fontSize="body-s">{uiText("taskTimeline.no.activity.records.yet")}</Box>;
  const rows = limit ? events.slice(0, limit) : events;
  return (
    <SpaceBetween size="xs">
      {rows.map((e) => (
        <div key={e.id} className="ui-event-row">
          <Box fontSize="body-s" color="text-body-secondary">{dateTime(e.created_at)}</Box>
          <div>
            <Box variant="span" fontWeight="bold">{e.actor ? e.actor.display_name : uiText("taskSummaryPanel.system")}</Box>
            {e.actor && <Box variant="span" color="text-body-secondary" fontSize="body-s">　{systemText(e.actor_role_snapshot ?? e.actor.role_code)}</Box>}
            <div>{eventText(e)}</div>
          </div>
        </div>
      ))}
      {limit && events.length > limit && <Box fontSize="body-s" color="text-body-secondary">{uiText("taskTimeline.there.are")} {events.length - limit} {uiText("taskTimeline.older.records")}</Box>}
    </SpaceBetween>
  );
}
