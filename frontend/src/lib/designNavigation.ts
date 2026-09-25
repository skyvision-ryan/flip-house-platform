export const DESIGN_DIRECTIONS_PATH = '/design-directions';
export type DesignSection = 'roles' | 'general';
type DesignAccount = { role_code: string; is_admin: boolean; active: boolean } | null;

export function hasDesignDirections(account: DesignAccount) {
  return !!account?.active && (account.is_admin || ['D', 'J', '项目助理', '采购', 'Permit/设计', '财务'].includes(account.role_code));
}

/** Generic layout sketches retain their existing management-only entrance. */
export function canViewGeneralDesign(account: DesignAccount) {
  return !!account?.active && (account.is_admin || ['D', 'J'].includes(account.role_code));
}

export function designSection(search: string): DesignSection {
  return new URLSearchParams(search).get('view') === 'general' ? 'general' : 'roles';
}

export function designLocation(section: DesignSection, search = '', hash = '') {
  const params = new URLSearchParams(search);
  params.set('view', section);
  return `${DESIGN_DIRECTIONS_PATH}?${params.toString()}${hash}`;
}

export function legacyDesignLocation(pathname: string, search = '', hash = '') {
  return designLocation(pathname === '/design-choices' ? 'general' : 'roles', search, hash);
}
