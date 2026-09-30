/** Shared by CI tests and check:i18n. Scans display sinks, not every string in source. */
import ts from 'typescript';
export type Issue = { line: number; rule: string; text: string };
export type Exception = { file: string; rule: string; text: string; reason: string };
const display = /^(label|text|header|title|description|help|hint|content|ariaLabel|aria-label|ariaDescription|alt|loadingText|emptyText|errorText|constraintText|placeholder|headerText|dismissAriaLabel|confirmButtonText|cancelButtonText)$/;
const words = /\p{L}/u;
// Language-neutral syntax examples; not a words/names blanket allowlist.
const syntax = /^(YYYY[/-]MM[/-]DD|https:\/\/(?:…)?|name@(?:example|company)\.com)$/;
export function validateResources(resources: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const params = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map(x => x[1]).sort().join(',');
  for (const [key, pair] of Object.entries(resources)) {
    if (!/^[a-zA-Z][\w.-]*$/.test(key) || !Array.isArray(pair) || pair.length !== 2 || pair.some(s => typeof s !== 'string' || !s.trim() || s === key)) { errors.push(`${key}: invalid bilingual pair`); continue; }
    if (params(pair[0]) !== params(pair[1])) errors.push(`${key}: parameter mismatch`);
    if (/_one$|_other$/.test(key)) {
      const other = key.replace(/_(one|other)$/, key.endsWith('_one') ? '_other' : '_one');
      if (!(other in resources)) errors.push(`${key}: missing plural sibling`);
      else if (Array.isArray(resources[other]) && params(pair[1]) !== params((resources[other] as string[])[1])) errors.push(`${key}: plural parameters differ`);
    }
  }
  return errors;
}
export function scanSource(source: string, filename: string, resources: Record<string, readonly string[]>): Issue[] {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Issue[] = [], aliases = new Set(['m', 'uiText']);
  const issue = (n: ts.Node, rule: string, text: string) => out.push({ line: tree.getLineAndCharacterOfPosition(n.getStart()).line + 1, rule, text });
  const literal = (n: ts.Node): string | undefined => ts.isStringLiteralLike(n) ? n.text : undefined;
  function visible(n: ts.Node) {
    const value = literal(n);
    if (value !== undefined) { if (words.test(value) && !syntax.test(value)) issue(n, 'visible-literal', value); return; }
    if (ts.isConditionalExpression(n)) { visible(n.whenTrue); visible(n.whenFalse); }
    else if (ts.isBinaryExpression(n)) { if (n.operatorToken.kind === ts.SyntaxKind.PlusToken || n.operatorToken.kind === ts.SyntaxKind.BarBarToken || n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) { visible(n.left); visible(n.right); } else if (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) visible(n.right); }
    else if (ts.isTemplateExpression(n)) for (const piece of [n.head, ...n.templateSpans.map(s => s.literal)]) if (words.test(piece.text)) issue(piece, 'visible-literal', piece.text);
  }
  function checkKey(n: ts.Node, params?: ts.Node) {
    if (ts.isConditionalExpression(n)) { checkKey(n.whenTrue, params); checkKey(n.whenFalse, params); return; }
    const key = literal(n); if (key === undefined) return; // Typed dynamic maps need the runtime/resource tests too.
    const pair = resources[key] ?? resources[`${key}_other`];
    if (!pair) { issue(n, 'unknown-key', key); return; }
    const required = [...new Set([...pair[0].matchAll(/\{\{(\w+)\}\}/g)].map(x => x[1]))];
    if (!params && required.length) issue(n, 'missing-params', key);
    if (params && ts.isObjectLiteralExpression(params) && !params.properties.some(ts.isSpreadAssignment)) {
      const supplied = params.properties.flatMap(p => p.name ? [p.name.getText(tree).replace(/^['"]|['"]$/g, '')] : []);
      if (required.some(p => !supplied.includes(p))) issue(n, 'missing-params', key);
    }
  }
  function visit(n: ts.Node) {
    if (ts.isImportSpecifier(n) && (n.propertyName?.text ?? n.name.text) === 'm') aliases.add(n.name.text);
    if (ts.isJsxText(n) && words.test(n.text.trim())) issue(n, 'visible-literal', n.text.trim());
    if (ts.isJsxExpression(n) && n.expression && !ts.isJsxAttribute(n.parent)) visible(n.expression);
    if (ts.isJsxAttribute(n) && n.initializer) {
      const key = n.name.getText(tree), text = n.initializer.getText(tree);
      if (display.test(key)) visible(ts.isJsxExpression(n.initializer) && n.initializer.expression ? n.initializer.expression : n.initializer);
      if (['value','defaultValue','checked','selectedId','key'].includes(key) && /\b(?:uiText|systemText|m|language)\(/.test(text)) issue(n, 'translated-state', key);
    }
    if (ts.isPropertyAssignment(n) && display.test(n.name.getText(tree))) visible(n.initializer);
    if (ts.isPropertyAssignment(n) && n.name.getText(tree) === 'cell' && ts.isArrowFunction(n.initializer) && !ts.isBlock(n.initializer.body)) visible(n.initializer.body);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && /^errors?(?:\.|\[)/.test(n.left.getText(tree))) visible(n.right);
    if (ts.isCallExpression(n)) {
      const fn = n.expression.getText(tree);
      if (aliases.has(fn) && n.arguments[0]) checkKey(n.arguments[0], n.arguments[1]);
      if (/^(alert|confirm|setError|setToast|setMessage|setSuccess)$/.test(fn) && n.arguments[0]) visible(n.arguments[0]);
      if (/^(setStatus|setFilter|setCategory|setHouseTab|setDetailTab|setStage)$/.test(fn) && n.arguments.some(a => /\b(?:uiText|systemText|m)\(/.test(a.getText(tree)))) issue(n, 'translated-state', fn);
    }
    if (ts.isJsxOpeningElement(n) && n.tagName.getText(tree) === 'option' && !n.attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText(tree) === 'value')) issue(n, 'option-value', 'option needs stable value');
    ts.forEachChild(n, visit);
  }
  visit(tree); return out;
}
