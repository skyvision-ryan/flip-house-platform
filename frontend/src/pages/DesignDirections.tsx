import Alert from '@cloudscape-design/components/alert';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useActor } from '../lib/actor';
import { canViewGeneralDesign, designLocation, designSection, legacyDesignLocation } from '../lib/designNavigation';
import DesignChoices from './DesignChoices';
import DesignCollaboration from './DesignCollaboration';

/** A single navigation entrance. Protected role payloads remain authorized by the backend. */
export default function DesignDirections() {
  const { me } = useActor();
  const location = useLocation();
  const navigate = useNavigate();
  const section = designSection(location.search);
  const generalAllowed = canViewGeneralDesign(me);
  if (!me) return <Alert type="info">请登录自己的账号查看设计方向。</Alert>;
  if (section === 'general' && !generalAllowed) return <Navigate to={designLocation('roles')} replace />;
  return <section aria-label="设计方向">
    {generalAllowed && <div className="ui-rd-tabs" role="group" aria-label="设计方向分类">
      <button aria-pressed={section === 'roles'} onClick={() => navigate(designLocation('roles', location.search))}>职责工作区</button>
      <button aria-pressed={section === 'general'} onClick={() => navigate(designLocation('general', location.search))}>通用界面参考</button>
    </div>}
    {section === 'general' ? <DesignChoices /> : <DesignCollaboration />}
  </section>;
}

export function LegacyDesignRedirect() {
  const location = useLocation();
  return <Navigate to={legacyDesignLocation(location.pathname, location.search, location.hash)} replace />;
}
