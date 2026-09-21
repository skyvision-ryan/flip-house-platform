/**
 * reviewPref 的测试（KAN-49，审计 #A07）。
 * 这是本票唯一真正改了语义的地方：缺 key 时从「开」变成「关」，所以单独锁一遍。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readReviewPref, writeReviewPref, REVIEW_PREF_KEY } from './reviewPref.ts';

/** 注入式假 storage，不依赖浏览器。 */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = v; },
  };
}

test('没设置过就是关——这是本票改掉的那条语义', () => {
  assert.equal(readReviewPref(fakeStorage()), false);
});

test("只认显式的 'on'", () => {
  assert.equal(readReviewPref(fakeStorage({ [REVIEW_PREF_KEY]: 'on' })), true);
  assert.equal(readReviewPref(fakeStorage({ [REVIEW_PREF_KEY]: 'off' })), false);
  // 旧版本写进去的、或被人手改过的怪值，一律当关，不当成「不是 off 就是开」
  assert.equal(readReviewPref(fakeStorage({ [REVIEW_PREF_KEY]: 'yes' })), false);
  assert.equal(readReviewPref(fakeStorage({ [REVIEW_PREF_KEY]: '' })), false);
});

test('读不到 storage（隐私模式）也不能崩，按关处理', () => {
  const hostile = { getItem: () => { throw new Error('SecurityError'); } };
  assert.equal(readReviewPref(hostile), false);
});

test('写入写的是 on / off 两个字面值', () => {
  const s = fakeStorage();
  writeReviewPref(s, true);
  assert.equal(s.data[REVIEW_PREF_KEY], 'on');
  writeReviewPref(s, false);
  assert.equal(s.data[REVIEW_PREF_KEY], 'off');
});

test('写不进去也不能崩', () => {
  const hostile = { setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.doesNotThrow(() => writeReviewPref(hostile, true));
});

test('写完再读回来是同一个值', () => {
  const s = fakeStorage();
  for (const v of [true, false, true]) {
    writeReviewPref(s, v);
    assert.equal(readReviewPref(s), v);
  }
});
