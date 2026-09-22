import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_SOURCE_LABELS, isProvisionalSource, sourceLabel } from './sources.ts';

test('词表优先：后端给的标签盖过内置表', () => {
  assert.equal(sourceLabel('demo', [{ value: 'demo', label: '演示（后端）' }]), '演示（后端）');
});

test('词表没加载或没这一项时回落内置表', () => {
  assert.equal(sourceLabel('demo'), '演示数据');
  assert.equal(sourceLabel('unverified', null), '待核实');
  assert.equal(sourceLabel('public_record', [{ value: 'manual', label: '人工' }]), '公共记录');
});

test('两边都没有就原样返回，不猜', () => {
  assert.equal(sourceLabel('rentcast'), 'rentcast');
});

test('空值显示「—」', () => {
  assert.equal(sourceLabel(null), '—');
  assert.equal(sourceLabel(''), '—');
});

test('内置表覆盖后端词表现有的每一档', () => {
  // dictionaries.SOURCES 的 value 列表；后端加档要同步这里，否则词表没加载时会露出原始码
  for (const v of ['manual', 'public_record', 'lark', 'model', 'ai', 'demo', 'unverified']) assert.ok(BUILTIN_SOURCE_LABELS[v], v);
});

test('演示数据与待核实是要单独提醒的两档', () => {
  assert.equal(isProvisionalSource('demo'), true);
  assert.equal(isProvisionalSource('unverified'), true);
  assert.equal(isProvisionalSource('manual'), false);
  assert.equal(isProvisionalSource('public_record'), false);
  assert.equal(isProvisionalSource(null), false);
});
