/**
 * rolePref 的测试（KAN-64，审计 #A09）。全部离线、不碰 DOM。
 * 跑法：node --test --experimental-strip-types（Node 22 内置，零新依赖）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRolePref, writeRolePref, ROLE_PREF_KEY } from './rolePref.ts';
import { REVIEW_PREF_KEY } from './reviewPref.ts';

/** 注入式假 storage，不依赖浏览器。 */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = v; },
  };
}

test('没设置过就是关', () => {
  assert.equal(readRolePref(fakeStorage()), false);
});

test("只认显式的 'on'", () => {
  assert.equal(readRolePref(fakeStorage({ [ROLE_PREF_KEY]: 'on' })), true);
  assert.equal(readRolePref(fakeStorage({ [ROLE_PREF_KEY]: 'off' })), false);
  assert.equal(readRolePref(fakeStorage({ [ROLE_PREF_KEY]: 'yes' })), false);
  assert.equal(readRolePref(fakeStorage({ [ROLE_PREF_KEY]: '' })), false);
});

test('读不到 storage（隐私模式）也不能崩，按关处理', () => {
  const hostile = { getItem: () => { throw new Error('SecurityError'); } };
  assert.equal(readRolePref(hostile), false);
});

test('写入写的是 on / off 两个字面值', () => {
  const s = fakeStorage();
  writeRolePref(s, true);
  assert.equal(s.data[ROLE_PREF_KEY], 'on');
  writeRolePref(s, false);
  assert.equal(s.data[ROLE_PREF_KEY], 'off');
});

test('写不进去也不能崩', () => {
  const hostile = { setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.doesNotThrow(() => writeRolePref(hostile, true));
});

test('写完再读回来是同一个值', () => {
  const s = fakeStorage();
  for (const v of [true, false, true]) {
    writeRolePref(s, v);
    assert.equal(readRolePref(s), v);
  }
});

test('两个开关互不干扰——这是本票的核心要求', () => {
  // 共用一个键就没法「只开其中一个」，所以键必须不同，而且写一个不能动另一个。
  assert.notEqual(ROLE_PREF_KEY, REVIEW_PREF_KEY);

  const s = fakeStorage({ [REVIEW_PREF_KEY]: 'on' });
  writeRolePref(s, false);
  assert.equal(s.data[REVIEW_PREF_KEY], 'on', '关角色色圈不应该把评审标注一起关掉');
  assert.equal(readRolePref(s), false);

  writeRolePref(s, true);
  assert.equal(s.data[ROLE_PREF_KEY], 'on');
  assert.equal(s.data[REVIEW_PREF_KEY], 'on', '两个键各自独立');
});
