import { useLanguage } from '../../i18n/LanguageProvider';
import { FONT, TEXT_2, TEXT_BAD, TEXT_GOOD } from './palette';

interface Props {
  /** 百分比偏差，正数表示高于基准 */
  pct: number | null | undefined;
  /** 高于基准是好事吗（售价高于目标 = 好；支出高于预算 = 差） */
  goodWhenPositive: boolean;
  digits?: number;
  /** 偏差绝对值小于此视为持平（灰色） */
  flatBelow?: number;
}

/** 偏差是正是负：带方向箭头与颜色的百分比。绿 = 好，红 = 差；语义由调用方定义。 */
export default function DeltaBadge({ pct, goodWhenPositive, digits = 1, flatBelow = 0.05 }: Props) {
  useLanguage();
  if (pct == null || !Number.isFinite(pct)) return <span style={{ color: TEXT_2 }}>—</span>;
  const flat = Math.abs(pct) < flatBelow;
  const good = goodWhenPositive ? pct > 0 : pct < 0;
  const color = flat ? TEXT_2 : good ? TEXT_GOOD : TEXT_BAD;
  const arrow = flat ? '■' : pct > 0 ? '▲' : '▼';
  return (
    <span style={{ fontFamily: FONT, color, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {arrow} {pct > 0 ? '+' : ''}{pct.toFixed(digits)}%
    </span>
  );
}
