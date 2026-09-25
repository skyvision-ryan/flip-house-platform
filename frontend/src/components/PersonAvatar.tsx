import EmployeeAvatar from './ui/EmployeeAvatar';
import Box from '@cloudscape-design/components/box';
import Icon from '@cloudscape-design/components/icon';
import type { UserBrief } from '../api/client';

/**
 * 具体的人（KAN-75）。和 RoleLabel 分工：RoleLabel 表**角色代号**（模板里写的负责角色），
 * 这里表**账号**——头像字母 + 姓名 + 角色。没人时画「待分派」。
 * 头像通过 UI 包装层复用 Cloudscape Avatar；员工色绑定账号，和角色颜色无关。
 */
export default function PersonAvatar({ user, size = 'normal', showRole = true }: { user: UserBrief | null | undefined; size?: 'normal' | 'small'; showRole?: boolean }) {
  if (!user) {
    return (
      <span className="ui-person-empty">
        <span className="ui-avatar-empty" aria-hidden="true" data-size={size}><Icon name="add-plus" size="small" /></span>
        <Box variant="span" color="text-body-secondary">待分派</Box>
      </span>
    );
  }
  return (
    <span className="ui-person">
      <EmployeeAvatar user={user} size={size} />
      <span className="ui-person-label">
        <div className="ui-wrap-anywhere">{user.display_name}{!user.active && <Box variant="span" color="text-status-inactive">（已停用）</Box>}</div>
        {showRole && <Box variant="small" color="text-body-secondary">{user.role_code}</Box>}
      </span>
    </span>
  );
}
