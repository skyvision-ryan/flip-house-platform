import { useSyncExternalStore } from 'react';
import { i18n, language } from './core.ts';
import type { Language } from './preferences.ts';
const subscribe = (changed: () => void) => {
  i18n.on('languageChanged', changed);
  return () => { i18n.off('languageChanged', changed); };
};
/** Render only; never put locale in a business request or draft initialization dependency. */
export function useLanguage(): Language { return useSyncExternalStore(subscribe, language, () => 'zh-CN'); }
