import { getActor } from '../lib/actor.ts';
import { sourceNote } from './sourceNotes.ts';
import { newLine } from '../lib/purchaseOrders.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { messages } from './resources.ts';
import { m, setLanguage, language, systemText, messageFromCode } from './core.ts';
import { readLanguage, saveLanguage } from './preferences.ts';
import { localizedMetadata } from './systemLabels.ts';
import { materialName, taskTitle } from './templateNames.ts';
import { eventText } from './taskDisplay.ts';
import { dateStr, dateTime, money } from '../lib/format.ts';
import templates from './catalog/templates.json' with { type: 'json' };

test('all bundled messages have two nonempty languages and identical named parameters', () => {
  const parameters = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).sort();
  for (const [key, pair] of Object.entries(messages)) {
    assert.equal(pair.length, 2, key);
    assert.ok(pair.every(s => typeof s === 'string' && s.trim()), key);
    assert.deepEqual(parameters(pair[0]), parameters(pair[1]), key);
    if (key.endsWith('_one')) assert.ok(key.replace(/_one$/, '_other') in messages, key);
  }
});
test('language switches offline, handles singular/plural and does not interpolate HTML', () => {
  setLanguage('en');
  assert.equal(m('counts.items', { count: 1 }), '1 item');
  assert.equal(m('counts.items', { count: 2 }), '2 items');
  assert.equal(m('event.assigned', { person: '<b>名字</b>' }), 'Assigned to <b>名字</b>');
  setLanguage('zh-CN'); assert.equal(m('counts.items', { count: 2 }), '2 项');
});
test('storage access/read/write failures do not stop in-session language changes', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } as unknown as Storage;
  assert.equal(readLanguage(blocked), 'zh-CN');
  assert.doesNotThrow(() => saveLanguage('en', blocked));
  setLanguage('en'); assert.equal(language(), 'en');
  setLanguage('zh-CN');
});
test('metadata object identity and permission values stay fixed; display changes live', () => {
  const raw = { roles: [{ code: '采购', label: '采购' }], permissions: { '采购': ['procurement'] }, budget_categories: ['油漆'] };
  const snapshot = JSON.stringify(raw), view = localizedMetadata(raw), roles = view.roles;
  setLanguage('en'); assert.equal(view.roles, roles); assert.equal(roles[0].code, '采购'); assert.notEqual(roles[0].label, '采购');
  assert.deepEqual(view.permissions['采购'], ['procurement']); assert.equal(view.budget_categories[0], '油漆');
  setLanguage('zh-CN'); assert.equal(view.roles, roles); assert.equal(roles[0].label, '采购'); assert.equal(JSON.stringify(raw), snapshot);
});
test('template display requires reliable provenance and never overwrites manual or legacy names', () => {
  setLanguage('en');
  for (const [key, pair] of Object.entries(templates)) {
    const p = { template_key: key, template_name_snapshot: pair[0] };
    assert.equal(materialName({ ...p, name: pair[0] }), pair[1]);
    assert.equal(taskTitle({ ...p, title: pair[0] }), pair[1]);
    assert.equal(materialName({ ...p, name: '人工自填 SKU-100' }), '人工自填 SKU-100');
    assert.equal(materialName({ name: pair[0] }), pair[0]);
  }
  setLanguage('zh-CN');
});
test('structured events translate actions while names, reasons and audit originals remain exact', () => {
  const e = { id: 1, task_id: 1, project_id: 1, kind: 'reassigned', kind_label: '改派', actor: null, actor_role_snapshot: null, before: { assignee_user_id: 2 }, after: { assignee_user_id: 3 }, participant_names: { '2': '王先生', '3': 'ACME 人员' }, reason: '员工原文 36 in / $12.34', created_at: '2026-09-30', text: '历史原文' };
  const snapshot = JSON.stringify(e); setLanguage('en');
  assert.equal(eventText(e), 'Reassigned from 王先生 to ACME 人员: 员工原文 36 in / $12.34');
  assert.equal(eventText({ ...e, kind: 'legacy_unknown' }), '历史原文');
  assert.equal(JSON.stringify(e), snapshot); setLanguage('zh-CN');
});
test('date-only facts keep their calendar day and currency/precision stay USD', () => {
  setLanguage('en'); assert.equal(dateStr('2026-01-01'), 'Jan 1, 2026');
  assert.match(dateTime('2026-01-01T00:15:00'), /Jan 1, 2026 00:15/);
  assert.match(dateTime('2026-01-01T00:15:00Z'), /Dec 31, 2025/);
  assert.equal(money(null), '—'); assert.equal(money(0, 2), '$0.00'); assert.equal(money(1234.56, 2), '$1,234.56');
  setLanguage('zh-CN'); assert.equal(dateStr('2026-01-01'), '2026/01/01'); assert.match(money(1234.56, 2), /1,234.56/);
});
test('system message compatibility resolves codes and preserves unrecognized original details', () => {
  setLanguage('en'); assert.equal(messageFromCode('validation.required', {}, '必填'), 'Required');
  assert.equal(messageFromCode('unknown', {}, 'SKU AB-9 员工原文'), 'SKU AB-9 员工原文');
  assert.equal(systemText('负责人'), 'Project lead');
  setLanguage('zh-CN');
});

