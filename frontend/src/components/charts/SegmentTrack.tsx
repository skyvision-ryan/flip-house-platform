import { FONT, ORDINAL_BLUE, SERIES, TEXT, TEXT_2, SURFACE, track } from './palette';

interface Seg { id: string; label: string; group?: string }
interface Props {
  segments: Seg[];
  currentIndex: number;
  /** 全部完成时传 true */
  complete?: boolean;
  height?: number;
}

/** 流程走到哪：按子阶段分段的轨道。已完成实色，当前高亮带圆点，未来浅色；段下标名。 */
export default function SegmentTrack({ segments, currentIndex, complete = false, height = 8 }: Props) {
  const done = ORDINAL_BLUE[4];
  const cur = SERIES[0];
  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ display: 'flex', gap: 3 }}>
        {segments.map((s, i) => {
          const state = complete || i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'future';
          const bg = state === 'done' ? done : state === 'current' ? cur : track(cur, 14);
          return (
            <div key={s.id} style={{ flex: 1, position: 'relative' }}>
              <div style={{ height, background: bg, borderRadius: i === 0 ? `${height / 2}px 0 0 ${height / 2}px` : i === segments.length - 1 ? `0 ${height / 2}px ${height / 2}px 0` : 0 }} />
              {state === 'current' && !complete && (
                <div style={{ position: 'absolute', left: '50%', top: height / 2, width: 14, height: 14, borderRadius: '50%', background: cur, border: `3px solid ${SURFACE}`, boxShadow: '0 0 0 1px ' + cur, transform: 'translate(-50%,-50%)' }} />
              )}
              <div style={{ marginTop: 8, fontSize: 12, textAlign: 'center', color: state === 'current' && !complete ? TEXT : TEXT_2, fontWeight: state === 'current' && !complete ? 700 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
