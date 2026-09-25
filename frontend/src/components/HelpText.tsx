import { createContext, useContext, type ReactNode } from 'react';
import Icon from '@cloudscape-design/components/icon';

export const HelpContext = createContext(false);
export const useHelpOn = () => useContext(HelpContext);

/** 只承载操作解释。错误、来源、当前状态和必填约束不得放进这个可隐藏区域。 */
export default function HelpText({ children, inline = false }: { children: ReactNode; inline?: boolean }) {
  const on = useHelpOn();
  if (!on || !children) return null;
  return <div className={`ui-help${inline ? ' ui-help-inline' : ''}`} data-help-text="true">
    <span className="ui-help-icon" aria-hidden="true"><Icon name="status-info" size="small" /></span>
    <div className="ui-help-copy">{children}</div>
  </div>;
}
