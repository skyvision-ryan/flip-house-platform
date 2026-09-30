import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Form from '@cloudscape-design/components/form';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState } from 'react';
import { api, Me } from '../api/client';
import FormField from '../components/ui/FormField';
import Header from '../components/ui/Header';
import Container from '../components/ui/Surface';

/** 登录页：账号密码。演示模式下也能登录（管理员要进“用户”页）。 */
export default function Login({ onLogin, demoMode, onSkip }: { onLogin: (me: Me) => void; demoMode: boolean; onSkip?: () => void }) {
  useLanguage();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    if (!username.trim() || !password) { setErr(uiText("login.enter.both.account.and.password")); return; }
    setBusy(true); setErr(null);
    try { onLogin(await api.login(username.trim(), password)); } catch (e: any) { setErr(e.status === 401 ? uiText("login.incorrect.account.or.password") : e.message); } finally { setBusy(false); }
  };

  return (
    <div className="ui-login">
      <div className="ui-login-card">
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Form
            header={<Header variant="h1" description={uiText("login.sign.in.to.review.property.progress.and.handle.assigned")}>{uiText("productTopBar.flip.house.platform")}</Header>}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                {demoMode && onSkip && <Button variant="link" onClick={onSkip}>{uiText("login.continue.with.a.demo.role")}</Button>}
                <Button variant="primary" loading={busy} formAction="submit">{uiText("cardRegistry.sign.in")}</Button>
              </SpaceBetween>
            }
            errorText={systemText(err ?? undefined)}
          >
            <Container cardId="login">
              <SpaceBetween size="l">
                <FormField label={uiText("login.email")} constraintText={uiText("login.existing.demo.and.administrator.accounts.can.also.sign.in")}>
                  <Input value={username} onChange={({ detail }) => setUsername(detail.value)} autoFocus autoComplete="username" placeholder="name@example.com" />
                </FormField>
                <FormField label={uiText("utilitiesPanel.password")}>
                  <Input type="password" value={password} onChange={({ detail }) => setPassword(detail.value)} autoComplete="current-password" />
                </FormField>
              </SpaceBetween>
            </Container>
          </Form>
        </form>
        <p className="ui-muted">{uiText("login.forgot.your.password.or.cannot.sign.in.contact.the")}</p>
        {demoMode && <Box margin={{ top: 'm' }} variant="small" color="text-body-secondary" textAlign="center">{uiText("login.demo.mode.allows.visitors.to.select.a.role.from")}</Box>}
      </div>
    </div>
  );
}
