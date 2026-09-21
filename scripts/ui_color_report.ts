/**
 * 把 ui_color_scan.js 采到的色值，用 colorPolicy 的规则算成一份汇总（KAN-49）。
 *
 * 这里是薄胶水：建令牌索引 + 读扫描结果 + 渲染表格。所有判断都在
 * frontend/src/lib/colorPolicy.ts，那边有单测；这里一行规则都不重写。
 *
 * 跑法（Node 22 内置类型剥离，零新依赖）：
 *   node --experimental-strip-types scripts/ui_color_report.ts <扫描结果目录>
 *
 * 扫描结果是 ui_color_scan.js 输出的 digest：{route, innerWidth, colors:[{value,n}...]}。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classify, parseColor, rgbToHsl, toHex, hueBucket,
  type Classification, type TokenIndex,
} from '../frontend/src/lib/colorPolicy.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS_JSON = join(HERE, '..', 'frontend', 'node_modules',
  '@cloudscape-design', 'design-tokens', 'index-visual-refresh.json');

/** 令牌名 → light 值。深色模式本仓没有入口，只取 light。 */
export function buildTokenIndex(path = TOKENS_JSON): TokenIndex {
  const doc = JSON.parse(readFileSync(path, 'utf8')) as {
    tokens: Record<string, { $value?: unknown }>;
  };
  const index: TokenIndex = {};
  for (const [name, def] of Object.entries(doc.tokens)) {
    const value = def?.$value;
    const light = typeof value === 'string' ? value
      : (value && typeof value === 'object' && 'light' in value
        ? (value as { light?: unknown }).light : undefined);
    if (typeof light === 'string' && light.startsWith('#')) index[name] = light.toLowerCase();
  }
  return index;
}

interface Digest {
  route: string;
  innerWidth: number;
  scrollWidth: number;
  clientWidth: number;
  actor: string | null;
  reviewTags: string | null;
  bodyFontFamily: string;
  sampleCount: number;
  colors: { value: string; n: number; eg?: string }[];
}

const CLASSES: Classification[] = ['neutral', 'status-token', 'charts-token', 'interaction', 'offending'];

function report(digest: Digest, index: TokenIndex) {
  const byClass = Object.fromEntries(CLASSES.map((c) => [c, 0])) as Record<Classification, number>;
  const hues = new Map<number, Set<string>>();
  const offenders: { hex: string; n: number; eg?: string }[] = [];
  const charts = new Set<string>();

  for (const c of digest.colors) {
    const cls = classify({ path: c.eg ?? '', prop: '', value: c.value }, index);
    byClass[cls] += c.n;
    const rgb = parseColor(c.value);
    if (!rgb) continue;
    const hex = toHex(rgb);
    if (cls === 'charts-token') charts.add(hex);
    if (cls === 'interaction' || cls === 'offending') {
      const b = hueBucket(rgbToHsl(rgb).h);
      if (!hues.has(b)) hues.set(b, new Set());
      hues.get(b)!.add(hex);
      if (cls === 'offending') offenders.push({ hex, n: c.n, eg: c.eg });
    }
  }
  return { byClass, hues, offenders: offenders.sort((a, b) => b.n - a.n), charts: [...charts].sort() };
}

function main() {
  const dir = process.argv[2];
  if (!dir) { console.error('用法：node --experimental-strip-types scripts/ui_color_report.ts <扫描结果目录>'); process.exit(2); }
  const index = buildTokenIndex();
  const files = readdirSync(dir).filter((f) => f.startsWith('scan-') && f.endsWith('.json')).sort();
  if (!files.length) { console.error(`${dir} 里没有 scan-*.json`); process.exit(2); }

  console.log(`# 一屏可辨识色相统计\n`);
  console.log(`令牌索引：${Object.keys(index).length} 条（design-tokens 的 light 值）\n`);
  console.log('| 路由 | 宽度 | 样本 | 中性 | 状态色 | 图表色 | 交互 | 违规 | **非状态色相数** | 页面级横向滚动 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');

  const detail: string[] = [];
  for (const f of files) {
    const d = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Digest;
    const r = report(d, index);
    const overflow = d.scrollWidth > d.clientWidth ? `**有**（${d.scrollWidth}>${d.clientWidth}）` : '无';
    console.log(`| \`${d.route}\` | ${d.innerWidth} | ${d.sampleCount} | ${r.byClass.neutral} | `
      + `${r.byClass['status-token']} | ${r.byClass['charts-token']} | ${r.byClass.interaction} | `
      + `${r.byClass.offending} | **${r.hues.size}** | ${overflow} |`);

    if (r.offenders.length) {
      detail.push(`\n### \`${d.route}\` @ ${d.innerWidth}px 的违规候选\n`);
      detail.push('| 色值 | 出现次数 | 色相桶 | 示例元素 |');
      detail.push('|---|---|---|---|');
      for (const o of r.offenders) {
        const rgb = parseColor(o.hex)!;
        detail.push(`| \`${o.hex}\` | ${o.n} | ${hueBucket(rgbToHsl(rgb).h)} | \`${(o.eg ?? '').slice(0, 60)}\` |`);
      }
      if (r.charts.length) detail.push(`\n图表 data-vis 色（官方体系，不计入指标）：${r.charts.map((c) => `\`${c}\``).join('、')}`);
    }
  }
  console.log(detail.join('\n'));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) main();
