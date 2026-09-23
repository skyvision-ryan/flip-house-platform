import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSources, summaryText } from './sourceSummary.ts';
import { sourceLabel } from './sources.ts';

const label = (v: string) => sourceLabel(v);

const f = (field: string, value: string, source: string, confidence: number | null = null) => ({ field, label: field, value, source, confidence });

test('只数有值的字段，按来源分组', () => {
  const s = summarizeSources([f('sqft', '1200', 'demo'), f('beds', '3', 'demo'), f('apn', '', 'demo'), f('style', 'ranch', 'manual', 1)]);
  assert.equal(s.filled, 3);
  assert.deepEqual(s.bySource, [{ source: 'demo', count: 2 }, { source: 'manual', count: 1 }]);
});

test('把握度低只看真有把握度的非人工字段——演示数据把握度为空，不算低', () => {
  const s = summarizeSources([
    f('a', '1', 'demo', null),
    f('b', '1', 'public_record', 0.7),
    f('c', '1', 'manual', 0.1),
    f('d', '1', 'public_record', 0.95),
    f('e', '', 'public_record', 0.1),
  ]);
  assert.deepEqual(s.lowConf.map((x) => x.field), ['b']);
});

test('文案按数据拼，不再写死「来源均为公共记录」', () => {
  const s = summarizeSources([f('sqft', '1200', 'demo'), f('beds', '3', 'demo'), f('style', 'ranch', 'manual', 1)]);
  assert.equal(summaryText(s, label), '已补全 3 项，来源：演示数据 2 项、人工 1 项。');
  assert.equal(summaryText(s, (v) => sourceLabel(v, [{ value: 'demo', label: '演示' }])), '已补全 3 项，来源：演示 2 项、人工 1 项。');
  assert.equal(summaryText(s), '已补全 3 项，来源：demo 2 项、manual 1 项。', '不传标签函数就露原始码，不猜');
});

test('有把握度低的字段就点名', () => {
  const s = summarizeSources([{ field: 'b', label: '卧室', value: '3', source: 'public_record', confidence: 0.7 }]);
  assert.equal(summaryText(s, label), '已补全 1 项，来源：公共记录 1 项。其中 1 项把握度低（卧室），建议核对。');
});

test('一项都没填就说没填——手动路径进第二步时的状态', () => {
  assert.equal(summaryText(summarizeSources([f('sqft', '', 'manual')])), '还没有任何房产数据。');
});
