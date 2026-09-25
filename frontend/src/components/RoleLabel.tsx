import Box from '@cloudscape-design/components/box';

/** 确认记录里的角色代号是事实；保留文字，彻底移除按角色着色和圆圈。 */
export function RoleLabel({ code, title }: { code: string; title?: string }) {
  return <span className="ui-role-label" title={title ?? `负责角色：${code}`} aria-label={title ?? `负责角色：${code}`}>{code}</span>;
}
export function RoleNames({ codes, prefix }: { codes: string[]; prefix?: string }) {
  return codes.length ? <Box variant="span" color="text-body-secondary" fontSize="body-s">{prefix}{codes.join('、')}</Box> : <span>—</span>;
}
