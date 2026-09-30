import { m } from './core.ts';
import templates from './catalog/templates.json' with { type: 'json' };
type Provenance = { template_key?: string | null; template_name_snapshot?: string | null };
function display(raw: string, row: Provenance): string {
  const key = row.template_key;
  if (!key || !(key in templates) || raw !== row.template_name_snapshot) return raw;
  return m(key as keyof typeof templates);
}
/** Old rows without provenance and custom names retain their original text. */
export function materialName(row: Provenance & { name: string }): string { return display(row.name, row); }
export function taskTitle(row: Provenance & { title: string }): string { return display(row.title, row); }

export function analysisName(row: { name: string; inputs: { name_template?: { snapshot: string; tier: string; version: number } } }): string {
  const source = row.inputs.name_template;
  if (!source || row.name !== source.snapshot) return row.name;
  const tier = source.tier === 'light' ? m('analysisTab.light.renovation') : source.tier === 'heavy' ? m('analysisTab.heavy.renovation') : m('analysisTab.medium.renovation');
  return m('analysisTemplate.version', { tier, version: source.version });
}

/** Linked template aliases are display-only; import matching and saved order names stay raw. */
export function orderLineName(line: { name: string; material_id?: number | null } | undefined, materials: (Provenance & { id: number; name: string })[]): string {
  if (!line) return '';
  const source = materials.find(item => item.id === line.material_id);
  return source && line.name === source.template_name_snapshot ? display(line.name, source) : line.name;
}

/** Search both template aliases in either locale, so a live filter does not lose matches. */
export function materialSearchText(row: Provenance & { name: string }): string {
  const pair = row.template_key && row.name === row.template_name_snapshot ? templates[row.template_key as keyof typeof templates] : undefined;
  return [row.name, ...(pair ?? [])].join(' ');
}
