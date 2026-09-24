import BudgetBar, { ExtraMarker } from './BudgetBar';
import { FONT, TEXT, TEXT_2, TEXT_BAD } from './palette';

interface Props {
  /** 实际值 */
  value: number;
  /** 目标 / 上限 */
  max: number;
  label?: string;
  reading?: string;
  /** 与 max 相等的标记作为目标刻度的名字；其他作为额外刻度 */
  markers?: ExtraMarker[];
  warnAt?: number;
  height?: number;
  note?: string;
  /** 目标刻度名，默认“目标” */
  targetLabel?: string;
}

/** 一个比例离上限多远：灰底 = 上限，彩条 = 实际，超出的那段画红。条永远按真实比例，不截断。 */
export default function Meter({ value, max, label, reading, markers = [], warnAt = 0.9, height = 10, note, targetLabel }: Props) {
  const over = max > 0 && value > max;
  const tl = targetLabel ?? markers.find((m) => Math.abs(m.at - max) < 1e-6)?.label ?? '目标';
  const extra = markers.filter((m) => Math.abs(m.at - max) >= 1e-6);
  const scaleMax = Math.max(value, max) || 1;
  return (
    <div style={{ fontFamily: FONT }}>
      {(label || reading) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: TEXT_2, marginBottom: 6, gap: 8 }}>
          <span>{label}</span>
          <span style={{ color: over ? TEXT_BAD : TEXT, fontWeight: 400, fontVariantNumeric: 'tabular-nums' }}>{reading}</span>
        </div>
      )}
      <BudgetBar actual={value} target={max} scaleMax={scaleMax} height={height} warnAt={warnAt} targetLabel={tl} markers={extra} />
      {note && <div style={{ fontSize: 13, color: over ? TEXT_BAD : TEXT_2, marginTop: 4 }}>{note}</div>}
    </div>
  );
}
