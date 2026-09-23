/**
 * 「补全情况」的真实统计（KAN-71）。纯函数，可单测。
 *
 * 替掉向导第二步那句写死的「来源均为公共记录或模型估值，把握度正常」——它不看数据，
 * 演示数据也这么说。现在按字段实际的 source/confidence 拼文案。
 */
export type SourceField = { field: string; label: string; value: string; source: string; confidence: number | null };

export type SourceSummary = {
  filled: number;
  /** 只统计有值的字段，按出现顺序。 */
  bySource: { source: string; count: number }[];
  /** 把握度低的字段。人工填的和没给把握度的（演示数据、待核实）都不算——没有数就不能说低。 */
  lowConf: SourceField[];
};

export const LOW_CONFIDENCE = 0.8;

export function summarizeSources(fields: SourceField[], threshold = LOW_CONFIDENCE): SourceSummary {
  const filledFields = fields.filter((f) => f.value !== '');
  const counts = new Map<string, number>();
  for (const f of filledFields) counts.set(f.source, (counts.get(f.source) ?? 0) + 1);
  return {
    filled: filledFields.length,
    bySource: [...counts].map(([source, count]) => ({ source, count })),
    lowConf: filledFields.filter((f) => f.source !== 'manual' && f.confidence != null && f.confidence < threshold),
  };
}

/** 「已补全 12 项，来源：演示数据 12 项。」没填任何项就说没填，不说「正常」。 */
export function summaryText(s: SourceSummary, labelOf: (source: string) => string = (x) => x): string {
  if (s.filled === 0) return '还没有任何房产数据。';
  const parts = s.bySource.map((b) => `${labelOf(b.source)} ${b.count} 项`).join('、');
  const low = s.lowConf.length ? `其中 ${s.lowConf.length} 项把握度低（${s.lowConf.map((f) => f.label).join('、')}），建议核对。` : '';
  return `已补全 ${s.filled} 项，来源：${parts}。${low}`;
}
