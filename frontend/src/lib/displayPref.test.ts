import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HELP_PREF_KEY, readHelpPref, writeHelpPref } from './displayPref.ts';
import { REVIEW_PREF_KEY, readReviewPref, writeReviewPref } from './reviewPref.ts';

function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
test('辅助说明与编号独立持久化，四种组合互不覆盖', () => {
  const s = storage();
  assert.equal(readHelpPref(s), false);
  assert.equal(readReviewPref(s), false);
  assert.notEqual(HELP_PREF_KEY, REVIEW_PREF_KEY);
  for (const [help, review] of [[true, false], [false, true], [true, true], [false, false]]) {
    writeHelpPref(s, help); writeReviewPref(s, review);
    assert.equal(readHelpPref(s), help); assert.equal(readReviewPref(s), review);
  }
});
test('辅助说明只接受明确的 on，损坏或禁用存储时安全关闭', () => {
  const s = storage();
  for (const value of ['yes', '', 'false']) { s.setItem(HELP_PREF_KEY, value); assert.equal(readHelpPref(s), false); }
  const blocked = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } };
  assert.equal(readHelpPref(blocked), false);
  assert.doesNotThrow(() => writeHelpPref(blocked, true));
});
