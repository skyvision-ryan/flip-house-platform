import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useActor } from '../lib/actor';
import { canViewGeneralDesign, designLocation, designSection, legacyDesignLocation } from '../lib/designNavigation';
import DesignChoices from './DesignChoices';
import DesignCollaboration from './DesignCollaboration';

/** A single navigation entrance. Protected role payloads remain authorized by the backend. */
export default function DesignDirections() {
  useLanguage();
  const { me } = useActor();
  const location = useLocation();
  const navigate = useNavigate();
  const section = designSection(location.search);
  const generalAllowed = canViewGeneralDesign(me);
  if (!me) return <Alert type="info">{uiText("designDirections.sign.in.with.your.own.account.to.view.design")}</Alert>;
  if (section === 'general' && !generalAllowed) return <Navigate to={designLocation('roles')} replace />;
  return <section aria-label={uiText("app.design.directions")}>
    {generalAllowed && <div className="ui-rd-tabs" role="group" aria-label={uiText("designDirections.design.direction.categories")}>
      <button aria-pressed={section === 'roles'} onClick={() => navigate(designLocation('roles', location.search))}>{uiText("designDirections.role.workspaces")}</button>
      <button aria-pressed={section === 'general'} onClick={() => navigate(designLocation('general', location.search))}>{uiText("designChoices.general.interface.references")}</button>
    </div>}
    {section === 'general' ? <DesignChoices /> : <DesignCollaboration />}
  </section>;
}

export function LegacyDesignRedirect() {
  useLanguage();
  const location = useLocation();
  return <Navigate to={legacyDesignLocation(location.pathname, location.search, location.hash)} replace />;
}
