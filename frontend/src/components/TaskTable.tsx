import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import TextFilter from '@cloudscape-design/components/text-filter';
import { useEffect, useMemo, useState } from 'react';
import type { Task, TaskList } from '../api/client';
import { useMeta } from '../lib/meta';
import { stageKeyLabel } from '../lib/stageGroups';
import { dueText, statusIndicator } from '../lib/taskGroups';
import css from './CollaborationLayout.module.css';
import HelpText from './HelpText';
import PersonAvatar from './PersonAvatar';
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
  // 勾选框用于批量分派，点行用于看摘要，负责人列的按钮用于单项分派——三件事分开，互不误触
  const [checked, setChecked] = useState<Task[]>([]);
  // 保存分派后表格整体重读，勾选清掉，免得再点「分派」把刚分好的又派一遍
  useEffect(() => { setChecked([]); }, [data.tasks]);
  const meta = useMeta();
  const current = data.stages.find((s) => s.index === data.current_stage_index);
  const [stage, setStage] = useState<string>(current?.key ?? ALL);
  const [q, setQ] = useState('');
  const stageOptions = [
    { value: ALL, label: '全部阶段' },
    // 六段 key 翻成位置条的说法（买房 · 未购入 / escrow 中 / 装修 …），不硬编码六段名
    ...data.stages.map((s) => { const l = stageKeyLabel(meta?.stage_groups, s.key, s.short); return { value: s.key, label: s.index === data.current_stage_index ? `当前：${l}` : l }; }),
  ];
  const rows = useMemo(() => data.tasks.filter((t) => (stage === ALL || t.stage_key === stage) && (!q || t.title.toLowerCase().includes(q.toLowerCase()) || (t.assignee?.display_name ?? '').includes(q))), [data.tasks, stage, q]);
  const unassigned = rows.filter((t) => !t.assignee).length;
  const checkedVisible = checked.filter((c) => rows.some((r) => r.id === c.id));

  return (
    <Table cardId="task-table"
      variant="container"
      items={rows}
      wrapLines
      trackBy="id"
      selectionType={canAssign ? 'multi' : undefined}
      selectedItems={checkedVisible}
      onSelectionChange={({ detail }) => setChecked(detail.selectedItems)}
      onRowClick={({ detail }) => onSelect(detail.item)}
      isItemDisabled={(t) => t.exec_status === 'done'}
      ariaLabels={{ selectionGroupLabel: '勾选后批量分派', allItemsSelectionLabel: () => '全选本页', itemSelectionLabel: (_, t) => t.title }}
      header={
        <Header
          variant="h2"
          counter={`(${rows.length})`}
          description={unassigned ? `${unassigned} 项待分派` : undefined}
          help="点击任务查看摘要，勾选多项可批量分派。"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              {canAssign && <Button disabled={!checkedVisible.length} iconName="user-profile" onClick={() => onAssign(checkedVisible)}>{checkedVisible.length ? `分派 ${checkedVisible.length} 项` : '分派任务'}</Button>}
            </SpaceBetween>
          }
        >
          任务安排
        </Header>
      }
      filter={<div className={css.toolbar}><TextFilter filteringText={q} onChange={({ detail }) => setQ(detail.filteringText)} filteringPlaceholder="搜索任务名或负责人" filteringAriaLabel="搜索任务" /><Select selectedOption={stageOptions.find((o) => o.value === stage) ?? stageOptions[0]} options={stageOptions} onChange={({ detail }) => setStage(detail.selectedOption.value ?? ALL)} ariaLabel="按阶段筛选" /></div>}
      empty={<Box textAlign="center" padding="l" color="text-body-secondary">{data.template_missing ? '这套房的任务尚未准备好，请稍后刷新。' : '这个筛选下没有任务。'}</Box>}
      columnDefinitions={[
        {
          id: 'title', header: '任务', minWidth: 145,
          cell: (t) => (
            <div>
              <div style={{ fontWeight: t.id === selectedId ? 700 : 400 }}>{t.title}</div>
              {stage === ALL && <Box variant="small" color="text-body-secondary">{stageKeyLabel(meta?.stage_groups, t.stage_key, t.stage_short)}</Box>}
              <HelpText inline>{t.ws ?? ''}{t.owners.length ? ` · 默认负责角色 ${t.owners.join('、')}` : ''}</HelpText>
            </div>
          ),
        },
        {
          id: 'assignee', header: '主要负责人', minWidth: 130,
          cell: (t) => (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
              <PersonAvatar user={t.assignee} size="small" showRole={false} />
              {canAssign && (
                <Button variant="inline-link" iconName={t.assignee ? 'edit' : 'add-plus'} onClick={() => onAssign([t])} ariaLabel={`${t.assignee ? '改派' : '分派'}：${t.title}`} />
              )}
            </div>
          ),
        },
        {
          id: 'status', header: '状态 / 证据', width: 125,
          cell: (t) => (
            <div>
              <StatusIndicator type={statusIndicator(t.exec_status)}>{t.exec_status_label}</StatusIndicator>
              <Box variant="small" color="text-body-secondary">证据：{t.satisfied ? '已满足' : '未满足'}</Box>
              {t.exec_status === 'waiting' && t.wait_for && <Box variant="small" color="text-body-secondary">等 {t.wait_for}</Box>}
            </div>
          ),
        },
        { id: 'due', header: '截止', width: 80, cell: (t) => <span style={{ whiteSpace: 'nowrap' }}>{t.due_at ? dueText(t.due_at) : <Box variant="span" color="text-body-secondary">未设定</Box>}</span> },
      ]}
    />
  );
}
