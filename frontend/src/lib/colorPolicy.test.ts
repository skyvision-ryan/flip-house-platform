/**
 * colorPolicy 的规则测试（KAN-49）。全部离线、不碰 DOM、不碰网络。
 * 跑法：node --test --experimental-strip-types（Node 22 内置，零新依赖）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseColor, rgbToHsl, toHex, isNeutral, hueBucket, classify, summarize, tokensFor,
  type Sample, type TokenIndex,
} from './colorPolicy.ts';

/** 取自 @cloudscape-design/design-tokens 3.0.112 的 index-visual-refresh.json，light 值。 */
const INDEX: TokenIndex = {
  'color-text-status-error': '#db0000',
  'color-text-status-success': '#00802f',
  'color-text-status-warning': '#855900',
  'color-text-status-info': '#006ce0',
  'color-background-status-error': '#fff5f5',
  'color-charts-status-high': '#ba2e0f',
  'color-charts-palette-categorical-1': '#688ae8',
  'color-charts-palette-categorical-2': '#c33d69',
  'color-text-link-default': '#006ce0',
  'color-text-body-default': '#0f141a',
};

const sample = (value: string): Sample => ({ path: 'div', prop: 'color', value });

test('三种颜色格式都要认得', () => {
  assert.deepEqual(parseColor('rgb(9, 114, 211)'), { r: 9, g: 114, b: 211 });
  assert.deepEqual(parseColor('rgba(0, 0, 0, 0.15)'), { r: 0, g: 0, b: 0 });
  // palette.ts 的 track() 用 color-mix()，算出来是这个格式
  assert.deepEqual(parseColor('color(srgb 1 0.5 0)'), { r: 255, g: 128, b: 0 });
  assert.equal(parseColor('none'), null);
});

test('hex 往返不丢值', () => {
  assert.equal(toHex({ r: 219, g: 0, b: 0 }), '#db0000');
  assert.deepEqual(parseColor('#db0000'), { r: 219, g: 0, b: 0 });
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255 });
});

test('中性判据：阈值落在实测出来的空档里', () => {
  // 中性侧（2026-09-21 实测的最高几个）
  assert.ok(isNeutral(rgbToHsl({ r: 141, g: 153, b: 168 })), '#8d99a8 s=13.4%');
  assert.ok(isNeutral(rgbToHsl({ r: 233, g: 236, b: 239 })), '#e9ecef s=15.8%');
  assert.ok(isNeutral(rgbToHsl({ r: 247, g: 245, b: 241 })), '#F7F5F1 s=27.3% 但 L=95.7%，暖白');
  assert.ok(isNeutral(rgbToHsl({ r: 15, g: 20, b: 26 })), '#0f141a s=26.8% 但 L=8%，Cloudscape 的正文近黑');
  assert.ok(isNeutral(rgbToHsl({ r: 255, g: 255, b: 255 })), '纯白');
  assert.ok(isNeutral(rgbToHsl({ r: 0, g: 0, b: 0 })), '纯黑');

  // 违规侧（实测最低的那个也远在阈值之上）
  assert.ok(!isNeutral(rgbToHsl({ r: 104, g: 138, b: 232 })), '#688AE8 s=73.6%，违规侧最低');
  assert.ok(!isNeutral(rgbToHsl({ r: 252, g: 204, b: 10 })), '#FCCC0A 评审黄 s=97.6%');
  assert.ok(!isNeutral(rgbToHsl({ r: 122, g: 62, b: 232 })), '#7A3EE8 tier 紫 s=78.7%');
});

test('色相分桶：0° 与 359° 分属不同桶，这是分桶的已知性质', () => {
  assert.equal(hueBucket(0), 0);
  assert.equal(hueBucket(359), 11);
  assert.equal(hueBucket(29.9), 0);
  assert.equal(hueBucket(30), 1);
  assert.equal(hueBucket(-1), 11, '负角度要归一化');
});

