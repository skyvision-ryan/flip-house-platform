import { taskTitle } from '../i18n/templateNames.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m } from '../i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import DatePicker from '@cloudscape-design/components/date-picker';
import Modal from '@cloudscape-design/components/modal';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useEffect, useState } from 'react';
import { api, type ProjectMembers, type Task, type UserBrief } from '../api/client';
import { useMeta } from '../lib/meta';
import { userCan } from '../lib/role';
import FormField from './ui/FormField';

/** Each task saves atomically. Bulk progress and conflicts stay visible with the draft. */
export default function TaskAssignModal({projectId, tasks, onDone, onConflict, onDismiss}: {
  projectId: number; tasks: Task[]; onDone: (t: Task) => void; onConflict: () => void; onDismiss: () => void;
}) {
  useLanguage(); const meta = useMeta();
  const [baselines, setBaselines] = useState(tasks);
  const task = baselines[0], bulk = tasks.length > 1;
  const [members, setMembers] = useState<ProjectMembers | null>(null);
  const [who, setWho] = useState<number | null>(task.assignee?.id ?? null);
  const [assistant, setAssistant] = useState<number | null>(bulk ? null : task.assistant?.id ?? null);
  const [due, setDue] = useState(task.due_at ?? '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [successes, setSuccesses] = useState<number[]>([]);
  const [failures, setFailures] = useState<{id:number; message:string}[]>([]);
  const [conflicts, setConflicts] = useState<number[]>([]);
  const [refreshed, setRefreshed] = useState(false);
  useEffect(() => { api.projectMembers(projectId).then(setMembers).catch(e => setErr(e.message)); }, [projectId]);
  const people = [...(members?.members ?? []), ...(members?.others ?? [])].filter(u => u.active);
  const opt = (u: UserBrief) => ({value: String(u.id), label: u.display_name, description: u.username});
  const none = {value:'', label: m('assistant.none')};
  const options = [none, ...people.filter(u => !tasks.some(t => t.step_key === 'purchase') || userCan(meta, u, 'procurement')).map(opt)];
  const assistantOptions = [none, ...people.filter(u => u.id !== who).map(opt)];
  const selected = (id: number | null) => id == null ? none : opt(people.find(u => u.id === id) ?? {id, display_name: baselines.flatMap(t => [t.assignee, t.assistant]).find(u => u?.id === id)?.display_name ?? String(id), username:'', role_code:'', active:false});
  const pending = baselines.filter(t => !successes.includes(t.id));
  const needsReason = pending.some(t => (t.assignee && t.assignee.id !== who) || (t.assistant && t.assistant.id !== assistant));
  const changed = bulk || pending.some(t => (t.assignee?.id ?? null) !== who || (t.assistant?.id ?? null) !== assistant || (t.due_at ?? '') !== due);
  const joinNames = people.filter(u => (u.id === who || u.id === assistant) && !members?.members.some(x => x.id === u.id)).map(u => u.display_name);
  const save = async () => {
    setErr(''); setRefreshed(false);
    if (assistant != null && (who == null || who === assistant)) {setErr(m('server.assistantPairInvalid')); return;}
    if (needsReason && !reason.trim()) {setErr(m('assignment.reasonRequired')); return;}
    setSaving(true);
    const saved = [...successes], failed: typeof failures = [], stale: number[] = [];
    let last: Task | null = null;
    for (const t of pending) {
      try {
        last = await api.assignTask(projectId, t.id, {version:t.version, assignee_user_id:who, assistant_user_id:assistant,
          due_at: bulk && !due ? undefined : due || null, reason:reason.trim() || null});
        saved.push(t.id);
      } catch (e: any) { failed.push({id:t.id, message:e.message}); if (e.status === 409) stale.push(t.id); }
    }
    setSuccesses(saved); setFailures(failed); setConflicts(stale); setSaving(false);
    if (!failed.length && last) onDone(last);
  };
  const refreshConflicts = async () => {
    setSaving(true); setErr('');
    try {
      const fresh = await Promise.all(conflicts.map(id => api.task(projectId, id)));
      setBaselines(prev => prev.map(t => fresh.find(x => x.id === t.id) ?? t));
      setConflicts([]); setRefreshed(true);
    } catch(e: any) {setErr(e.message);} finally {setSaving(false);}
  };
  const dismiss = () => {if (successes.length) onConflict(); else onDismiss();};
  return <Modal visible onDismiss={saving ? () => {} : dismiss} header={bulk ? m('sentences.assign.tasks', {value1:tasks.length}) : m('sentences.update.assignment', {value1:taskTitle(task)})} footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" disabled={saving} onClick={dismiss}>{m('fieldWithSource.cancel')}</Button><Button variant="primary" loading={saving} disabled={!members || !changed || !!conflicts.length} onClick={save}>{m('taskAssignModal.save.assignment')}</Button></SpaceBetween></Box>}>
    <SpaceBetween size="m">
      {bulk && <Box>{tasks.map(taskTitle).join(' / ')}<p>{m('assignment.bulkHint')}</p></Box>}
      <FormField label={m('projectPreplan.primary.assignee')}><Select selectedOption={selected(who)} options={options} filteringType="auto" onChange={({detail})=>setWho(detail.selectedOption.value ? Number(detail.selectedOption.value) : null)} /></FormField>
      <FormField label={m('assistant.optional')} description={m('assistant.permissions')}><Select selectedOption={selected(assistant)} options={assistantOptions} filteringType="auto" onChange={({detail})=>setAssistant(detail.selectedOption.value ? Number(detail.selectedOption.value) : null)} /></FormField>
      {!!joinNames.length && <Box>{m('assignment.autoJoin',{people:joinNames.join(' / ')})}</Box>}
      <FormField label={m('projectPreplan.due.date.optional')}><DatePicker value={due} onChange={({detail})=>setDue(detail.value)} placeholder="YYYY/MM/DD" /></FormField>
      <FormField label={m(needsReason ? 'assignment.reasonRequired' : 'taskAssignModal.explanation.optional')}><Textarea value={reason} onChange={({detail})=>setReason(detail.value)} rows={2} /></FormField>
      {refreshed && <Alert type="info">{m('assignment.draftRetained')}{pending.map(t => <div key={t.id}>{taskTitle(t)} · {m('projectPreplan.primary.assignee')}: {t.assignee?.display_name ?? none.label} · {m('assistant.label')}: {t.assistant?.display_name ?? none.label} · {m('projectPreplan.due.date')}: {t.due_at ?? m('projectPreplan.not.set')}</div>)}</Alert>}
      {!!successes.length && <Alert type="success">{m('assignment.savedItems',{items:tasks.filter(t=>successes.includes(t.id)).map(taskTitle).join(' / ')})}</Alert>}
      {!!failures.length && <Alert type="error">{failures.map(f=><div key={f.id}>{taskTitle(tasks.find(t=>t.id===f.id)!)}: {f.message}</div>)}</Alert>}
      {!!conflicts.length && <Button disabled={saving} onClick={refreshConflicts}>{m('assignment.refreshKeepDraft')}</Button>}
      {err && <Alert type="error">{err}</Alert>}
    </SpaceBetween>
  </Modal>;
}
