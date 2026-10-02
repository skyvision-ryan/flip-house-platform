import Badge from '@cloudscape-design/components/badge';
import { m } from '../i18n/core';
import { useLanguage } from '../i18n/LanguageProvider';
import { isNewToday } from '../lib/projectDates';
export default function NewTodayBadge({createdAt, day}: {createdAt?:string; day:string}) {
  useLanguage();
  return isNewToday(createdAt, day) ? <span><Badge color="blue">{m('newToday.label')}</Badge></span> : null;
}
