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
  const [waitFor, setWaitFor] = useState('');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!reason.trim()) { setErr('要写原因：在等谁、等什么'); return; }
    setSaving(true); setErr(null);
    try {
      onDone(await api.taskStatus(task.project_id, task.id, { version: task.version, action: 'wait', wait_for: waitFor.trim() || null, wait_reason: reason.trim(), wait_until: until || null }));
    } catch (e: any) {
      const msg = String(e.message ?? e);
      if (msg.startsWith('409') || msg.includes('刚被别人改过')) onConflict(); else setErr(msg);
    } finally { setSaving(false); }
  };
  return (
    <Modal visible onDismiss={onDismiss} header={`记录等待：${task.title}`}
      footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" onClick={onDismiss} disabled={saving}>取消</Button><Button variant="primary" loading={saving} onClick={save}>保存等待</Button></SpaceBetween></Box>}>
      <SpaceBetween size="m">
        <FormField label="等待对象" description="例如：业主、City、承包商">
          <Input value={waitFor} onChange={({ detail }) => setWaitFor(detail.value)} />
        </FormField>
        <FormField label="原因（必填）" description="在等什么、为什么现在做不下去">
          <Textarea value={reason} rows={3} onChange={({ detail }) => setReason(detail.value)} />
        </FormField>
        <FormField label="预计回复日期（可选）">
          <DatePicker value={until} onChange={({ detail }) => setUntil(detail.value)} placeholder="YYYY/MM/DD" />
        </FormField>
        <HelpText>等待只说明这项任务卡在哪，不会锁住项目里别的事；统筹在项目总览里能看到。</HelpText>
        {err && <Alert type="error">{err}</Alert>}
      </SpaceBetween>
    </Modal>
  );
}
