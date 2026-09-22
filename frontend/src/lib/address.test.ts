import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeLabel, toCandidate, validateManualAddress } from './address.ts';

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
