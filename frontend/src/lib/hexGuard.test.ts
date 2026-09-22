/**
 * 硬编码色值的守卫（KAN-49）。**这份允许名单就是给 KAN-45 的移交清单。**
 *
 * 规则：`frontend/src` 里的 hex 字面只能出现在名单里的文件。名单每一项都要写明
 * 「为什么它可以有」，写不出理由的就是该清理的。KAN-45 做完把 `待清理` 那一组删空。
 *
 * 只看代码不看注释——审计注释里会引用色值（如「原先是 #d91515」），那是说明不是用法。
 * 跑法：node --test --experimental-strip-types（Node 22 内置）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(import.meta.dirname, '..');

/** 合理保留：每一条都有理由，KAN-45 也不用动。 */
const KEEP: Record<string, string> = {
  'components/charts/palette.ts':
    'tok(令牌名, 兜底值) 的第二参数。JS 导出是 var(--x, fallback) 字符串，兜底永不生效，'
    + '只在令牌名拼错时才会暴露（审计 #A20）',
  'theme.ts':
    '冷灰页底与深色值，是主题覆盖本身的真值来源（审计 #A17，KAN-63 改冷灰）',
  'components/ReviewTag.tsx':
    '评审黄圆标。按既有约定组件保留、字母不变，本票只把它改成默认关（审计 #A07）',
  'lib/role.ts':
    'TIER_FALLBACK 是后端 /api/meta 契约的镜像。colorOf() 只服务默认关的角色色圈开关，'
    + '日常使用不消费它（审计 #A09、#A23，KAN-64）',
  'components/charts/SegmentTrack.tsx': '图表内部的 #fff 描边，charts/ 不在清理范围',
  'components/charts/StackedBar.tsx': '图表内部的 #fff 文字色，charts/ 不在清理范围',
};

/** 待清理：KAN-45 的待办。做完了就从这里删掉，测试会自动开始拦。 */
const TODO_KAN45: Record<string, string> = {
  'components/CoverImage.tsx': '内联 SVG 占位图 7 处中性灰 → 令牌（审计 #A24）',
  'pages/Dashboard.tsx': ':422 照片占位底 #e9ecef → 令牌（审计 #A06）',
  'pages/project/FilesTab.tsx': ':73 缩略图占位底 #e9ecef → 令牌',
};

const ALLOWED = new Set([...Object.keys(KEEP), ...Object.keys(TODO_KAN45)]);

const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;

/** 粗粒度剔注释就够了：我们只需要把「说明里引用的色值」和「真在用的色值」分开。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (_m, p1: string) => p1);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

test('硬编码色值只出现在允许名单里的文件', () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split('\\').join('/');
    const hits = stripComments(readFileSync(file, 'utf8')).match(HEX);
    if (hits && !ALLOWED.has(rel)) offenders.push(`${rel}: ${[...new Set(hits)].join(' ')}`);
  }
  assert.deepEqual(offenders, [],
    '出现了名单外的硬编码色值。要么改成令牌，要么把文件加进 KEEP 并写明理由');
});

test('名单不留空壳：列进去的文件必须真的还有色值', () => {
  // 名单只减不增才有意义。KAN-45 清完一个文件就要从 TODO_KAN45 删掉，
  // 否则名单会慢慢变成一张谁也不敢动的白名单。
  const stale: string[] = [];
  for (const rel of ALLOWED) {
    let src: string;
    try { src = readFileSync(join(SRC, rel), 'utf8'); } catch { stale.push(`${rel}（文件不存在）`); continue; }
    if (!stripComments(src).match(HEX)) stale.push(`${rel}（已经没有色值了，从名单里删掉）`);
  }
  assert.deepEqual(stale, []);
});

test('移交给 KAN-45 的清单是这三个文件', () => {
  assert.deepEqual(Object.keys(TODO_KAN45).sort(), [
    'components/CoverImage.tsx',
    'pages/Dashboard.tsx',
    'pages/project/FilesTab.tsx',
  ]);
});
