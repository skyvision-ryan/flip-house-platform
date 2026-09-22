import { SERIES, STATUS, SURFACE, TEXT_2, TEXT } from './palette';

export interface ExtraMarker { at: number; label?: string }
interface Props {
  actual: number;
  target: number;
  /** 本组共用的刻度尺最大值；整个组件宽度 = scaleMax */
  scaleMax: number;
  height?: number;
  warnAt?: number;
  /** 底槛末端刻度下方的小字（如“预算”“完工”），不传则不写 */
  targetLabel?: string;
  /** 额外刻度（如 70% 法则） */
  markers?: ExtraMarker[];
}

/** 经典子弹图：灰色底槛 = 目标；彩色条 = 实际；超出目标的那段单独画红，长度就是超了多少。 */
export const TRACK_GREY = `color-mix(in srgb, ${STATUS.neutral} 22%, ${SURFACE})`;

export default function BudgetBar({ actual, target, scaleMax, height = 10, warnAt = 0.9, targetLabel, markers = [] }: Props) {
  const S = scaleMax > 0 ? scaleMax : Math.max(actual, target, 1);
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / S) * 100))}%`;
  const ratio = target > 0 ? actual / target : null;
  const within = Math.min(actual, target);
  const over = Math.max(0, actual - target);
  const baseColor = ratio == null ? SERIES[0] : ratio >= warnAt && ratio <= 1 ? STATUS.warning : SERIES[0];
  const labelSpace = targetLabel || markers.some((m) => m.label) ? 14 : 0;
  const r = height / 2;

  /**
   * 刻度标签的水平对齐。默认以刻度为中心，但刻度贴着两端时，居中会让一半字画到
   * 组件外面——工期条的目标就在右端，实测「完工」和「本段齐」各有一半跑出去、
   * 在两根条中间叠成一团。靠边就朝内对齐，字留在自己的条里。
   */
  const labelShift = (v: number) => {
    const at = S > 0 ? (v / S) * 100 : 0;
    if (at > 85) return 'translateX(-100%)';   // 贴右端：右对齐
    if (at < 15) return 'translateX(0)';       // 贴左端：左对齐
    return 'translateX(-50%)';
  };

  return (
    <div style={{ position: 'relative', height: height + labelSpace, width: '100%' }}>
      {/* 底槛 = 目标 */}
      {target > 0 && <div style={{ position: 'absolute', left: 0, top: 0, height, width: pct(target), background: TRACK_GREY, borderRadius: r }} />}
      {/* 实际（目标内） */}
      {within > 0 && <div style={{ position: 'absolute', left: 0, top: 0, height, width: pct(within), background: baseColor, borderRadius: over > 0 ? `${r}px 0 0 ${r}px` : r }} />}
      {/* 超出段 */}
      {over > 0 && (
        <div style={{ position: 'absolute', left: `calc(${pct(target)} + 2px)`, top: 0, height, width: `calc(${pct(actual)} - ${pct(target)} - 2px)`, background: STATUS.serious, borderRadius: `0 ${r}px ${r}px 0` }} />
      )}
      {/* 目标刻度 */}
      {target > 0 && (
        <div style={{ position: 'absolute', left: pct(target), top: -2, transform: 'translateX(-1px)', textAlign: 'center' }}>
          <div style={{ width: 2, height: height + 4, background: TEXT, borderRadius: 1 }} />
          {targetLabel && <div style={{ fontSize: 10, color: TEXT_2, whiteSpace: 'nowrap', transform: labelShift(target), marginLeft: 1, marginTop: 1 }}>{targetLabel}</div>}
        </div>
      )}
      {markers.map((m, i) => (
        <div key={i} style={{ position: 'absolute', left: pct(m.at), top: 0, transform: 'translateX(-1px)', textAlign: 'center' }}>
          <div style={{ width: 2, height, background: TEXT_2, opacity: 0.7, borderRadius: 1 }} />
          {m.label && <div style={{ fontSize: 10, color: TEXT_2, whiteSpace: 'nowrap', transform: labelShift(m.at), marginLeft: 1, marginTop: 3 }}>{m.label}</div>}
        </div>
      ))}
    </div>
  );
}
