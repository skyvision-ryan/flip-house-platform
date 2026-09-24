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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!username.trim() || !password) { setErr('账号和密码都要填'); return; }
    setBusy(true); setErr(null);
    try { onLogin(await api.login(username.trim(), password)); } catch (e: any) { setErr(e.message?.includes('401') || e.message?.includes('不对') ? '账号或密码不对' : e.message); } finally { setBusy(false); }
  };

  return (
    <div className="ui-login">
      <div className="ui-login-card">
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Form
            header={<Header variant="h1" help="用公司给你的账号登录。忘了密码找负责人重置。">翻新项目平台</Header>}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                {demoMode && onSkip && <Button variant="link" onClick={onSkip}>先不登录，用演示身份</Button>}
                <Button variant="primary" loading={busy} formAction="submit">登录</Button>
              </SpaceBetween>
            }
            errorText={err ?? undefined}
          >
            <Container cardId="login">
              <SpaceBetween size="l">
                <FormField label="邮箱" constraintText="原有演示账号和管理员也可使用原账号名登录。">
                  <Input value={username} onChange={({ detail }) => setUsername(detail.value)} autoFocus autoComplete="username" placeholder="name@example.com" />
                </FormField>
                <FormField label="密码">
                  <Input type="password" value={password} onChange={({ detail }) => setPassword(detail.value)} autoComplete="current-password" onKeyDown={({ detail }) => { if (detail.key === 'Enter') submit(); }} />
                </FormField>
              </SpaceBetween>
            </Container>
          </Form>
        </form>
        {demoMode && <Box margin={{ top: 'm' }} variant="small" color="text-body-secondary" textAlign="center">现在是演示模式：没登录也能用顶栏“我是”自报身份。正式上线后必须登录。</Box>}
      </div>
    </div>
  );
}
