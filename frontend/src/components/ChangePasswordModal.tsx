import { useRef, useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from './ui/FormField';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { api } from '../api/client';
import { m, systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { useFlash } from '../lib/flash';

export default function ChangePasswordModal({ onDismiss }: { onDismiss: () => void }) {
  useLanguage();
  const flash = useFlash();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  async function save() {
    if (submitting.current) return;
    setError('');
    if (next.length < 6 || next.length > 256) { setError(m('server.password.length')); return; }
    if (next !== confirm) { setError(m('server.password.mismatch')); return; }
    submitting.current = true; setBusy(true);
    try {
      await api.changePassword({ current_password: current, new_password: next, confirm_password: confirm });
      flash({ type: 'success', content: m('password.saved') });
      onDismiss();
    } catch (e) { setError((e as Error).message); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <Modal visible onDismiss={() => { if (!busy) onDismiss(); }} header={m('password.title')}
    footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs">
      <Button variant="link" disabled={busy} onClick={onDismiss}>{m('fieldWithSource.cancel')}</Button>
      <Button variant="primary" loading={busy} disabled={!current || !next || !confirm} onClick={() => void save()}>{m('password.title')}</Button>
    </SpaceBetween></Box>}>
    <SpaceBetween size="m">
      <Box>{m('password.hint')}</Box>
      {error && <Alert type="error">{systemText(error)}</Alert>}
      <FormField label={m('password.current')}><Input type="password" autoComplete="current-password" value={current} disabled={busy} onChange={({ detail }) => setCurrent(detail.value)} autoFocus /></FormField>
      <FormField label={m('password.new')} constraintText={m('server.password.length')}><Input type="password" autoComplete="new-password" value={next} disabled={busy} onChange={({ detail }) => setNext(detail.value)} /></FormField>
      <FormField label={m('password.confirm')}><Input type="password" autoComplete="new-password" value={confirm} disabled={busy} onChange={({ detail }) => setConfirm(detail.value)} /></FormField>
    </SpaceBetween>
  </Modal>;
}
