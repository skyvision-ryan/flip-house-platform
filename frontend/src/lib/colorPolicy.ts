/**
 * 颜色纪律的判定规则（KAN-49）。纯函数、不碰 DOM，所以能单测。
 * 采集在 scripts/ui_color_scan.js（跑在页面里，没法单测，那边一行判断都不放）。
 *
 * 判定要机械、可复算，不能靠「看着挺花的」。整套规则只有一句话：
 * **颜色只有表示状态时才准出现；其余非中性色都是违规候选。**
 *
 * 这个模块不被 App 任何地方 import，不进产物 bundle，只服务审计与测试。
 */

/**
 * 分类**只看颜色值命中了哪个 Cloudscape 令牌**，不看 DOM 祖先。
 *
 * 一开始想靠祖先类名区分「在 StatusIndicator 里」和「我们自己上的色」，实测走不通：
 * 页面上压根没有 status-indicator 类名，手写图表所在的 div 也没有任何类名或 data 属性。
 * 但实测同时给了更好的办法——StatusIndicator 的颜色本就精确等于 `color-text-status-*`
 * 的值，图表色等于 `color-charts-*` 的值。按值反查令牌既不依赖 DOM，也就没有
 * 「这块算不准、留给人工核」的缺口。
 */
export type Classification =
  | 'neutral'       // 中性：灰、近白、近黑。不计入色相
  | 'status-token'  // 命中状态令牌：颜色在表示好/坏/注意，这正是我们要留的
  | 'charts-token'  // 命中 data-vis 令牌：官方图表配色体系，图表另有长度/形状通道
  | 'interaction'   // 链接、主按钮等交互色
  | 'offending';    // 其余非中性色 = 违规候选

export interface Sample {
  path: string;
  prop: string;
  value: string;
}

export interface Rgb { r: number; g: number; b: number }
export interface Hsl { h: number; s: number; l: number }

/**
 * 解析 getComputedStyle 吐出来的颜色。三种格式都要认：
 * `rgb(9, 114, 211)`、`rgba(0, 0, 0, 0.15)`，以及 color-mix() 产生的
 * `color(srgb 0.952627 0.963294 0.992784)`（palette.ts 的 track() 会走这条）。
 */
