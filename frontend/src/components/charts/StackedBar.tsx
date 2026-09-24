import { FONT, SERIES, TEXT, TEXT_2 } from './palette';
import { useTooltip } from './Tooltip';

export interface Segment { label: string; value: number; color?: string }
interface Props {
  segments: Segment[];
  format?: (n: number) => string;
  /** 参考线（同一量纲），如售价 */
  marker?: { value: number; label: string };
  height?: number;
  /** 图例列表：色块、名称、金额、占比 */
  legend?: boolean;
  /** 图例分几列 */
  legendColumns?: 1 | 2;
  emptyText?: string;
}

/** 部分对整体：一根横条，段间 2px 白隙，段内放得下才写数字；可加一条参考线。 */
export default function StackedBar({ segments, format = (n) => String(n), marker, height = 22, legend = true, legendColumns = 1, emptyText = '暂无数据' }: Props) {
  const tip = useTooltip();
  const segs = segments.filter((s) => s.value > 0).map((s, i) => ({ ...s, color: s.color ?? SERIES[i % SERIES.length] }));
  const total = segs.reduce((a, s) => a + s.value, 0);
  if (!segs.length) return <div style={{ fontFamily: FONT, color: TEXT_2, fontSize: 13 }}>{emptyText}</div>;
  const scale = Math.max(total, marker?.value ?? 0) * (marker ? 1.06 : 1);
  const barWidthPct = (total / scale) * 100;

  return (
    <div style={{ position: 'relative', fontFamily: FONT }}>
      <div style={{ position: 'relative', paddingTop: marker ? 18 : 0 }}>
        <div style={{ display: 'flex', gap: 2, height, width: `${barWidthPct}%`, borderRadius: height / 2, overflow: 'hidden' }}>
          {segs.map((s) => {
            const pct = (s.value / total) * 100;
            return (
              <div
                key={s.label}
                style={{ flex: `${s.value} 0 0`, background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700, overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 }}
                onMouseMove={(e) => tip.show(e, [{ label: s.label, value: format(s.value), color: s.color }, { label: '占比', value: `${pct.toFixed(1)}%` }])}
                onMouseLeave={tip.hide}
              >
                {pct >= 12 ? <span style={{ padding: '0 6px' }}>{format(s.value)}</span> : null}
              </div>
            );
          })}
        </div>
        {marker && (
          <div style={{ position: 'absolute', left: `${(marker.value / scale) * 100}%`, top: 0, bottom: 0, transform: 'translateX(-1px)' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, transform: 'translateX(-50%)', fontSize: 12, color: TEXT_2, whiteSpace: 'nowrap' }}>{marker.label} {format(marker.value)}</div>
            <div style={{ position: 'absolute', top: 16, bottom: -4, width: 2, background: TEXT, borderRadius: 1 }} />
          </div>
        )}
      </div>
      {legend && (
        <div style={{ display: 'grid', gridTemplateColumns: legendColumns === 2 ? '1fr 1fr' : '1fr', columnGap: 24, rowGap: 6, marginTop: 14, fontSize: 13 }}>
          {segs.map((s) => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
              <span style={{ color: TEXT, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
              <span style={{ color: TEXT_2, fontVariantNumeric: 'tabular-nums' }}>{format(s.value)}</span>
              <span style={{ color: TEXT, fontWeight: 700, minWidth: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{((s.value / total) * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}
      {tip.node}
    </div>
  );
}
