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
    if (modal !== 'password' && !draft.role_code) { setErr('先选一个角色'); return; }
    if (modal === 'create' && !draft.username.trim()) { setErr('账号不能为空'); return; }
    if (modal !== 'edit' && draft.password.length < 6) { setErr('密码至少 6 位'); return; }
    setBusy(true); setErr(null);
    try {
      if (modal === 'create') { await api.createUser({ ...draft, email: draft.email.trim() || null }); flash({ type: 'success', content: `已建账号 ${draft.username}（${draft.role_code}）` }); }
      else if (modal === 'edit' && sel) { await api.patchUser(sel.id, { display_name: draft.display_name, role_code: draft.role_code, is_admin: draft.is_admin, email: draft.email.trim() || null }); flash({ type: 'success', content: `已更新 ${sel.username}` }); }
      else if (modal === 'password' && sel) { await api.patchUser(sel.id, { password: draft.password }); flash({ type: 'success', content: `已重置 ${sel.username} 的密码` }); }
      setModal(null); setSelected([]); await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const toggleActive = async () => {
    if (!sel) return;
    try { await api.patchUser(sel.id, { active: !sel.active }); flash({ type: 'success', content: `${sel.username} 已${sel.active ? '停用' : '启用'}` }); setSelected([]); await load(); }
    catch (e: any) { flash({ type: 'error', content: e.message }); }
  };

  return (
    <ContentLayout header={<Header variant="h1" help="一个人一个账号。账号绑定的角色代号决定能看什么、能改什么；管理员能管账号。">用户</Header>}>
      <Table cardId="user-list"
        items={rows ?? []}
        loading={rows === null}
        loadingText="读取中"
        selectionType="single"
        selectedItems={selected}
        onSelectionChange={({ detail }) => setSelected(detail.selectedItems)}
        trackBy="id"
        variant="full-page"
        stickyHeader
        header={
          <Header
            counter={rows ? `(${rows.length})` : undefined}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button disabled={!sel} onClick={() => open('edit')}>改角色 / 名字</Button>
                <Button disabled={!sel} onClick={() => open('password')}>重置密码</Button>
                <Button disabled={!sel || sel.id === me?.id} onClick={toggleActive}>{sel?.active === false ? '启用' : '停用'}</Button>
                <Button variant="primary" iconName="add-plus" onClick={() => open('create')}>新建账号</Button>
              </SpaceBetween>
            }
          >
            账号
          </Header>
        }
        columnDefinitions={[
          { id: 'username', header: '账号', cell: (u) => <Box fontWeight="bold">{u.username}</Box> },
          { id: 'name', header: '姓名', cell: (u) => <PersonAvatar user={u} showRole={false} /> },
          { id: 'role', header: '角色', cell: (u) => u.role_code },
          { id: 'email', header: '邮箱', cell: (u) => (u.email ? u.email : <Box color="text-body-secondary">无邮箱 · 收不到提醒</Box>) },
          { id: 'tier', header: '级别', cell: (u) => u.tier_label },
          { id: 'admin', header: '管理员', cell: (u) => (u.is_admin ? '是' : '—') },
          { id: 'status', header: '状态', cell: (u) => (u.active ? <StatusIndicator type="success">在用</StatusIndicator> : <StatusIndicator type="stopped">已停用</StatusIndicator>) },
          { id: 'last', header: '上次登录', cell: (u) => (u.last_login_at ? dateStr(u.last_login_at) : '还没登录过') },
        ]}
        empty={<Box textAlign="center" padding="l">还没有账号。点右上角“新建账号”。</Box>}
      />

      <Modal
        visible={modal !== null}
        onDismiss={() => setModal(null)}
        header={modal === 'create' ? '新建账号' : modal === 'edit' ? `改 ${sel?.username}` : `重置 ${sel?.username} 的密码`}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setModal(null)}>取消</Button>
              <Button variant="primary" loading={busy} onClick={submit}>{modal === 'create' ? '建账号' : '保存'}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {modal === 'create' && (
            <FormField label="账号" description="登录用，英文小写，例如 jessie">
              <Input value={draft.username} onChange={({ detail }) => setDraft({ ...draft, username: detail.value })} autoFocus />
            </FormField>
          )}
          {modal !== 'password' && (
            <>
              <FormField label="姓名" description="页面上显示的名字">
                <Input value={draft.display_name} onChange={({ detail }) => setDraft({ ...draft, display_name: detail.value })} />
              </FormField>
              <FormField label="角色" description="角色决定可见范围与操作权限；项目成员关系另行管理。">
                <Select
                  selectedOption={roleOptions.find((o) => o.value === draft.role_code) ?? null}
                  onChange={({ detail }) => setDraft({ ...draft, role_code: detail.selectedOption.value ?? '' })}
                  options={roleOptions}
                  placeholder="选一个角色"
                />
              </FormField>
              <FormField label="邮箱" description="用于后续任务提醒；当前邮件通道尚未接通。">
                <Input type="email" value={draft.email} onChange={({ detail }) => setDraft({ ...draft, email: detail.value })} placeholder="name@company.com" />
              </FormField>
              <Checkbox checked={draft.is_admin} onChange={({ detail }) => setDraft({ ...draft, is_admin: detail.checked })} description="能建账号、改角色、重置密码">管理员</Checkbox>
            </>
          )}
          {modal !== 'edit' && (
            <FormField label={modal === 'create' ? '初始密码' : '新密码'} constraintText="至少 6 位">
              <Input type="password" value={draft.password} onChange={({ detail }) => setDraft({ ...draft, password: detail.value })} autoFocus={modal === 'password'} />
            </FormField>
          )}
          {err && <Box color="text-status-error">{err}</Box>}
        </SpaceBetween>
      </Modal>
    </ContentLayout>
  );
}
