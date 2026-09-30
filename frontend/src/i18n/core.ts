import i18next from 'i18next';
import { messages, type MessageKey } from './resources.ts';
import { readLanguage, saveLanguage, type Language } from './preferences.ts';

export const i18n = i18next.createInstance();
const dictionary = (index: 0 | 1) => Object.fromEntries(Object.entries(messages).map(([key, pair]) => [key, pair[index]]));
void i18n.init({
  lng: readLanguage(), fallbackLng: 'zh-CN', supportedLngs: ['zh-CN', 'en'],
  resources: { 'zh-CN': { translation: dictionary(0) }, en: { translation: dictionary(1) } },
  keySeparator: false, interpolation: { escapeValue: false }, initAsync: false,
});
export function language(): Language { return i18n.language === 'en' ? 'en' : 'zh-CN'; }
export function setLanguage(next: Language): void { saveLanguage(next); void i18n.changeLanguage(next); }
type PluralKey = MessageKey extends infer K ? K extends `${infer Base}_one` ? Base : never : never;
export function m(key: MessageKey | PluralKey, params?: Record<string, string | number | null | undefined>): string { return String(i18n.t(key, params)); }
/** Only for system-owned labels returned by legacy APIs; never pass editable business content. */
const legacy = new Map<string, MessageKey>();
for (const [key, pair] of Object.entries(messages)) for (const value of pair) {
  if (!legacy.has(value)) legacy.set(value, key as MessageKey);
}
export function messageFromCode(code: unknown, params: unknown, fallback: string): string {
  if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(messages, code)) return systemText(fallback);
  return m(code as MessageKey, params && typeof params === 'object' ? params as Record<string, string | number> : undefined);
}
export function systemText(value: string | null | undefined): string;
export function systemText<T>(value: T): T;
export function systemText(value: unknown): any {
  if (typeof value !== "string") return value;
  if (!value) return value ?? '';
  const key = legacy.get(value);
  if (key) return m(key);
  for (const pattern of systemPatterns) {
    const match = pattern.expression.exec(value);
    if (match) {
      const params: Record<string, string | number> = Object.fromEntries(pattern.params.map((name, index) => [name, match[index + 1]]));
      if ('count' in params) params.count = Number(params.count);
      if (pattern.key === 'analysis.sourceRehab') params.tier = systemText(String(params.tier));
      const key = pattern.key.replace(/_(one|other)$/, '') as Parameters<typeof m>[0];
      return m(key, params);
    }
  }
  return value;
}

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Finite, reviewed system sentences only. Captured business values remain verbatim.
const systemPatterns = Object.entries(messages).flatMap(([key, pair]) => pair.flatMap(value => {
  if (!value.includes('{{')) return [];
  const params: string[] = [];
  const parts = value.split(/(\{\{\w+\}\})/g);
  return [{ key: key as MessageKey, params, expression: new RegExp('^' + parts.map(part => {
    const parameter = /^\{\{(\w+)\}\}$/.exec(part);
    if (parameter) { params.push(parameter[1]); return '([\\s\\S]*?)'; }
    return escapePattern(part);
  }).join('') + '$') }];
}));
