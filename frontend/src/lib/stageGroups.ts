import type { GroupPosition, StageGroup } from '../api/client';

/**
 * 五格位置条的数据（KAN-75 块 2）。纯函数，能单测。
 * 位置只由后端 group_position 决定；这里不看任务、不看时间——「阶段位置 · 不代表任务完成比例」。
 */
export type SegmentState = 'done' | 'current' | 'future';
export interface Segment { key: string; label: string; index: number; state: SegmentState; note: string | null }

export function segmentsOf(groups: StageGroup[] | null | undefined, gp: GroupPosition | null | undefined): Segment[] {
  if (!groups?.length || !gp) return [];
  return groups.map((g, i) => {
    const idx = i + 1;
    const state: SegmentState = gp.complete ? 'done' : idx < gp.group_index ? 'done' : idx === gp.group_index ? 'current' : 'future';
    let note: string | null = null;
    if (state === 'current' && gp.sub_label) note = gp.sub_label + (gp.sub_key === 'pre' && gp.lead_substage_label ? ` · ${gp.lead_substage_label}` : '');
    if (state === 'done' && g.key === 'buying' && gp.frozen_substage_label) note = `过门前档位：${gp.frozen_substage_label}`;
    if (state === 'current' && g.key === 'buying' && gp.sub_key === 'escrow' && gp.frozen_substage_label) note = `escrow 中 · 过门前档位：${gp.frozen_substage_label}`;
    return { key: g.key, label: g.label, index: idx, state, note };
  });
}

/** 列表筛选项：全部 + 每组（买房拆成两个子项）。value 形如 `buying:pre` / `renovation`。 */
export function groupFilterOptions(groups: StageGroup[] | null | undefined): { value: string; label: string }[] {
  const out = [{ value: '', label: '全部位置' }];
  for (const g of groups ?? []) {
    if (g.subs.length) g.subs.forEach((s) => out.push({ value: `${g.key}:${s.key}`, label: `${g.label} · ${s.label}` }));
    else out.push({ value: g.key, label: g.label });
  }
  return out;
}

/** 一个项目是否落在筛选值里。空值 = 全部。 */
export function matchesGroupFilter(gp: GroupPosition | null | undefined, value: string): boolean {
  if (!value) return true;
  if (!gp) return false;
  const [g, sub] = value.split(':');
  return gp.group_key === g && (!sub || gp.sub_key === sub);
}

/** 从 URL 参数拼筛选值；没有就空。 */
export function filterFromParams(group: string | null, sub: string | null): string {
  if (!group) return '';
  return sub ? `${group}:${sub}` : group;
}

/** 六段 key → 位置条上的说法，给任务表的阶段筛选用（不硬编码六段名）。 */
export function stageKeyLabel(groups: StageGroup[] | null | undefined, stageKey: string, fallback: string): string {
  for (const g of groups ?? []) {
    const sub = g.subs.find((s) => s.stage === stageKey);
    if (sub) return `${g.label} · ${sub.label}`;
    if (g.stages.includes(stageKey)) return g.label;
  }
  return fallback;
}
