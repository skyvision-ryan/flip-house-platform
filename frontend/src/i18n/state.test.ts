import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, useState, useEffect } from 'react';
// @ts-expect-error Test-only React 18 renderer has no bundled types.
import { create, act } from 'react-test-renderer';
import { useLanguage } from './languageStore.ts';
import { setLanguage, m } from './core.ts';

test('the real language subscription rerenders without remount, draft reset or business effect replay', () => {
  let mounts = 0, requests = 0, edit: (v: typeof draft) => void = () => {};
  const draft = { project: 2, tab: 'orders', filter: 'pending', amount: '1234.56', person: 7, note: '员工草稿 SKU-53', expanded: true, modal: true };
  function Form() {
    useLanguage();
    const [value, setValue] = useState(draft); edit = setValue;
    useEffect(() => { mounts++; }, []);
    useEffect(() => { requests++; }, [value.project]);
    return createElement('form', { 'data-value': value }, m('settings.title'));
  }
  setLanguage('zh-CN'); let tree: ReturnType<typeof create>;
  act(() => { tree = create(createElement(Form)); });
  const edited = { ...draft, amount: '980.05', person: 9, note: '未保存 ACME 36 in' };
  act(() => edit(edited));
  for (const locale of ['en','zh-CN','en'] as const) {
    act(() => setLanguage(locale));
    assert.equal(tree!.root.findByType('form').props['data-value'], edited);
    assert.equal(tree!.root.findByType('form').children[0], locale === 'en' ? 'Display settings' : '显示设置');
  }
  assert.equal(mounts, 1); assert.equal(requests, 1);
  act(() => tree!.unmount()); setLanguage('zh-CN');
});
