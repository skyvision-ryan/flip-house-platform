import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { messages } from './resources.ts';
import { scanSource, validateResources, type Exception } from './checks.ts';
const root = join(import.meta.dirname, '..');
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !e.name.endsWith('.test.ts') ? [join(dir, e.name)] : []);
// Exact sink + file + text; one occurrence each, never a file/directory exemption.
const exceptions: Exception[] = [
  ...['中文', 'English'].map(text => ({ file: 'components/DisplaySettings.tsx', rule: 'visible-literal', text, reason: 'Language selector must retain both self-names in either locale.' })),
  ...['· D', '/ J'].map(text => ({ file: 'components/design/DirectorDesign.tsx', rule: 'visible-literal', text, reason: 'Existing role identifiers, not display role names.' })),
  { file: 'pages/AddProject.tsx', rule: 'visible-literal', text: 'APN / AIN', reason: 'County parcel identifier abbreviations; glossary preserves them.' },
  { file: 'pages/DesignChoices.tsx', rule: 'visible-literal', text: 'Maple House', reason: 'Synthetic property identity, not a translatable title.' },
  { file: 'pages/DesignCollaboration.tsx', rule: 'visible-literal', text: 'DEMO-', reason: 'Synthetic account-number prefix.' },
  { file: 'pages/project/AnalysisTab.tsx', rule: 'visible-literal', text: '其他', reason: 'Persisted budget category default, displayed through catOptions; translating would change business data.' },
];
test('all display sinks, resource references and stable UI identities pass the bilingual contract', () => {
  const issues = files(root).flatMap(file => scanSource(readFileSync(file, 'utf8'), file, messages).map(issue => ({ file: relative(root, file), ...issue })));
  for (const e of exceptions) {
    assert.ok(e.reason.length > 20);
    const matches = issues.filter(i => i.file === e.file && i.rule === e.rule && i.text === e.text);
    assert.equal(matches.length, 1, `Stale/overbroad exception: ${JSON.stringify(e)}`);
    issues.splice(issues.indexOf(matches[0]), 1);
  }
  assert.deepEqual(issues, []);
});
test('each catalog is bundled once, keys cannot shadow each other, and structure/parameters/plurals match', () => {
  const keys = new Set<string>(), resourceSource = readFileSync(join(import.meta.dirname, 'resources.ts'), 'utf8');
  for (const name of readdirSync(join(import.meta.dirname, 'catalog')).filter(n => n.endsWith('.json'))) {
    assert.ok(resourceSource.includes(`'./catalog/${name}'`), `Unbundled catalog ${name}`);
    const catalog = JSON.parse(readFileSync(join(import.meta.dirname, 'catalog', name), 'utf8'));
    assert.deepEqual(validateResources(catalog), [], name);
    for (const [key, value] of Object.entries(catalog)) {
      assert.ok(!keys.has(key), `Duplicate key ${key}`); keys.add(key);
      assert.deepEqual(messages[key as keyof typeof messages], value, `Overwritten/unbundled ${key}`);
    }
  }
  assert.deepEqual(validateResources(messages), []);
});
test('temporary bad examples fail, corrected examples pass (Chinese and English, not Han-only)', () => {
  for (const bad of [{a:['中文']}, {a:['{{name}}','{{person}}']}, {a_one:['{{count}} 项','{{count}} item']}, {a:['','English']}, {a:'invalid'}, {a:['中文','a']}]) assert.ok(validateResources(bad).length);
  const good = { 'example.title':['标题','Title'], 'example.items_one':['{{count}} 项','{{count}} item'], 'example.items_other':['{{count}} 项','{{count}} items'] };
  assert.deepEqual(validateResources(good), []);
  for (const source of ['<Modal header="New dialog" />','<button>保存</button>','<Input ariaLabel="Email address" />','const x={i18nStrings:{loadingText:"Loading records"}}','<Notice description={"Try again"} />','setError("Could not save")','errors.lines = "Required item missing"','<Hint help="Choose a property" />','<p>example.title</p>','m("missing.key")','m("example.items")','m("example.items",{wrong:2})','<Input value={m("example.title")} />']) assert.ok(scanSource(source, 'fixture.tsx', good).length, source);
  assert.deepEqual(scanSource('// 中文 comment\nconst role="采购"; const x={value:"采购",label:m("example.title")}; <button>{m("example.items",{count:2})}</button>', 'fixture.tsx', good), []);
});
