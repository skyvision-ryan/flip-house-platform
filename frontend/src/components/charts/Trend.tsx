import { useEffect, useRef, useState } from 'react';
import { niceTicks } from './format';
import { AXIS, FONT, GRID, SERIES, SURFACE, TEXT, TEXT_2 } from './palette';

export interface TrendPoint { x: string; y: number }
interface Props {
  points: TrendPoint[];
  format?: (n: number) => string;
  height?: number;
  color?: string;
  /** X 轴显示的标签数（首、尾必显） */
  xTicks?: number;
  emptyText?: string;
}

/** 随时间怎么变：2px 线 + 10% 面积晕染 + 末端圆点与直接标注 + 十字线悬停读数；浅色实线水平网格。 */
export default function Trend({ points, format = (n) => String(n), height = 160, color = SERIES[0], xTicks = 4, emptyText = '暂无数据' }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver((es) => setW(Math.max(200, es[0].contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  if (!points.length) return <div style={{ fontFamily: FONT, color: TEXT_2, fontSize: 13 }}>{emptyText}</div>;

  const padL = 44, padR = 56, padT = 12, padB = 24;
  const iw = w - padL - padR, ih = height - padT - padB;
  const maxY = Math.max(...points.map((p) => p.y), 1);
  const ticks = niceTicks(maxY, 3);
  const top = ticks[ticks.length - 1];
  const X = (i: number) => padL + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const Y = (v: number) => padT + ih - (v / top) * ih;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const area = `${line} L${X(points.length - 1).toFixed(1)},${Y(0)} L${X(0).toFixed(1)},${Y(0)} Z`;
  const last = points[points.length - 1];
  const xLabelIdx = new Set<number>([0, points.length - 1]);
  for (let k = 1; k < xTicks - 1; k++) xLabelIdx.add(Math.round((k / (xTicks - 1)) * (points.length - 1)));

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let best = 0, bd = Infinity;
    points.forEach((_, i) => { const d = Math.abs(X(i) - mx); if (d < bd) { bd = d; best = i; } });
    setHover(best);
  };

  return (
    <div ref={wrap} style={{ position: 'relative', fontFamily: FONT }}>
      <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: 'block', overflow: 'visible' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth={1} />
            <text x={padL - 8} y={Y(t) + 4} fontSize={12} fill={TEXT_2} textAnchor="end" style={{ fontVariantNumeric: 'tabular-nums' }}>{format(t)}</text>
          </g>
        ))}
        <path d={area} fill={color} opacity={0.1} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => xLabelIdx.has(i) && (
          <text key={i} x={X(i)} y={height - 6} fontSize={12} fill={TEXT_2} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>{p.x}</text>
        ))}
        <circle cx={X(points.length - 1)} cy={Y(last.y)} r={4} fill={color} stroke={SURFACE} strokeWidth={2} />
        <text x={X(points.length - 1) + 8} y={Y(last.y) + 4} fontSize={13} fontWeight={700} fill={TEXT}>{format(last.y)}</text>
        {hover != null && (
          <g>
            <line x1={X(hover)} x2={X(hover)} y1={padT} y2={padT + ih} stroke={AXIS} strokeWidth={1} />
            <circle cx={X(hover)} cy={Y(points[hover].y)} r={5} fill={color} stroke={SURFACE} strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover != null && (
        <div style={{ position: 'absolute', left: Math.min(X(hover) + 10, w - 130), top: Math.max(0, Y(points[hover].y) - 44), background: SURFACE, border: `1px solid ${GRID}`, borderRadius: 8, boxShadow: '0 4px 20px rgba(0,28,36,0.15)', padding: '6px 10px', fontSize: 13, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          <div style={{ color: TEXT_2 }}>{points[hover].x} 那周</div>
          <div style={{ fontWeight: 700, color: TEXT }}>{format(points[hover].y)}</div>
        </div>
      )}
    </div>
  );
}
