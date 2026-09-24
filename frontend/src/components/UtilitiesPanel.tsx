import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Input from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { api, Utility, UtilityIn } from '../api/client';
import { useActor } from '../lib/actor';
import { useFlash } from '../lib/flash';
import { labelOf, useMeta } from '../lib/meta';
import HelpText from './HelpText';
import { RoleLabel } from './RoleLabel';
import FormField from './ui/FormField';
import Header from './ui/Header';
import Container from './ui/Surface';

const STATUS_KIND: Record<string, 'success' | 'pending' | 'stopped' | 'in-progress'> = { on: 'success', pending: 'in-progress', not_started: 'pending', off: 'stopped' };
const shortTime = (iso: string | null) => (iso ? iso.slice(5, 16).replace('T', ' ').replace('-', '/') : '');

function websiteHref(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes(':') || trimmed.startsWith('//') ? trimmed : `https://${trimmed}`);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function withControls(input: ReactNode, controls: ReactNode) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: 4 }}>{input}{controls}</div>;
}

/** 数据页里的“水、电、瓦斯账户”：三行固定，行内直接改，改完点保存。密码默认打码，点“看”才显示。 */
export default function UtilitiesPanel({ projectId, onChanged }: { projectId: number; onChanged?: () => void }) {
  const meta = useMeta();
  const flash = useFlash();
  const { actor } = useActor();
  const [rows, setRows] = useState<Utility[] | null>(null);
  const [draft, setDraft] = useState<Record<string, UtilityIn>>({});
  const [showPw, setShowPw] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(() => api.utilities(projectId).then((r) => { setRows(r); setDraft({}); }), [projectId]);
  useEffect(() => { load(); }, [load]);

  if (!rows) return <Box textAlign="center" padding="m"><Spinner /></Box>;

  const toIn = (u: Utility): UtilityIn => ({ company: u.company, website: u.website ?? null, account_no: u.account_no, login: u.login, password: u.password, opened_under: u.opened_under, status: u.status, blocker: u.blocker });
  const get = (u: Utility) => draft[u.kind] ?? toIn(u);
  const set = (u: Utility, patch: Partial<UtilityIn>) => setDraft((d) => ({ ...d, [u.kind]: { ...get(u), ...patch } }));
  const dirty = (u: Utility) => JSON.stringify(get(u)) !== JSON.stringify(toIn(u));
  const statusOptions = meta?.utility_statuses ?? [];

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      flash({ type: 'success', content: `${label}已复制` });
    } catch {
      flash({ type: 'error', content: '复制失败，请手动复制，或检查浏览器的剪贴板权限。' });
    }
  };

  const copyButton = (value: string | null, label: string) => (
    <Button iconName="copy" ariaLabel={`复制${label}`} disabled={!value} onClick={() => { if (value) void copy(value, label); }} />
  );

  const save = async (u: Utility) => {
    const value = get(u);
    const website = websiteHref(value.website);
    if (value.website?.trim() && !website) {
      flash({ type: 'error', content: '请输入有效的 http:// 或 https:// 网址，且不要包含账号密码。' });
      return;
    }
    setSaving(u.kind);
    try {
      setRows(await api.saveUtility(projectId, u.kind, { ...value, website }));
      setDraft((d) => { const n = { ...d }; delete n[u.kind]; return n; });
      flash({ type: 'success', content: `${labelOf(meta?.utility_kinds, u.kind)}的账户已保存（${actor}）` });
      onChanged?.();
    } catch (e: any) {
      flash({ type: 'error', content: `没保存上：${e.message}` });
    } finally {
      setSaving(null);
    }
  };

  const onCount = rows.filter((r) => r.status === 'on').length;
  return (
    <SpaceBetween size="s">
      <Box color="text-body-secondary">
        {onCount === 3 ? <StatusIndicator type="success">三家都已开通</StatusIndicator>
          : rows.every((r) => r.status === 'off') ? <StatusIndicator type="stopped">三家都已关闭</StatusIndicator>
          : <StatusIndicator type={onCount ? 'in-progress' : 'pending'}>{onCount} / 3 已开通{rows.some((r) => r.status === 'pending' && r.blocker) ? '，有一家卡住了' : ''}</StatusIndicator>}
        　<HelpText>三家都开通后，总览清单里“开通水电瓦斯”会自动打勾；都关闭后“关水电瓦斯”自动打勾。</HelpText>
      </Box>
      <ColumnLayout columns={3}>
        {rows.map((u) => {
          const v = get(u);
          const href = websiteHref(v.website);
          return (
            <Container cardId="utility-account" cardContext={u.kind}
              key={u.kind}
              header={<Header variant="h3" actions={<Button variant={dirty(u) ? 'primary' : 'normal'} disabled={!dirty(u)} loading={saving === u.kind} onClick={() => save(u)}>保存</Button>}
                description={u.updated_by ? <span><RoleLabel code={u.updated_by} />{shortTime(u.updated_at)} 填的</span> : '还没人填'}>
                <StatusIndicator type={STATUS_KIND[v.status] ?? 'pending'}>{labelOf(meta?.utility_kinds, u.kind)}</StatusIndicator>
              </Header>}
            >
              <SpaceBetween size="s">
                <FormField label="状态">
                  <Select selectedOption={statusOptions.find((o) => o.value === v.status) ?? null} options={statusOptions} onChange={({ detail }) => set(u, { status: detail.selectedOption.value! })} />
                </FormField>
                <FormField label="公司"><Input value={v.company ?? ''} placeholder="比如 Evergy" onChange={({ detail }) => set(u, { company: detail.value || null })} /></FormField>
                <FormField label="网址" description="可填写公司官网或登录页；省略协议时使用 https://。"
                  errorText={v.website?.trim() && !href ? '请输入有效的 http:// 或 https:// 网址，且不要包含账号密码。' : undefined}
                  secondaryControl={href ? <Link href={href} target="_blank" rel="noopener noreferrer" external externalIconAriaLabel="在新标签页打开">打开网站</Link> : undefined}>
                  <Input value={v.website ?? ''} placeholder="https://…" onChange={({ detail }) => set(u, { website: detail.value || null })} />
                </FormField>
                <FormField label="账号">{withControls(
                  <Input value={v.account_no ?? ''} onChange={({ detail }) => set(u, { account_no: detail.value || null })} />, copyButton(v.account_no, '账号'))}</FormField>
                <FormField label="登录名">{withControls(
                  <Input value={v.login ?? ''} onChange={({ detail }) => set(u, { login: detail.value || null })} />, copyButton(v.login, '登录名'))}</FormField>
                <FormField label="密码">{withControls(
                  <Input type={showPw[u.kind] ? 'text' : 'password'} value={v.password ?? ''} onChange={({ detail }) => set(u, { password: detail.value || null })} />,
                  <SpaceBetween direction="horizontal" size="xxs">
                    {copyButton(v.password, '密码')}
                    <Button iconName={showPw[u.kind] ? 'lock-private' : 'unlocked'} ariaLabel="显示或隐藏密码" onClick={() => setShowPw((s) => ({ ...s, [u.kind]: !s[u.kind] }))} />
                  </SpaceBetween>)}
                </FormField>
                <FormField label="用谁的名字开的" description="有的房用 A 的名字，有的用别人的，写清楚防混淆">
                  <Input value={v.opened_under ?? ''} onChange={({ detail }) => set(u, { opened_under: detail.value || null })} />
                </FormField>
                <FormField label="卡在哪" description="在等什么、谁没回">
                  <Input value={v.blocker ?? ''} onChange={({ detail }) => set(u, { blocker: detail.value || null })} />
                </FormField>
              </SpaceBetween>
            </Container>
          );
        })}
      </ColumnLayout>
      <HelpText>账号凭证按现有角色权限显示；保存前请确认信息准确。</HelpText>
    </SpaceBetween>
  );
}
