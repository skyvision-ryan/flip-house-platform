import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useNavigate } from 'react-router-dom';
import type { TaskSignal } from '../api/client';
import { m } from '../i18n/core';
import { useLanguage } from '../i18n/LanguageProvider';
import { taskTitle } from '../i18n/templateNames';
import { dateTime, dateStr } from '../lib/format';
import ExpandableSection from './ui/ExpandableSection';
export default function TaskSignals({ signals }: { signals: TaskSignal[] }) {
  useLanguage(); const navigate = useNavigate();
  return <ExpandableSection headerText={m('taskWorkflow.recent')} headerDescription={m('taskWorkflow.recentHint')} defaultExpanded variant="container">
    <SpaceBetween size="m">
      {!signals.length && <Box color="text-body-secondary">{m('taskWorkflow.noChanges')}</Box>}
      {signals.slice(0, 6).map(signal => <div key={signal.id} className="ui-task-signal">
        <StatusIndicator type={signal.kind === 'evidence_missing' ? 'warning' : 'success'}>{m(signal.kind === 'evidence_missing' ? 'taskWorkflow.missing' : signal.mode === 'record' ? 'taskWorkflow.recordMet' : 'taskWorkflow.met')}</StatusIndicator>
        <Button variant="inline-link" onClick={() => navigate(`/projects/${signal.project_id}?tab=overview&task=${signal.task_id}`)}>{signal.project_name} · {taskTitle(signal)}</Button>
        <Box variant="small" color="text-body-secondary">{dateTime(signal.created_at)}</Box>
        {signal.next ? <div><Box variant="small">{m('taskWorkflow.next')}</Box><Button variant="inline-link" onClick={() => navigate(`/projects/${signal.project_id}?tab=overview&task=${signal.next!.id}`)}>{taskTitle(signal.next)}</Button><Box variant="small" color="text-body-secondary">{signal.next.assignee?.display_name ?? m('taskWorkflow.notAssigned')} · {dateStr(signal.next.due_at)}</Box></div> : <Box variant="small" color="text-body-secondary">{m('taskWorkflow.noNext')}</Box>}
      </div>)}
    </SpaceBetween>
  </ExpandableSection>;
}