test('令牌真值漂移：代码里抄的旧值命不中当前令牌', () => {
  // 这条测试锁住 KAN-49 审计的核心证据。Dashboard 里手写的是旧版值，
  // 令牌早就换了；不收敛就判不出状态色。
  assert.deepEqual(tokensFor({ r: 217, g: 21, b: 21 }, INDEX), [], '#d91515 是旧 error，命不中');
  assert.deepEqual(tokensFor({ r: 3, g: 127, b: 12 }, INDEX), [], '#037f0c 是旧 success，命不中');
  assert.deepEqual(tokensFor({ r: 141, g: 102, b: 5 }, INDEX), [], '#8d6605 是旧 warning，命不中');
  assert.deepEqual(tokensFor({ r: 9, g: 114, b: 211 }, INDEX), [], '#0972d3 是旧 info，命不中');

  assert.deepEqual(tokensFor({ r: 219, g: 0, b: 0 }, INDEX), ['color-text-status-error']);
  assert.deepEqual(tokensFor({ r: 0, g: 128, b: 47 }, INDEX), ['color-text-status-success']);
});

test('分类只看值命中哪个令牌，不看 DOM', () => {
  assert.equal(classify(sample('rgb(219, 0, 0)'), INDEX), 'status-token');
  assert.equal(classify(sample('rgb(0, 128, 47)'), INDEX), 'status-token',
    'StatusIndicator 的绿本就精确等于 status-success，不需要 DOM 标记');
  assert.equal(classify(sample('rgb(0, 108, 224)'), INDEX), 'status-token',
    '#006ce0 同时是 status-info 与 link-default，状态令牌优先');
  assert.equal(classify(sample('rgb(252, 204, 10)'), INDEX), 'offending', '评审黄不表任何状态');
  assert.equal(classify(sample('rgb(122, 62, 232)'), INDEX), 'offending', 'tier 紫编码的是身份');
  assert.equal(classify(sample('rgb(9, 114, 211)'), INDEX), 'offending', '旧蓝命不中令牌，算违规候选');
  assert.equal(classify(sample('rgb(141, 153, 168)'), INDEX), 'neutral');
});

test('图表 data-vis 色单列，不计入指标也不算违规', () => {
  assert.equal(classify(sample('rgb(104, 138, 232)'), INDEX), 'charts-token', '#688ae8 系列 1');
  assert.equal(classify(sample('rgb(195, 61, 105)'), INDEX), 'charts-token', '#c33d69 系列 2');
  assert.equal(classify(sample('rgb(186, 46, 15)'), INDEX), 'status-token',
    'charts-status-high 两边都匹配，状态优先');
});

test('指标：非状态色相数只数 interaction 与 offending', () => {
  const s = summarize([
    sample('rgb(219, 0, 0)'),        // status-token，不计
    sample('rgb(255, 255, 255)'),    // neutral，不计
    sample('rgb(252, 204, 10)'),     // offending 黄 → 1 桶
    sample('rgb(9, 114, 211)'),      // offending 蓝 → 1 桶
    sample('rgb(122, 62, 232)'),     // offending 紫 → 1 桶
    sample('rgb(104, 138, 232)'),    // charts-token，单列不计
  ], INDEX);

  assert.equal(s.total, 6);
  assert.equal(s.byClass.offending, 3);
  assert.equal(s.byClass['charts-token'], 1);
  assert.equal(s.nonStatusHues.length, 3, '黄、蓝、紫三个色相');
  assert.deepEqual(s.nonStatusColors, ['#0972d3', '#7a3ee8', '#fccc0a']);
  assert.deepEqual(s.chartsColors, ['#688ae8']);
});

test('目标态：改完只剩状态色与中性时，非状态色相数归零', () => {
  const s = summarize([
    sample('rgb(0, 108, 224)'),
    sample('rgb(219, 0, 0)'),
    sample('rgb(255, 255, 255)'),
    sample('rgb(141, 153, 168)'),
  ], INDEX);
  assert.equal(s.nonStatusHues.length, 0, '全部是状态色或中性');
});
