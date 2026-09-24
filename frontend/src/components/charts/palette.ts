// 图表配色：只用 Cloudscape 设计令牌（CSS 变量），不自造颜色。
// 规则：分类系列固定顺序取 1–5；状态色只表示好坏；有序数据用蓝色阶；文字用文本色令牌。
import * as T from '@cloudscape-design/design-tokens';


/** 分类系列（顺序固定，不按排名重新上色）。已用色盲可辨性脚本验证前 7 位。 */
export const SERIES = [
  T.colorChartsPaletteCategorical1,
  T.colorChartsPaletteCategorical2,
  T.colorChartsPaletteCategorical3,
  T.colorChartsPaletteCategorical4,
  T.colorChartsPaletteCategorical5,
  T.colorChartsPaletteCategorical6,
  T.colorChartsPaletteCategorical7,
];

/** 状态色：只在颜色表示“好 / 注意 / 超限”时使用。 */
export const STATUS = {
  good: T.colorChartsStatusPositive,
  warning: T.colorChartsStatusMedium,
  serious: T.colorChartsStatusHigh,
  critical: T.colorChartsStatusCritical,
  neutral: T.colorChartsStatusNeutral,
};

/** 有序（漏斗、档位）用一色渐深。 */
export const ORDINAL_BLUE = [
  T.colorChartsBlue1400,
  T.colorChartsBlue1500,
  T.colorChartsBlue1600,
  T.colorChartsBlue1700,
  T.colorChartsBlue1800,
  T.colorChartsBlue1900,
];

export const GRID = T.colorChartsLineGrid;
export const AXIS = T.colorChartsLineAxis;
export const TEXT_INVERTED = T.colorTextNotificationDefault;
export const TEXT = T.colorTextBodyDefault;
export const TEXT_2 = T.colorTextBodySecondary;
export const TEXT_GOOD = T.colorTextStatusSuccess;
export const TEXT_BAD = T.colorTextStatusError;
export const TEXT_WARN = T.colorTextStatusWarning;
export const SURFACE = T.colorBackgroundContainerContent;
export const BORDER = T.colorBorderDividerDefault;
export const SHADOW = T.shadowCard;
export const FONT = T.fontFamilyBase;

/** 轨道 = 同色更浅一档（用 color-mix，避免自造颜色）。 */
export const track = (color: string, pctOfColor = 16) => `color-mix(in srgb, ${color} ${pctOfColor}%, ${SURFACE})`;

/** 按“实际 / 目标”比例给严重度颜色：正常用系列蓝，接近上限橙，超限红。 */
export function severityColor(ratio: number | null | undefined, warnAt = 0.9, overAt = 1.0): string {
  if (ratio == null || !Number.isFinite(ratio)) return SERIES[0];
  if (ratio > overAt) return STATUS.serious;
  if (ratio >= warnAt) return STATUS.warning;
  return SERIES[0];
}
