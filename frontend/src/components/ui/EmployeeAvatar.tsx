import { systemText } from '../../i18n/core.ts';
import { useLanguage } from '../../i18n/LanguageProvider';
import Avatar from '@cloudscape-design/chat-components/avatar';
import type { UserBrief } from '../../api/client';
import { initialsOf } from '../../lib/taskGroups';
import { employeeColorKey, employeeColors } from './employeeColors';

export default function EmployeeAvatar({ user, size = 'normal' }: { user: UserBrief; size?: 'normal' | 'small' }) {
  useLanguage();
  const label = `${user.display_name} · ${systemText(user.role_code)}${user.active ? '' : '（已停用）'}`;
  const background = employeeColors[employeeColorKey(user.id)];
  return <Avatar ariaLabel={label} tooltipText={label} initials={initialsOf(user)} width={size === 'small' ? 28 : 32}
    style={{ root: { background, color: employeeColors.foreground, borderRadius: '50%' } }} />;
}
