import { systemText } from '../i18n/core.ts';
import { m as uiText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import Box from '@cloudscape-design/components/box';

/** 确认记录里的角色代号是事实；保留文字，彻底移除按角色着色和圆圈。 */
export function RoleLabel({ code, title }: { code: string; title?: string }) {
  useLanguage();
  return <span className="ui-role-label" title={title ?? uiText("sentences.responsible.roles.2", { value1: (systemText(code)) })} aria-label={title ?? uiText("sentences.responsible.roles.2", { value1: (systemText(code)) })}>{systemText(code)}</span>;
}
export function RoleNames({ codes, prefix }: { codes: string[]; prefix?: string }) {
  useLanguage();
  return codes.length ? <Box variant="span" color="text-body-secondary" fontSize="body-s">{prefix}{codes.map(systemText).join(' / ')}</Box> : <span>—</span>;
}
