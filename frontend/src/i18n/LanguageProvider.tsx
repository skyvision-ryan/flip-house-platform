import { useEffect, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { I18nProvider } from '@cloudscape-design/components/i18n';
import zh from '@cloudscape-design/components/i18n/messages/all.zh-CN';
import en from '@cloudscape-design/components/i18n/messages/all.en';
import { i18n, m } from './core.ts';
import { LANGUAGE_PREF_KEY } from './preferences.ts';
import { useLanguage } from './languageStore.ts';
export { useLanguage } from './languageStore.ts';
export function LanguageProvider({ children }: { children: ReactNode }) {
  const locale = useLanguage();
  useEffect(() => { document.documentElement.lang = locale === 'en' ? 'en-US' : 'zh-CN'; document.title = m('app.name'); }, [locale]);
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === LANGUAGE_PREF_KEY) void i18n.changeLanguage(event.newValue === 'en' ? 'en' : 'zh-CN'); };
    window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed);
  }, []);
  return <I18nextProvider i18n={i18n}><I18nProvider locale={locale === 'en' ? 'en-US' : locale} messages={[zh, en]}>{children}</I18nProvider></I18nextProvider>;
}
