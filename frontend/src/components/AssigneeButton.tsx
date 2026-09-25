import Icon from '@cloudscape-design/components/icon';
import type { UserBrief } from '../api/client';
import PersonAvatar from './PersonAvatar';

/** 具体账号的分派入口；可用鼠标或键盘打开，不把操作冒泡为选行。 */
export default function AssigneeButton({ user, label, onClick, disabled = false }: {
  user: UserBrief | null | undefined; label: string; onClick: () => void; disabled?: boolean;
}) {
  return <button type="button" className="ui-assignee-button" aria-label={label} title={label}
    disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick(); }}>
    <PersonAvatar user={user} size="small" showRole={false} />
    <span className="ui-assignee-edit" aria-hidden="true"><Icon name="edit" size="small" /></span>
  </button>;
}