export function parseColor(value: string): Rgb | null {
  const text = value.trim().toLowerCase();

  const srgb = text.match(/^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (srgb) {
    return {
      r: Math.round(parseFloat(srgb[1]) * 255),
      g: Math.round(parseFloat(srgb[2]) * 255),
      b: Math.round(parseFloat(srgb[3]) * 255),
    };
  }

  const rgb = text.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
    if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
    return { r: parts[0], g: parts[1], b: parts[2] };
  }

  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  return null;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

export function toHex({ r, g, b }: Rgb): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/**
 * 中性判据。阈值是这套指标里唯一带主观性的地方，所以不拍脑袋，按实测定。
 *
 * 2026-09-21 量了两边（design-tokens 3.0.112 的 light 值 + 我们代码里的硬编码色）：
 *
 *   中性侧最高饱和度  27.3%  #F7F5F1  旧页底，只用来钉中性亮度兜底
 *                     26.8%  #0f141a  Cloudscape 的 color-text-body-default（近黑）
 *                     15.8%  #e9ecef  占位底
 *                     13.4%  #8d99a8  次要文字灰蓝
 *   违规侧最低饱和度  73.6%  #688AE8  图表系列蓝
 *                     78.7%  #7A3EE8  tier 紫
 *                     97.6%  #FCCC0A  评审黄
 *
 * 中间隔着 46 个百分点，阈值取 35% 落在空档中央，两侧都有大余量。
 * 亮度两端另设兜底：近黑的 `#0f141a`（L=8%）和暖白 `#F7F5F1`（L=95.7%）饱和度都偏高，
 * 但人眼读不出色相，靠亮度判它们中性。
 * 改这三个数就是改验收口径，要同步改审计文档里的方法一节。
 */
export const NEUTRAL_SATURATION = 0.35;
export const NEUTRAL_LIGHT = 0.93;
export const NEUTRAL_DARK = 0.12;

export function isNeutral(hsl: Hsl): boolean {
  return hsl.s < NEUTRAL_SATURATION || hsl.l > NEUTRAL_LIGHT || hsl.l < NEUTRAL_DARK;
}

/**
 * 色相分桶：12 桶，每桶 30°。
 * 已知性质：0° 与 359° 分属不同桶（桶 0 与桶 11），红色跨桶边界。
 * 这不是缺陷，是分桶必然——写进文档而不是掩盖。指标看的是「有几种可辨识色相」，
 * 红色系即便跨两桶也说明确实有两种偏色的红，正是要报出来的。
 */
export const HUE_BUCKET_SIZE = 30;
export function hueBucket(h: number): number {
  return Math.floor(((h % 360) + 360) % 360 / HUE_BUCKET_SIZE);
}

/** 令牌索引：令牌名 → light 值的 hex（小写）。由 ui_color_report 从 design-tokens 的 JSON 构建。 */
export type TokenIndex = Record<string, string>;

const STATUS_TOKEN = /^color-(text|background|border)-status-|^color-charts-status-/;
const CHARTS_TOKEN = /^color-charts-/;
const INTERACTION_TOKEN = /^color-text-link-|^color-background-button-primary-|^color-text-accent$|focus/;

/** 反查一个颜色命中了哪些令牌名。命中多个时全部返回，便于审计表写「同值多令牌」。 */
export function tokensFor(rgb: Rgb, index: TokenIndex): string[] {
  const hex = toHex(rgb);
  return Object.keys(index).filter((name) => index[name].toLowerCase() === hex);
}

export function classify(sample: Sample, index: TokenIndex): Classification {
  const rgb = parseColor(sample.value);
  if (!rgb) return 'neutral';               // 解析不了的当中性，宁可漏报不误报
  if (isNeutral(rgbToHsl(rgb))) return 'neutral';

  const names = tokensFor(rgb, index);
  // 顺序有讲究：状态令牌优先于图表令牌（charts-status-* 两边都匹配，算状态），
  // 图表令牌优先于交互（data-vis 蓝阶里有和链接蓝同值的）。
  if (names.some((n) => STATUS_TOKEN.test(n))) return 'status-token';
  if (names.some((n) => CHARTS_TOKEN.test(n))) return 'charts-token';
  if (names.some((n) => INTERACTION_TOKEN.test(n))) return 'interaction';
  return 'offending';
}

/**
 * 一屏的指标。**非状态色色相数 = interaction ∪ offending 去重后的色相桶个数。**
 *
 * 交互蓝不豁免，但它天然只占 1 桶。这个数要**按讲解开关的状态分档看**——
 * 界面有两个默认关的讲解开关（评审标注 #A07、角色色圈 #A09），各自会带进自己的色相。
 * 下面是**上限**，不是实测值：一屏出不出现交互蓝、某个 tier 的负责人在不在场，都看路由，
 * 所以实测只会低于或等于这几个数。验收看的是「有没有超」。
 *
 *   两个都关（默认）  ≤ 1 桶   Cloudscape 交互蓝
 *   只开评审标注      ≤ 2 桶   + 评审黄
 *   只开角色色圈      ≤ 4 桶   + tier 紫、青、蓝（灰是中性，不进桶）
 *   两个都开          ≤ 5 桶   以上全部
 *
 * KAN-64 实测（`/projects/1?tab=overview` @2240、身份「负责人」，
 * 结果见 docs/reference/ui-audit-2026-09-21/kan64/）：0 / 1 / 1 / 2。
 * 两处比上限低：该屏没有交互蓝；tier 蓝 #0972D3 与 tier 青 #0E8A8A **同属 6 号桶**，
 * 四种 tier 色并不等于四个色相。
 *
 * **要紧的是默认态仍然只可能是交互蓝那一桶。** KAN-49 判 #A07 / #A09「违反」，
 * 针对的是那些颜色默认常亮、且是唯一通道的用法；放在显式的、默认关的开关后面不在此列。
 * 日常使用一个都不出现，讲解时才点开——这两件事不矛盾。
 *
 * 改这张表就是改验收口径，要同步改 docs/界面风格与AWS对照.md 第 3 节。
 */
export interface ScanSummary {
  total: number;
  byClass: Record<Classification, number>;
  nonStatusHues: number[];
  nonStatusColors: string[];
  /** 图表 data-vis 色单列：官方体系、图表另有图形通道，不计入指标，但要看得见。 */
  chartsColors: string[];
}

export function summarize(samples: Sample[], index: TokenIndex): ScanSummary {
  const byClass: Record<Classification, number> = {
    neutral: 0, 'status-token': 0, 'charts-token': 0, interaction: 0, offending: 0,
  };
  const hues = new Set<number>();
  const colors = new Set<string>();
  const charts = new Set<string>();

  for (const sample of samples) {
    const cls = classify(sample, index);
    byClass[cls] += 1;
    const rgb = parseColor(sample.value);
    if (!rgb) continue;
    if (cls === 'charts-token') { charts.add(toHex(rgb)); continue; }
    if (cls === 'interaction' || cls === 'offending') {
      hues.add(hueBucket(rgbToHsl(rgb).h));
      colors.add(toHex(rgb));
    }
  }

  return {
    total: samples.length,
    byClass,
    nonStatusHues: [...hues].sort((a, b) => a - b),
    nonStatusColors: [...colors].sort(),
    chartsColors: [...charts].sort(),
  };
}
