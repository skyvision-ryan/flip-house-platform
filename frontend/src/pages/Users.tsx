import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useCallback, useEffect, useState } from 'react';
import { api, UserRow } from '../api/client';
import FormField from '../components/ui/FormField';
import Header from '../components/ui/Header';
import Table from '../components/ui/Table';
import { useActor } from '../lib/actor';
import { useFlash } from '../lib/flash';
import { dateStr } from '../lib/format';
import { useMeta } from '../lib/meta';
import PersonAvatar from '../components/PersonAvatar';

type Draft = { username: string; display_name: string; role_code: string; password: string; is_admin: boolean; email: string };
const EMPTY: Draft = { username: '', display_name: '', role_code: '', password: '', is_admin: false, email: '' };

/** 用户管理：只有管理员能进。一个人一个账号，账号绑一个角色代号，代号决定权限。 */
export default function Users() {
  useLanguage();
  const meta = useMeta();
  const flash = useFlash();
  const { me } = useActor();
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [selected, setSelected] = useState<UserRow[]>([]);
  const [modal, setModal] = useState<'create' | 'edit' | 'password' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => { setRows(await api.users()); }, []);
  useEffect(() => { load().catch((e) => flash({ type: 'error', content: e.message })); }, [load, flash]);

  const roleOptions = (meta?.roles ?? []).map((r) => ({ value: r.code, label: `${r.label}（${meta?.tiers?.[r.tier]?.label ?? r.tier}）`, description: r.duties }));
  const sel = selected[0];
  const open = (m: 'create' | 'edit' | 'password') => {
    setErr(null);
    if (m === 'create') setDraft(EMPTY);
    else if (sel) setDraft({ username: sel.username, display_name: sel.display_name, role_code: sel.role_code, password: '', is_admin: sel.is_admin, email: sel.email ?? '' });
    setModal(m);
  };
  const submit = async () => {
    if (busy) return;
    if (modal !== 'password' && !draft.role_code) { setErr(uiText("users.select.a.role.first")); return; }
    if (modal === 'create' && !draft.username.trim()) { setErr(uiText("users.account.is.required")); return; }
    if (modal !== 'edit' && draft.password.length < 6) { setErr(uiText("users.password.must.contain.at.least.6.characters")); return; }
    setBusy(true); setErr(null);
    try {
      if (modal === 'create') { await api.createUser({ ...draft, email: draft.email.trim() || null }); flash({ type: 'success', content: uiText("sentences.created.account", { value1: (draft.username), value2: (draft.role_code) }) }); }
      else if (modal === 'edit' && sel) { await api.patchUser(sel.id, { display_name: draft.display_name, role_code: draft.role_code, is_admin: draft.is_admin, email: draft.email.trim() || null }); flash({ type: 'success', content: uiText("sentences.updated", { value1: (sel.username) }) }); }
      else if (modal === 'password' && sel) { await api.patchUser(sel.id, { password: draft.password }); flash({ type: 'success', content: uiText("sentences.reset.password.for", { value1: (sel.username) }) }); }
      setModal(null); setSelected([]); await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const toggleActive = async () => {
    if (!sel) return;
    try { await api.patchUser(sel.id, { active: !sel.active }); flash({ type: 'success', content: uiText("sentences.", { value1: (sel.username), value2: (sel.active ? uiText("users.disable") : uiText("users.enable")) }) }); setSelected([]); await load(); }
    catch (e: any) { flash({ type: 'error', content: e.message }); }
  };

  return (
    <ContentLayout header={<Header variant="h1" help={uiText("users.each.person.has.an.account.its.role.code.determines")}>{uiText("app.users")}</Header>}>
      <Table cardId="user-list"
        items={rows ?? []}
        loading={rows === null}
        loadingText={uiText("users.loading")}
        selectionType="single"
        ariaLabels={{ selectionGroupLabel: uiText("users.select.an.account"), itemSelectionLabel: (_, user) => uiText("sentences.select", { value1: (user.display_name || user.username) }) }}
        selectedItems={selected}
        onSelectionChange={({ detail }) => setSelected(detail.selectedItems)}
        trackBy="id"
        variant="full-page"
        stickyHeader
        header={
          <Header
            description={uiText("users.select.an.account.before.editing.details.or.managing.access")}
            counter={rows ? `(${rows.length})` : undefined}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button disabled={!sel} onClick={() => open('edit')}>{uiText("users.edit.role.name")}</Button>
                <Button disabled={!sel} onClick={() => open('password')}>{uiText("users.reset.password")}</Button>
                <Button disabled={!sel || sel.id === me?.id} onClick={toggleActive}>{sel?.active === false ? uiText("users.enable") : uiText("users.disable")}</Button>
                <Button variant="primary" iconName="add-plus" onClick={() => open('create')}>{uiText("users.new.account")}</Button>
              </SpaceBetween>
            }
          >
            {uiText("utilitiesPanel.account")} </Header>
        }
        columnDefinitions={[
          { id: 'username', header: uiText("utilitiesPanel.account"), cell: (u) => <Box fontWeight="bold">{u.username}</Box> },
          { id: 'name', header: uiText("users.name"), cell: (u) => <PersonAvatar user={u} showRole={false} /> },
          { id: 'role', header: uiText("users.role"), cell: (u) => systemText(u.role_code) },
          { id: 'email', header: uiText("login.email"), cell: (u) => (u.email ? u.email : <Box color="text-body-secondary">{uiText("users.no.email.cannot.receive.reminders")}</Box>) },
          { id: 'tier', header: uiText("users.tier"), cell: (u) => systemText(u.tier_label) },
          { id: 'admin', header: uiText("users.administrator"), cell: (u) => (u.is_admin ? uiText("users.yes") : '—') },
          { id: 'status', header: uiText("taskSummaryPanel.status"), cell: (u) => (u.active ? <StatusIndicator type="success">{uiText("users.active")}</StatusIndicator> : <StatusIndicator type="stopped">{uiText("users.disabled")}</StatusIndicator>) },
          { id: 'last', header: uiText("users.last.sign.in"), cell: (u) => (u.last_login_at ? dateStr(u.last_login_at) : uiText("users.never.signed.in")) },
        ]}
        empty={<Box textAlign="center" padding="l">{uiText("users.no.accounts.yet.select.new.account.at.the.top")}</Box>}
      />

      <Modal
        visible={modal !== null}
        onDismiss={() => { if (!busy) setModal(null); }}
        header={modal === 'create' ? uiText("users.new.account") : modal === 'edit' ? uiText("sentences.edit.3", { value1: (sel?.username) }) : uiText("sentences.reset.password.for.2", { value1: (sel?.username) })}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" disabled={busy} onClick={() => setModal(null)}>{uiText("fieldWithSource.cancel")}</Button>
              <Button variant="primary" loading={busy} onClick={submit}>{modal === 'create' ? uiText("users.create.account") : uiText("fieldWithSource.save")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {modal === 'create' && (
            <FormField label={uiText("utilitiesPanel.account")} description={uiText("users.lowercase.sign.in.name.such.as.jessie")}>
              <Input value={draft.username} onChange={({ detail }) => setDraft({ ...draft, username: detail.value })} autoFocus />
            </FormField>
          )}
          {modal !== 'password' && (
            <>
              <FormField label={uiText("users.name")} description={uiText("users.name.displayed.in.the.interface")}>
                <Input value={draft.display_name} onChange={({ detail }) => setDraft({ ...draft, display_name: detail.value })} />
              </FormField>
              <FormField label={uiText("users.role")} description={uiText("users.the.role.determines.access.and.actions.project.membership.is")}>
                <Select
                  selectedOption={roleOptions.find((o) => o.value === draft.role_code) ?? null}
                  onChange={({ detail }) => setDraft({ ...draft, role_code: detail.selectedOption.value ?? '' })}
                  options={roleOptions}
                  placeholder={uiText("users.select.a.role")}
                />
              </FormField>
              <FormField label={uiText("login.email")} description={uiText("users.for.future.task.reminders.email.is.not.currently.connected")}>
                <Input type="email" value={draft.email} onChange={({ detail }) => setDraft({ ...draft, email: detail.value })} placeholder="name@company.com" />
              </FormField>
              <Checkbox checked={draft.is_admin} onChange={({ detail }) => setDraft({ ...draft, is_admin: detail.checked })} description={uiText("users.can.create.accounts.change.roles.and.reset.passwords")}>{uiText("users.administrator")}</Checkbox>
            </>
          )}
          {modal !== 'edit' && (
            <FormField label={modal === 'create' ? uiText("users.initial.password") : uiText("users.new.password")} constraintText={uiText("users.at.least.6.characters")}>
              <Input type="password" value={draft.password} onChange={({ detail }) => setDraft({ ...draft, password: detail.value })} autoFocus={modal === 'password'} />
            </FormField>
          )}
          {err && <Box color="text-status-error">{systemText(err)}</Box>}
        </SpaceBetween>
      </Modal>
    </ContentLayout>
  );
}
