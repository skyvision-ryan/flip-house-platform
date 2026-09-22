import type { Option } from '../api/client';

/**
 * 来源码 → 中文标签（KAN-71）。纯函数，可单测。
 *
 * 三级回退：`meta.sources`（后端词表，`dictionaries.SOURCES`）→ 内置表 → 原值。
 * 以前 `SourceBadge` 里写死了一张五项的表，而 `Meta.sources` 从未被前端用过——
 * 于是后端加一个来源（比如 KAN-71 的 `demo`），前端得跟着改一处硬编码。
 * 现在优先读词表，内置表只是词表没加载时的兜底，两边对不上时以词表为准。
 */
export const BUILTIN_SOURCE_LABELS: Record<string, string> = {
  manual: '人工',
  public_record: '公共记录',
  lark: 'Lark',
  model: '估算',
  ai: 'AI',
  demo: '演示数据',
  unverified: '待核实',
};

export function sourceLabel(value: string | null | undefined, metaSources?: Option[] | null): string {
  if (!value) return '—';
  const fromMeta = metaSources?.find((s) => s.value === value)?.label;
  if (fromMeta) return fromMeta;
  return BUILTIN_SOURCE_LABELS[value] ?? value;
}

/** 演示与待核实都不是"真"来源——界面上要单独提醒的就这两档。 */
export function isProvisionalSource(value: string | null | undefined): boolean {
  return value === 'demo' || value === 'unverified';
}
