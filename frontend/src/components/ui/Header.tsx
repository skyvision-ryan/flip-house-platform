import type { ReactNode } from 'react';
import BaseHeader, { type HeaderProps } from '@cloudscape-design/components/header';
import HelpText, { useHelpOn } from '../HelpText';

/** description 是事实；help 是可关闭的使用说明。两者必须显式区分。 */
export default function Header({ help, description, ...props }: HeaderProps & { help?: ReactNode }) {
  const showHelp = useHelpOn();
  return <BaseHeader {...props} description={description || (showHelp && help) ? <>
    {description && <span className="ui-header-fact">{description}</span>}
    <HelpText>{help}</HelpText>
  </> : undefined} />;
}
