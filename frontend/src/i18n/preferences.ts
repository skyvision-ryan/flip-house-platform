export type Language = 'zh-CN' | 'en';
export const LANGUAGE_PREF_KEY = 'display.language.v1';
export function deviceStorage(): Storage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; }
}
export function readLanguage(storage = deviceStorage()): Language {
  try { return storage?.getItem(LANGUAGE_PREF_KEY) === 'en' ? 'en' : 'zh-CN'; } catch { return 'zh-CN'; }
}
export function saveLanguage(language: Language, storage = deviceStorage()): void {
  try { storage?.setItem(LANGUAGE_PREF_KEY, language); } catch { /* The in-memory selection still applies. */ }
}
