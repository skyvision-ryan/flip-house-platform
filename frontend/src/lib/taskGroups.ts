import type { Task, TaskExecStatus } from '../api/client';

/**
 * 「我的事项」的分组规则（KAN-75 块 1）。纯函数、不碰 DOM，能单测。
 *
 * 分组是**列表分组**，不是新状态：
 * - 现在可做：当前段或更早段、还没到等待/完成的任务
 * - 等待中：执行状态是「等待」
 * - 提前准备：所属段在项目当前段之后——已经分派给你，可以先看要求，但项目还没走到
 * - 已完成：执行状态是「已完成」（块 5 之后才会出现）
 */
export type MyGroupKey = 'now' | 'waiting' | 'later' | 'done';

export interface MyGroups { now: Task[]; waiting: Task[]; later: Task[]; done: Task[] }

export function groupMyTasks(tasks: Task[]): MyGroups {
  const g: MyGroups = { now: [], waiting: [], later: [], done: [] };
  for (const t of tasks) {
    if (t.exec_status === 'done') g.done.push(t);
    else if (t.exec_status === 'waiting') g.waiting.push(t);
    else if (t.stage_index > t.project_current_stage_index) g.later.push(t);
    else g.now.push(t);
  }
  const byDue = (a: Task, b: Task) => (a.due_at ?? '9999') < (b.due_at ?? '9999') ? -1 : (a.due_at ?? '9999') > (b.due_at ?? '9999') ? 1 : a.id - b.id;
  g.now.sort(byDue); g.waiting.sort(byDue); g.later.sort(byDue); g.done.sort(byDue);
  return g;
}

export const GROUP_LABEL: Record<MyGroupKey, string> = { now: '现在可做', waiting: '等待中', later: '提前准备', done: '已完成' };

/** 执行状态 → Cloudscape StatusIndicator 类型。只有这五种，别的值当未开始处理。 */
export function statusIndicator(s: TaskExecStatus | string): 'stopped' | 'in-progress' | 'pending' | 'success' {
  if (s === 'in_progress') return 'in-progress';
  if (s === 'waiting' || s === 'pending_review') return 'pending';
  if (s === 'done') return 'success';
  return 'stopped';
}

/** 头像里的字母：优先账号名首字母；中文名取前两个字。 */
export function initialsOf(u: { username: string; display_name: string } | null | undefined): string {
  if (!u) return '?';
  const u2 = u.username.trim();
  if (/^[A-Za-z0-9]/.test(u2)) return u2.slice(0, 2).toUpperCase();
  return [...u.display_name.trim()].slice(0, 2).join('') || '?';
}

/** 能否对这项任务做 开始 / 等待 / 恢复：只有当前负责人本人。返回可用动作。 */
export function statusActions(t: Task, meId: number | null): ('start' | 'wait' | 'resume')[] {
  if (meId == null || !t.assignee || t.assignee.id !== meId) return [];
  if (t.exec_status === 'not_started') return ['start', 'wait'];
  if (t.exec_status === 'in_progress') return ['wait'];
  if (t.exec_status === 'waiting') return ['resume'];
  return [];
}

/** 「YYYY-MM-DD」→「MM/DD」；空值显示未设定。 */
export function dueText(due: string | null | undefined): string {
  return due ? due.slice(5, 10).replace('-', '/') : '未设定';
}
