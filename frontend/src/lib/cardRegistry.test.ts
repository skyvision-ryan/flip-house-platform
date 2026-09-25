import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_REGISTRY, cardFeedback } from './cardRegistry.ts';

test('反馈编号在 1–99 内且不重复，已发布的核心定位不可漂移', () => {
  const values = Object.values(CARD_REGISTRY);
  assert(values.every(({ id }) => Number.isInteger(id) && id >= 1 && id <= 99));
  assert.equal(new Set(values.map(({ id }) => id)).size, values.length);
  assert.equal(CARD_REGISTRY['task-summary'].id, 8);
  assert.equal(CARD_REGISTRY['task-table'].id, 10);
  assert.equal(CARD_REGISTRY['project-list'].id, 27);
  assert.equal(CARD_REGISTRY['project-header'].id, 65);
});
test('同一组件在不同房屋和筛选页的反馈可以准确区分', () => {
  const a = cardFeedback('my-task-card', '/todo', '?task=11', 'LA 示例房 · 看房');
  const b = cardFeedback('my-task-card', '/todo', '?task=12', 'OC 示例房 · 看房');
  assert.match(a, /卡片 #92/);
  assert.match(a, /对象：LA 示例房 · 看房/);
  assert.match(a, /位置：\/todo\?task=11/);
  assert.match(a, /组件：my-task-card/);
  assert.notEqual(a, b);
  assert(!cardFeedback('project-list', '/projects', '').includes('undefined'));
});
