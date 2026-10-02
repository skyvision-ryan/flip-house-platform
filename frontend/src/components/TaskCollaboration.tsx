import { useState } from 'react';
import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { api, type Task } from '../api/client';
import { m } from '../i18n/core';
import { useLanguage } from '../i18n/LanguageProvider';
import { userCan } from '../lib/role';
import { useActor } from '../lib/actor';
import { useMeta } from '../lib/meta';
import { dateTime } from '../lib/format';
import FormField from './ui/FormField';
import Header from './ui/Header';

/** Notes remain independent of delivery batches and task state. */
export default function TaskCollaboration({task, meId, onChanged, showPeople = true}: {showPeople?: boolean; task: Task; meId: number | null; onChanged: (task: Task) => void}) {
  useLanguage();
  const { me } = useActor(); const meta = useMeta();
  const [text, setText] = useState('');
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canWrite = meId != null && (task.assignee?.id === meId || task.assistant?.id === meId || userCan(meta, me, 'assign_tasks'));
  const save = async () => {
    setBusy(true); setError('');
    try { const updated = await api.addTaskNote(task.project_id, task.id, {text: text.trim(), request_key: requestKey}); onChanged(updated); setText(''); setRequestKey(crypto.randomUUID()); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <section aria-label={m('assistant.notes')}><SpaceBetween size="s">
    {showPeople && <Box><b>{m('projectPreplan.primary.assignee')}</b>: {task.assignee?.display_name ?? m('personAvatar.unassigned')}<br /><b>{m('assistant.label')}</b>: {task.assistant?.display_name ?? m('assistant.none')}{task.assistant?.id === meId && ` (${m('assistant.mine')})`}</Box>}
    {task.assistant?.id === meId && <Box color="text-body-secondary">{m('assistant.permissions')}</Box>}
    <Header variant="h3">{m('assistant.notes')}</Header>
    {(task.notes ?? []).map(note => <div key={note.id}><Box variant="small" color="text-body-secondary">{note.author.display_name} · {dateTime(note.created_at)}</Box><div className="ui-task-note">{note.text}</div></div>)}
    {!task.notes?.length && <Box color="text-body-secondary">{m('assistant.noNotes')}</Box>}
    {canWrite && <><FormField label={m('assistant.addNote')} description={m('assistant.noteHelp')}><Textarea value={text} rows={2} disabled={busy} onChange={({detail}) => setText(detail.value)} /></FormField><Button loading={busy} disabled={!text.trim() || text.length > 4000} onClick={save}>{m('assistant.saveNote')}</Button></>}
    {error && <Alert type="error">{error}</Alert>}
  </SpaceBetween></section>;
}
