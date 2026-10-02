import Button from '@cloudscape-design/components/button';
import { setLanguage, m } from '../i18n/core';
import { useLanguage } from '../i18n/LanguageProvider';
/** Allows changing language while an assignment/delivery modal owns focus. */
export default function LanguageToggle() {
  const language=useLanguage();
  return <Button variant="inline-link" ariaLabel={m('settings.languageControl')} onClick={()=>setLanguage(language==='en'?'zh-CN':'en')}>{m(language==='en'?'workbench.switchChinese':'workbench.switchEnglish')}</Button>;
}
