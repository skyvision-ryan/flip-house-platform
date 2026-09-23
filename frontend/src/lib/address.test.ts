import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeLabel, shouldClearAmounts, toCandidate, validateManualAddress } from './address.ts';

test('四段齐全按「街道, 城市, 州 邮编」拼', () => {
  assert.equal(composeLabel({ street: '12 Main St', city: 'Parkville', state: 'MO', zip: '64152' }), '12 Main St, Parkville, MO 64152');
});

test('缺段就跳过，不留悬空逗号或空格', () => {
  assert.equal(composeLabel({ street: '12 Main St', city: '', state: 'MO', zip: '' }), '12 Main St, MO');
  assert.equal(composeLabel({ street: '12 Main St', city: 'Parkville', state: '', zip: '' }), '12 Main St, Parkville');
  assert.equal(composeLabel({ street: '12 Main St', city: '', state: '', zip: '64152' }), '12 Main St, 64152');
  assert.equal(composeLabel({ street: ' 12 Main St ', city: '', state: '', zip: '' }), '12 Main St');
});

test('只有街道是必填——后端五个字段 "" 都合法', () => {
  assert.deepEqual(validateManualAddress({ street: '12 Main St', city: '', state: '', zip: '' }), []);
  assert.deepEqual(validateManualAddress({ street: '   ', city: 'Parkville', state: 'MO', zip: '64152' }), ['street']);
});

test('转候选时去空白、经纬度不猜', () => {
  const c = toCandidate({ street: ' 12 Main St ', city: 'Parkville ', state: 'mo', zip: '' });
  assert.deepEqual(c, { label: '12 Main St, Parkville, mo', street: '12 Main St', city: 'Parkville', state: 'mo', zip: '', lat: null, lng: null });
});

// ---- shouldClearAmounts ----

const filled = { purchase_price: '300000', target_arv: '' };
const empty = { purchase_price: '', target_arv: '' };

test('切换到另一套房且已填金额 → 清', () => {
  assert.equal(shouldClearAmounts('A St, X', 'B St, Y', filled), true);
  assert.equal(shouldClearAmounts('A St, X', 'B St, Y', { purchase_price: '', target_arv: '435000' }), true);
});

test('同一套房重选（地址文字修正后再选回来）→ 不清', () => {
  assert.equal(shouldClearAmounts('A St, X', 'A St, X', filled), false);
});

test('第一次选房、或金额本来就空 → 不清', () => {
  assert.equal(shouldClearAmounts(null, 'A St, X', filled), false);
  assert.equal(shouldClearAmounts(undefined, 'A St, X', filled), false);
  assert.equal(shouldClearAmounts('A St, X', 'B St, Y', empty), false);
});