test('new order defaults and draft facts do not depend on language', () => {
  setLanguage('zh-CN'); const zh = newLine(42);
  setLanguage('en'); const en = newLine(42);
  assert.deepEqual({ ...zh, id: '' }, { ...en, id: '' });
  assert.equal(en.unit, '件');
  assert.equal(systemText('4 项'), '4 items');
  setLanguage('zh-CN');
});

test('role default remains a permission code, and source notes require provenance', () => {
  setLanguage('en'); assert.equal(getActor(), '负责人');
  assert.equal(sourceNote({note:'来自项目的买入价'}), '来自项目的买入价');
  assert.notEqual(sourceNote({note:'来自项目的买入价',note_template_snapshot:'来自项目的买入价'}), '来自项目的买入价');
  assert.equal(sourceNote({note:'人工修改',note_template_snapshot:'来自项目的买入价'}), '人工修改');
  setLanguage('zh-CN');
});

test('order template aliases preserve manual line names and saved matching values', async () => {
  const { orderLineName } = await import('./templateNames.ts');
  const [key, pair] = Object.entries(templates)[0];
  const material = { id: 1, name: pair[0], template_key: key, template_name_snapshot: pair[0] };
  const line = { name: pair[0], material_id: 1 }; const original = JSON.stringify(line);
  setLanguage('en'); assert.equal(orderLineName(line, [material]), pair[1]);
  assert.equal(orderLineName({ ...line, name: '人工选型 SKU-9' }, [material]), '人工选型 SKU-9');
  assert.equal(JSON.stringify(line), original); setLanguage('zh-CN');
});

test('template search matches both languages without changing the active filter or raw unit', async () => {
  const { materialSearchText } = await import('./templateNames.ts');
  const [key, pair] = Object.entries(templates)[0];
  const row = { name: pair[0], template_key: key, template_name_snapshot: pair[0] };
  setLanguage('en'); const english = materialSearchText(row);
  setLanguage('zh-CN'); assert.equal(materialSearchText(row), english);
  assert.ok(english.includes(pair[0]) && english.includes(pair[1]));
  assert.equal(materialSearchText({ ...row, name: '人工改名' }), '人工改名');
});

test('legacy system order envelopes translate without interpreting employee content', async () => {
  const {projectUpdateText} = await import('./taskDisplay.ts');
  setLanguage('en');
  assert.equal(projectUpdateText({kind:'procurement',text:'王先生 建立订单：ACME 品牌 SKU-53'}),'王先生 created order: ACME 品牌 SKU-53');
  assert.equal(projectUpdateText({kind:'procurement',text:'人工备注原文'}),'人工备注原文');
  assert.equal(projectUpdateText({kind:'unknown',text:'王先生 建立订单：ACME'}),'王先生 建立订单：ACME');
  setLanguage('zh-CN');
});
