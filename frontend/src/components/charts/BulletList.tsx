import { ReactNode } from 'react';
import BudgetBar from './BudgetBar';
import { FONT, SERIES, STATUS, TEXT, TEXT_2, TEXT_BAD } from './palette';
import { useTooltip } from './Tooltip';

export interface BulletRow { label: ReactNode; key: string; actual: number; target: number; note?: string }
interface Props {
  rows: BulletRow[];
  format?: (n: number) => string;
  overAt?: number;
  warnAt?: number;
  reading?: (r: BulletRow) => string;
  labelWidth?: number;
  barHeight?: number;
  emptyText?: string;
  /** 额外刻度（同一量纲），如 70% 法则 */
  extraMarkers?: { key: string; at: (r: BulletRow) => number | null; label: string }[];
  /** 目标刻度下方小字，只在第一行显示，避免重复 */
  targetLabel?: string;
}

/** 一组“实际 vs 目标”：灰底 = 目标，彩条 = 实际，超出段红。同组共用一把尺，底槛长短就是目标大小。 */
export default function BulletList({ rows, format = (n) => String(n), overAt = 1.0, warnAt = 0.9, reading, labelWidth = 150, barHeight = 10, emptyText = '暂无数据', extraMarkers = [], targetLabel }: Props) {
  const tip = useTooltip();
  if (!rows.length) return <div style={{ fontFamily: FONT, color: TEXT_2, fontSize: 13 }}>{emptyText}</div>;
  const scaleMax = Math.max(...rows.flatMap((r) => [r.actual, r.target, ...extraMarkers.map((m) => m.at(r) ?? 0)])) * 1.02 || 1;

  return (
    <div style={{ position: 'relative', fontFamily: FONT, display: 'grid', rowGap: 10 }}>
      {rows.map((r, i) => {
        const ratio = r.target > 0 ? r.actual / r.target : null;
        const over = ratio != null && ratio > overAt;
        const text = reading ? reading(r) : r.target > 0 ? `${format(r.actual)} / ${format(r.target)} · ${Math.round((ratio ?? 0) * 100)}%` : `${format(r.actual)} · 无目标`;
        const markers = extraMarkers.map((m) => ({ at: m.at(r) ?? -1, label: i === 0 ? m.label : undefined })).filter((m) => m.at >= 0);
        return (
          <div key={r.key} style={{ display: 'grid', gridTemplateColumns: `${labelWidth}px 1fr auto`, alignItems: 'center', columnGap: 12, fontSize: 13 }}>
            <div style={{ color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
            <div
              style={{ cursor: 'default', paddingTop: 2 }}
              onMouseMove={(e) => tip.show(e, [
                { label: '实际', value: format(r.actual), color: over ? STATUS.serious : SERIES[0] },
                { label: '目标', value: format(r.target), color: TEXT_2 },
                ...(ratio != null ? [{ label: over ? '超出' : '剩余', value: format(Math.abs(r.target - r.actual)) }] : []),
              ], typeof r.label === 'string' ? r.label : undefined)}
              onMouseLeave={tip.hide}
            >
              <BudgetBar actual={r.actual} target={r.target} scaleMax={scaleMax} height={barHeight} warnAt={warnAt} targetLabel={i === 0 ? targetLabel : undefined} markers={markers} />
            </div>
            <div style={{ color: over ? TEXT_BAD : TEXT, fontWeight: over ? 700 : 400, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{text}</div>
          </div>
        );
      })}
      {tip.node}
    </div>
  );
}
