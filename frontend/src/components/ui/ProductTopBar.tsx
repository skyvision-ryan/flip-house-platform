import type { ReactNode } from 'react';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown, { type ButtonDropdownProps } from '@cloudscape-design/components/button-dropdown';
import EmployeeAvatar from './EmployeeAvatar';
import type { UserBrief } from '../../api/client';

export default function ProductTopBar({ search, identityMenu, me, onHome, onDisplay }: {
  search: ReactNode; me: UserBrief | null; onHome: () => void; onDisplay: () => void;
  identityMenu: { text: string; title: string; items: ButtonDropdownProps['items']; onItemClick: ButtonDropdownProps['onItemClick'] };
}) {
  return <header className="ui-product-bar">
    <a href="/" className="ui-product-name" onClick={(e) => { e.preventDefault(); onHome(); }}>翻新项目平台</a>
    <div className="ui-product-search">{search}</div>
    <div className="ui-product-tools">
      <Button variant="icon" iconName="settings" ariaLabel="显示设置" onClick={onDisplay} />
      {me && <EmployeeAvatar user={me} size="small" />}
      <ButtonDropdown items={identityMenu.items} onItemClick={identityMenu.onItemClick} ariaLabel={identityMenu.title}>
        <span className="ui-identity-full">{identityMenu.text}</span><span className="ui-identity-compact">{me?.display_name ?? '演示身份'}</span>
      </ButtonDropdown>
    </div>
  </header>;
}
