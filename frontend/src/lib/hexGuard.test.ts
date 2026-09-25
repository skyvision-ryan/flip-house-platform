/** 样式路径的回归门：随 check_local / CI 执行，不再豁免整份主题或旧页面。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { brandOverrides } from '../components/ui/brand.ts';
import { employeeColors } from '../components/ui/employeeColors.ts';

const SRC = join(import.meta.dirname, '..');
const BRAND_FILE = 'components/ui/brand.ts';
const RAW_COLOR = /#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b|\b(?:rgba?|hsla?|hwb|(?:ok)?l(?:ab|ch))\(\s*[-+.\d]|\bcolor\(\s*[a-z\d-]+\s+[-+.\d]/gi;
const WRAPPERS = new Set(['container', 'table', 'header', 'form-field', 'expandable-section', 'key-value-pairs']);
const WRAPPER_NAMES = new Set(['Container', 'Table', 'Header', 'FormField', 'ExpandableSection', 'KeyValuePairs']);

function violations(file: string, source: string): string[] {
  const errors: string[] = [];
  const ui = file.startsWith('components/ui/');
  const chart = file.startsWith('components/charts/');
  if (file.endsWith('.css')) {
    if (file !== 'styles.css' && !ui) errors.push('CSS 必须在 styles.css 或 components/ui');
    const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
    if (css.match(RAW_COLOR)) errors.push('CSS 硬编码颜色');
    // 颜色值必须来自令牌；透明/继承是 CSS 语义，不是另一套调色板。
    for (const [, property, value] of css.matchAll(/(?:^|[;{])\s*(color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|fill|stroke)\s*:\s*([^;}]+)/g)) {
      if (property.startsWith('border') && /^(?:[\d.]+(?:px|em|rem)?\s+)?(?:solid|dashed|dotted)(?:\s+(?:transparent|currentColor))?$/.test(value.trim())) continue;
      if (!/var\(/.test(value) && !/^(?:none|transparent|currentColor|inherit|initial|unset|revert|0)(?:\s*!important)?$/i.test(value.trim())) errors.push('CSS 颜色属性必须使用令牌');
    }
    if (/\.awsui_[\w-]+/.test(css)) errors.push('不可覆盖 Cloudscape 哈希类');
    return errors;
  }
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function checkModule(node: ts.Node, specifier: string) {
    if (!ui && specifier.startsWith('@cloudscape-design/components/')) {
      if (WRAPPERS.has(specifier.split('/')[2])) errors.push('卡片必须经过 UI 包装层');
    }
    if (!ui && specifier === '@cloudscape-design/components') {
      const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : ts.isExportDeclaration(node) ? node.exportClause : undefined;
      if (!bindings || ts.isNamespaceImport(bindings) || ts.isNamespaceExport(bindings)
        || bindings.elements.some(e => WRAPPER_NAMES.has((e.propertyName ?? e.name).text))) errors.push('不可通过 Cloudscape barrel 绕过包装层');
    }
    if (!ui && !chart && (specifier === '@cloudscape-design/design-tokens' || specifier.startsWith('@cloudscape-design/design-tokens/'))) errors.push('业务页面不直接定义样式令牌');
    if (specifier.includes('palette') && (!chart || ts.isExportDeclaration(node))) errors.push('palette 只供图表内部使用，不可转导出');
    if (/\.css$/.test(specifier)) {
      const target = relative(SRC, resolve(SRC, file, '..', specifier)).replaceAll('\\', '/');
      if (specifier.startsWith('.') && target !== 'styles.css' && !target.startsWith('components/ui/')) errors.push('CSS 引用绕过 UI 层');
    }
  }
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const module = node.moduleSpecifier;
      if (module && ts.isStringLiteral(module)) checkModule(node, module.text);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(tree) === 'require')) {
      const specifier = node.arguments[0];
      if (specifier && ts.isStringLiteral(specifier)) checkModule(node, specifier.text);
    }
    if (!ui && !chart && file.endsWith('.tsx') && ts.isPropertyAssignment(node) && node.name.getText(tree).replace(/['"]/g, '') === 'style') errors.push('业务对象不可携带 style 绕过包装层');
    if (!ui && !chart && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && /\.style(?:\.|\[|$)/.test(node.left.getText(tree))) errors.push('业务代码不可直接写 DOM 样式');
    if (!ui && !chart && ts.isCallExpression(node) && /\.style\.(?:setProperty|removeProperty)$/.test(node.expression.getText(tree))) errors.push('业务代码不可直接写 DOM 样式');
    if (!ui && !chart && ts.isJsxAttribute(node) && node.name.getText(tree) === 'style') errors.push('业务 JSX 样式应移到 UI 包装层或 styles.css');
    if (!ui && !chart && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(tree) === 'style') errors.push('不在业务 JSX 中注入 CSS');
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (node.text.match(RAW_COLOR)) {
        const parent = node.parent;
        const name = ts.isPropertyAssignment(parent) ? parent.name.getText(tree) : '';
        const allowedBrand = file === BRAND_FILE && ts.isPropertyAssignment(parent)
          && Object.hasOwn(brandOverrides, name) && brandOverrides[name as keyof typeof brandOverrides] === node.text;
        const allowedEmployee = file === 'components/ui/employeeColors.ts' && ts.isPropertyAssignment(parent)
          && Object.hasOwn(employeeColors, name) && employeeColors[name as keyof typeof employeeColors] === node.text;
        if (!allowedBrand && !allowedEmployee) errors.push(`硬编码颜色：${node.text.slice(0, 65)}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return errors;
}
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : /\.(tsx?|css)$/.test(e.name) && !/\.(test|fixtures)\.ts$/.test(e.name) ? [join(dir, e.name)] : []);
}

test('全站样式遵循唯一 UI 路径和官方令牌', () => {
  const found = files(SRC).flatMap(path => {
    const file = relative(SRC, path).replaceAll('\\', '/');
    return violations(file, readFileSync(path, 'utf8')).map(error => `${file}: ${error}`);
  });
  assert.deepEqual(found, [], '修复样式来源，不要扩充文件白名单。');
});

test('品牌例外只限已授权的九个主按钮令牌，禁止顺手扩大主题', () => {
  assert.deepEqual(brandOverrides, {
    colorBackgroundButtonPrimaryDefault: '#ff9900', colorBackgroundButtonPrimaryHover: '#ec8b00', colorBackgroundButtonPrimaryActive: '#d97f00',
    colorBorderButtonPrimaryDefault: '#c67600', colorBorderButtonPrimaryHover: '#b96d00', colorBorderButtonPrimaryActive: '#a66000',
    colorTextButtonPrimaryDefault: '#161d26', colorTextButtonPrimaryHover: '#161d26', colorTextButtonPrimaryActive: '#161d26',
  });
  assert.equal(violations(BRAND_FILE, "const unrelated = '#ff9900'").length, 1);
});

test('员工颜色例外只限已授权的七种头像底色与字色', () => {
  assert.deepEqual(employeeColors, {
    navy: '#00205B', green: '#005C5D', red: '#D40000', purple: '#6F2C91',
    sapphire: '#0057B8', burgundy: '#8B1E3F', bronze: '#80551C', foreground: '#FFFFFF',
  });
  assert(violations('components/ui/employeeColors.ts', "const unrelated = '#00205B'").length);
  assert(violations('pages/x.tsx', "const navy = '#00205B'").length);
});

test('守卫覆盖 alpha hex、CSS、RGB/HSL 和模板字符串，忽略注释', () => {
  for (const value of ['#fff', '#ffff', '#123456', '#12345678', 'rgb(1 2 3)', 'rgba(0,0,0,.2)', 'hsl(20 30% 40%)', 'color(srgb 1 0 0)']) {
    assert(violations('components/ui/example.tsx', `const color = '${value}'`).length, value);
    assert(violations('styles.css', `.x { color: ${value}; }`).length, value);
  }
  assert(violations('components/ui/example.tsx', 'const s = `1px solid #fff ${width}`').length);
  assert(violations('styles.css', '.x { color: rebeccapurple; background: white; }').length);
  assert.deepEqual(violations('styles.css', '/* #fff */ .x { color: var(--ui-text); }'), []);
  assert.deepEqual(violations('pages/x.tsx', '// #fff\n const route = "https://example.com";'), []);
});

test('守卫拒绝直接、barrel、转导出和动态导入绕路', () => {
  for (const source of [
    "import C from '@cloudscape-design/components/container';",
    "import { Header as H } from '@cloudscape-design/components';",
    "export { Table } from '@cloudscape-design/components';",
    "const C = import('@cloudscape-design/components/container');",
    "import { BORDER } from '../components/charts/palette';",
    "import './local.css';",
    "import * as T from '@cloudscape-design/design-tokens/index.js';",
    "const props = { style: { borderRadius: 40 } }; const node = <div {...props}/>;",
    "document.body.style.fontFamily = 'Georgia';",
    'const node = <div style={{ color: token }} />;',
  ]) assert(violations('pages/x.tsx', source).length, source);
  assert(violations('components/charts/index.ts', "export * from './palette'").length);
  assert.deepEqual(violations('pages/x.tsx', "import C from '../components/ui/Surface'; const a = <C cardId='project-header' />;"), []);
  assert.deepEqual(violations('components/ui/x.tsx', 'const a = <div style={{ width }} />;'), []);
  assert.deepEqual(violations('components/charts/x.tsx', "import { TEXT } from './palette'; const a = <svg style={{ width }} />;"), []);
});
