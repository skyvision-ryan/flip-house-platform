import { test } from 'node:test';
import assert from 'node:assert/strict';
import { employeeColorKey, employeeColorKeys, employeeColors } from './employeeColors.ts';

test('员工身份色固定到内部 ID；七个连续账号各有一种颜色', () => {
  assert.equal(new Set(Array.from({ length: 7 }, (_, i) => employeeColorKey(i + 1))).size, 7);
  assert.equal(employeeColorKey(15), employeeColorKey(15));
});

test('每种员工底色与白色首字母的对比度至少 4.5:1', () => {
  for (const key of employeeColorKeys) {
    const channels = employeeColors[key].slice(1).match(/../g)!.map(v => parseInt(v, 16) / 255)
      .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    assert(1.05 / (luminance + 0.05) >= 4.5, key);
  }
});
