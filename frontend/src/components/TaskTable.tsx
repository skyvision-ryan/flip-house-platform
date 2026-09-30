import { taskTitle } from '../i18n/templateNames.ts';
import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import Box from '@cloudscape-design/components/box';
import Select from '@cloudscape-design/components/select';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import TextFilter from '@cloudscape-design/components/text-filter';
import { useMemo, useState } from 'react';
import type { Task, TaskList } from '../api/client';
import { useMeta } from '../lib/meta';
import { stageKeyLabel } from '../lib/stageGroups';
import { dueText, statusIndicator } from '../lib/taskGroups';
import css from './ui/CollaborationLayout.module.css';
import HelpText from './HelpText';
import PersonAvatar from './PersonAvatar';
import AssigneeButton from './AssigneeButton';
import Header from './ui/Header';
import Table from './ui/Table';

const ALL = '__all__';

/**
 * 项目总览的「任务安排」表（KAN-75 块 1，对应目标图 04–06 的左侧主体）。
 * 列固定：任务 / 主要负责人 / 状态 / 满足 / 截止。点行选中（右侧摘要联动）；
 * 负责人列的按钮打开分派，**不冒泡成选行**——查看、选择、分派三种操作不互相误触。
 * 「状态」是人的执行状态，「满足」是证据判定，并列显示、互不替代。
 */
export default function TaskTable({ data, selectedId, onSelect, canAssign, onAssign }: {
  data: TaskList; selectedId: number | null; onSelect: (t: Task) => void; canAssign: boolean; onAssign: (ts: Task[]) => void;
}) {
  useLanguage();
  const meta = useMeta();
  const current = data.stages.find((s) => s.index === data.current_stage_index);
  const [stage, setStage] = useState<string>(current?.key ?? ALL);
  const [q, setQ] = useState('');
  const stageOptions = [
    { value: ALL, label: uiText("taskTable.all.stages") },
    // 六段 key 翻成位置条的说法（买房 · 未购入 / escrow 中 / 装修 …），不硬编码六段名
    ...data.stages.map((s) => { const l = stageKeyLabel(meta?.stage_groups, s.key, s.short); return { value: s.key, label: s.index === data.current_stage_index ? uiText("sentences.current", { value1: (l) }) : l }; }),
  ];
  const rows = useMemo(() => data.tasks.filter((t) => (stage === ALL || t.stage_key === stage) && (!q || t.title.toLowerCase().includes(q.toLowerCase()) || (t.assignee?.display_name ?? '').includes(q))), [data.tasks, stage, q]);
  const unassigned = rows.filter((t) => !t.assignee && !t.node_confirmation).length;

  return (
    <Table cardId="task-table"
      variant="embedded"
      items={rows}
      wrapLines
      trackBy="id"
      onRowClick={({ detail }) => onSelect(detail.item)}
      ariaLabels={{ tableLabel: uiText("taskTable.task.assignments") }}
      header={
        <Header
          variant="h2"
          counter={`(${rows.length})`}
          description={unassigned ? uiText("sentences.tasks.unassigned", { value1: (unassigned) }) : undefined}
          help={uiText("taskTable.select.a.row.to.view.its.summary.on.the")}
        >
          {uiText("taskTable.task.assignments")} </Header>
      }
      filter={<div className={css.toolbar}><TextFilter filteringText={q} onChange={({ detail }) => setQ(detail.filteringText)} filteringPlaceholder={uiText("taskTable.search.task.name.or.assignee")} filteringAriaLabel={uiText("taskTable.search.tasks")} /><Select selectedOption={stageOptions.find((o) => o.value === stage) ?? stageOptions[0]} options={stageOptions} onChange={({ detail }) => setStage(detail.selectedOption.value ?? ALL)} ariaLabel={uiText("taskTable.filter.by.stage")} /></div>}
      empty={<Box textAlign="center" padding="l" color="text-body-secondary">{data.template_missing ? uiText("taskTable.tasks.are.not.ready.for.this.property.yet.refresh") : uiText("taskTable.no.tasks.match.this.filter")}</Box>}
      columnDefinitions={[
        {
          id: 'title', header: uiText("taskTable.task"), minWidth: 145,
          cell: (t) => (
            <div>
              <button type="button" className="ui-task-select" data-task-selected={t.id === selectedId}
                aria-pressed={t.id === selectedId} aria-label={uiText("sentences.view.task", { value1: (taskTitle(t)) })}
                onClick={(e) => { e.stopPropagation(); onSelect(t); }}>{taskTitle(t)}</button>
              {stage === ALL && <Box variant="small" color="text-body-secondary">{stageKeyLabel(meta?.stage_groups, t.stage_key, t.stage_short)}</Box>}
              <HelpText inline>{t.ws ?? ''}{t.owners.length ? uiText("sentences.default.responsible.roles", { value1: (t.owners.join('、')) }) : ''}</HelpText>
            </div>
          ),
        },
        {
          id: 'assignee', header: uiText("projectPreplan.primary.assignee"), minWidth: 130,
          cell: (t) => (
            <div className="ui-task-person" onClick={(e) => e.stopPropagation()}>
              {t.node_confirmation ? <span>{uiText("taskTable.milestone.confirmation")} {t.node_confirmation.confirm.join(" / ")}</span> : canAssign ? <AssigneeButton user={t.assignee} label={`${t.assignee ? uiText("taskTable.reassign") : uiText("taskTable.assign")}：${taskTitle(t)}`} onClick={() => onAssign([t])} />
                : <PersonAvatar user={t.assignee} size="small" showRole={false} />}
            </div>
          ),
        },
        {
          id: 'status', header: uiText("taskTable.status.evidence"), width: 125,
          cell: (t) => (
            <div>
              <StatusIndicator type={statusIndicator(t.exec_status)}>{systemText(t.exec_status_label)}</StatusIndicator>
              <Box variant="small" color="text-body-secondary">{uiText("taskTable.evidence")}{t.satisfied ? uiText("taskSummaryPanel.requirements.met") : uiText("taskSummaryPanel.requirements.not.met")}</Box>
              {t.exec_status === 'waiting' && t.wait_for && <Box variant="small" color="text-body-secondary">{uiText("taskSummaryPanel.waiting.for")} {t.wait_for}</Box>}
            </div>
          ),
        },
        { id: 'due', header: uiText("taskTable.due"), width: 80, cell: (t) => <span className="ui-nowrap">{t.due_at ? dueText(t.due_at) : <Box variant="span" color="text-body-secondary">{uiText("projectPreplan.not.set")}</Box>}</span> },
      ]}
    />
  );
}
