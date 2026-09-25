import BudgetBar from './BudgetBar';
import { FONT, TEXT, TEXT_BAD } from './palette';

interface Props {
  value: number;
  /** 本列共用的刻度尺最大值（所有行的 max(实际, 目标) 的最大值） */
  max: number;
  /** 有目标时：灰底 = 目标，超出画红 */
  target?: number;
  text?: string;
  width?: number;
}

/** 表格单元格里的“实际 vs 目标”小条，与页面上的大条同一套画法。 */
export default function InlineBar({ value, max, target, text, width = 150 }: Props) {
  const over = target != null && target > 0 && value > target;
  const scale = Math.max(max, target ?? 0, value) || 1;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontFamily: FONT, fontSize: 13, color: over ? TEXT_BAD : TEXT }}>
      <span style={{ width, display: 'inline-block', flexShrink: 0 }}>
        <BudgetBar actual={value} target={target ?? 0} scaleMax={scale} height={8} />
      </span>
      <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: over ? 700 : 400 }}>{text}</span>
    </span>
  );
}
