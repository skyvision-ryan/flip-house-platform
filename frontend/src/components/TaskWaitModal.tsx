import { taskTitle } from '../i18n/templateNames.ts';
import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import DatePicker from '@cloudscape-design/components/date-picker';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useState } from 'react';
import { api, Task } from '../api/client';
import HelpText from './HelpText';
import FormField from './ui/FormField';

/** 记录等待（KAN-75）：等谁、等什么（必填）、预计回复日期（可空）。等待不锁项目，只是说明状态。 */
export default function TaskWaitModal({ task, onDone, onConflict, onDismiss }: { task: Task; onDone: (t: Task) => void; onConflict: () => void; onDismiss: () => void }) {
  useLanguage();
  const [waitFor, setWaitFor] = useState('');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!reason.trim()) { setErr(uiText("taskWaitModal.a.reason.is.required.who.or.what.are.you")); return; }
    setSaving(true); setErr(null);
    try {
      onDone(await api.taskStatus(task.project_id, task.id, { version: task.version, action: 'wait', wait_for: waitFor.trim() || null, wait_reason: reason.trim(), wait_until: until || null }));
    } catch (e: any) {
      const msg = String(e.message ?? e);
      setErr(msg);
      if (e.status === 409) onConflict();
    } finally { setSaving(false); }
  };
  return (
    <Modal visible onDismiss={onDismiss} header={uiText("sentences.record.waiting", { value1: (taskTitle(task)) })}
      footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" onClick={onDismiss} disabled={saving}>{uiText("fieldWithSource.cancel")}</Button><Button variant="primary" loading={saving} onClick={save}>{uiText("taskWaitModal.save.waiting.status")}</Button></SpaceBetween></Box>}>
      <SpaceBetween size="m">
        <FormField label={uiText("taskWaitModal.waiting.on")} description={uiText("taskWaitModal.for.example.property.owner.city.or.contractor")}>
          <Input value={waitFor} onChange={({ detail }) => setWaitFor(detail.value)} />
        </FormField>
        <FormField label={uiText("taskWaitModal.reason.required")} description={uiText("taskWaitModal.what.are.you.waiting.for.and.why.can.t")}>
          <Textarea value={reason} rows={3} onChange={({ detail }) => setReason(detail.value)} />
        </FormField>
        <FormField label={uiText("taskWaitModal.expected.response.date.optional")}>
          <DatePicker value={until} onChange={({ detail }) => setUntil(detail.value)} placeholder="YYYY/MM/DD" />
        </FormField>
        <HelpText>{uiText("taskWaitModal.waiting.identifies.this.task.s.dependency.without.blocking.other")}</HelpText>
        {err && <Alert type="error">{systemText(err)}</Alert>}
      </SpaceBetween>
    </Modal>
  );
}
