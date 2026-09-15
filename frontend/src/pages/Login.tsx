import { useState } from 'react';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { api, Me } from '../api/client';

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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#f2f3f3' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Form
            header={<Header variant="h1" description="用公司给你的账号登录。忘了密码找负责人重置。">翻新项目平台</Header>}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                {demoMode && onSkip && <Button variant="link" onClick={onSkip}>先不登录，用演示身份</Button>}
                <Button variant="primary" loading={busy} formAction="submit">登录</Button>
              </SpaceBetween>
            }
            errorText={err ?? undefined}
          >
            <Container>
              <SpaceBetween size="l">
                <FormField label="账号">
                  <Input value={username} onChange={({ detail }) => setUsername(detail.value)} autoFocus autoComplete="username" placeholder="例如 jessie" />
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
