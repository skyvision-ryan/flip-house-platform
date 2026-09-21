import { ReactNode } from 'react';
import { FONT, ORDINAL_BLUE, SERIES, STATUS, TEXT, TEXT_2, track } from './palette';
import { useTooltip } from './Tooltip';

export interface HBarRow { key: string; label: ReactNode; values: number[]; tooltipTitle?: string }
interface Props {
  rows: HBarRow[];
  /** ≥2 系列时必填，用于图例 */
  series?: string[];
  /** 有序数据（漏斗）：一色渐深，按行序 */
  ordinal?: boolean;
  format?: (n: number) => string;
  labelWidth?: number;
  barHeight?: number;
  emptyText?: string;
}

/** 一组量的大小：横向细条 + 条尾直接标数值。多系列时堆叠并带图例；单系列不画图例。 */
export default function HBars({ rows, series = [], ordinal = false, format = (n) => String(n), labelWidth = 140, barHeight = 12, emptyText = '暂无数据' }: Props) {
  const tip = useTooltip();
  if (!rows.length) return <div style={{ fontFamily: FONT, color: TEXT_2, fontSize: 12 }}>{emptyText}</div>;
  const totals = rows.map((r) => r.values.reduce((a, b) => a + b, 0));
  const max = Math.max(...totals) || 1;
  /**
   * 两个系列时不用分类系列的前两位（蓝 + 品红）——品红在首屏太跳，而且「买入价 / 已支出」
   * 是同一笔钱的两段，不是两个并列类别。改成蓝 + 中性灰（KAN-63）。
   * 三个及以上仍走分类系列；漏斗的 ordinal 蓝阶不动。
   */
  const duo = !ordinal && series.length === 2;
  const DUO = [SERIES[0], STATUS.neutral];
  const colorFor = (rowIdx: number, seriesIdx: number) => (
    ordinal ? ORDINAL_BLUE[Math.min(ORDINAL_BLUE.length - 1, rowIdx)]
      : duo ? DUO[seriesIdx % DUO.length]
        : SERIES[seriesIdx % SERIES.length]);

  return (
    <div style={{ position: 'relative', fontFamily: FONT }}>
      <div style={{ display: 'grid', rowGap: 8 }}>
        {rows.map((r, i) => (
          <div key={r.key} style={{ display: 'grid', gridTemplateColumns: `${labelWidth}px 1fr 64px`, alignItems: 'center', columnGap: 12, fontSize: 12 }}>
            <div style={{ color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
            <div
              style={{ position: 'relative', height: barHeight + 8, display: 'flex', alignItems: 'center' }}
              onMouseMove={(e) => tip.show(e, [
                ...r.values.map((v, j) => ({ label: series[j] ?? '', value: format(v), color: colorFor(i, j) })),
                ...(r.values.length > 1 ? [{ label: '合计', value: format(totals[i]) }] : []),
              ], r.tooltipTitle ?? (typeof r.label === 'string' ? r.label : undefined))}
              onMouseLeave={tip.hide}
            >
              <div style={{ position: 'absolute', left: 0, right: 0, height: barHeight, borderRadius: barHeight / 2, background: track(SERIES[0], 8) }} />
              <div style={{ position: 'relative', display: 'flex', height: barHeight, width: `${(totals[i] / max) * 100}%`, gap: 2 }}>
                {r.values.map((v, j) => (
                  <div key={j} style={{ flex: `${v} 0 0`, background: colorFor(i, j), height: barHeight, borderRadius: j === r.values.length - 1 ? `0 2px 2px 0` : 0 }} />
                ))}
              </div>
            </div>
            <div style={{ color: TEXT, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'right', fontWeight: 700 }}>{format(totals[i])}</div>
          </div>
        ))}
      </div>
      {series.length > 1 && (
        <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: TEXT_2 }}>
          {series.map((s, j) => (
            <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: duo ? DUO[j % DUO.length] : SERIES[j % SERIES.length] }} />{s}
            </span>
          ))}
        </div>
      )}
      {tip.node}
    </div>
  );
}
