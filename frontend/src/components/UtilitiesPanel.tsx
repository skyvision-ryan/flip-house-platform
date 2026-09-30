import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
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
  return <div className="ui-input-controls">{input}{controls}</div>;
}

/** 数据页里的“水、电、瓦斯账户”：三行固定，行内直接改，改完点保存。密码默认打码，点“看”才显示。 */
export default function UtilitiesPanel({ projectId, onChanged }: { projectId: number; onChanged?: () => void }) {
  useLanguage();
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
      flash({ type: 'success', content: uiText("sentences.copied", { value1: (label) }) });
    } catch {
      flash({ type: 'error', content: uiText("utilitiesPanel.copy.failed.copy.manually.or.check.clipboard.permissions") });
    }
  };

  const copyButton = (value: string | null, label: string) => (
    <Button iconName="copy" ariaLabel={uiText("sentences.copy", { value1: (label) })} disabled={!value} onClick={() => { if (value) void copy(value, label); }} />
  );

  const save = async (u: Utility) => {
    const value = get(u);
    const website = websiteHref(value.website);
    if (value.website?.trim() && !website) {
      flash({ type: 'error', content: uiText("utilitiesPanel.enter.a.valid.http.or.https.url.without.account") });
      return;
    }
    setSaving(u.kind);
    try {
      setRows(await api.saveUtility(projectId, u.kind, { ...value, website }));
      setDraft((d) => { const n = { ...d }; delete n[u.kind]; return n; });
      flash({ type: 'success', content: uiText("sentences.account.saved", { value1: (labelOf(meta?.utility_kinds, u.kind)), value2: (actor) }) });
      onChanged?.();
    } catch (e: any) {
      flash({ type: 'error', content: uiText("sentences.could.not.save", { value1: (e.message) }) });
    } finally {
      setSaving(null);
    }
  };

  const onCount = rows.filter((r) => r.status === 'on').length;
  return (
    <SpaceBetween size="s">
      <Box color="text-body-secondary">
        {onCount === 3 ? <StatusIndicator type="success">{uiText("utilitiesPanel.all.three.utilities.active")}</StatusIndicator>
          : rows.every((r) => r.status === 'off') ? <StatusIndicator type="stopped">{uiText("utilitiesPanel.all.three.utilities.closed")}</StatusIndicator>
          : <StatusIndicator type={onCount ? 'in-progress' : 'pending'}>{onCount} {uiText("utilitiesPanel.3.active")}{rows.some((r) => r.status === 'pending' && r.blocker) ? uiText("utilitiesPanel.one.is.blocked") : ''}</StatusIndicator>}
        　<HelpText>{uiText("utilitiesPanel.the.utility.activation.checklist.item.is.satisfied.when.all")}</HelpText>
      </Box>
      <ColumnLayout columns={3}>
        {rows.map((u) => {
          const v = get(u);
          const href = websiteHref(v.website);
          return (
            <Container cardId="utility-account" cardContext={u.kind}
              key={u.kind}
              header={<Header variant="h3" actions={<Button variant={dirty(u) ? 'primary' : 'normal'} disabled={!dirty(u)} loading={saving === u.kind} onClick={() => save(u)}>{uiText("fieldWithSource.save")}</Button>}
                description={u.updated_by ? <span><RoleLabel code={u.updated_by} />{shortTime(u.updated_at)} {uiText("utilitiesPanel.entered.by")}</span> : uiText("utilitiesPanel.no.entry.yet")}>
                <StatusIndicator type={STATUS_KIND[v.status] ?? 'pending'}>{labelOf(meta?.utility_kinds, u.kind)}</StatusIndicator>
              </Header>}
            >
              <SpaceBetween size="s">
                <FormField label={uiText("taskSummaryPanel.status")}>
                  <Select selectedOption={statusOptions.find((o) => o.value === v.status) ?? null} options={statusOptions} onChange={({ detail }) => set(u, { status: detail.selectedOption.value! })} />
                </FormField>
                <FormField label={uiText("procurementItemRow.company")}><Input value={v.company ?? ''} placeholder={uiText("utilitiesPanel.for.example.evergy")} onChange={({ detail }) => set(u, { company: detail.value || null })} /></FormField>
                <FormField label={uiText("utilitiesPanel.website")} description={uiText("utilitiesPanel.company.website.or.sign.in.page.omitted.protocols.default")}
                  errorText={systemText(v.website?.trim() && !href ? uiText("utilitiesPanel.enter.a.valid.http.or.https.url.without.account") : undefined)}
                  secondaryControl={href ? <Link href={href} target="_blank" rel="noopener noreferrer" external externalIconAriaLabel={uiText("utilitiesPanel.open.in.new.tab")}>{uiText("utilitiesPanel.open.website")}</Link> : undefined}>
                  <Input value={v.website ?? ''} placeholder="https://…" onChange={({ detail }) => set(u, { website: detail.value || null })} />
                </FormField>
                <FormField label={uiText("utilitiesPanel.account")}>{withControls(
                  <Input value={v.account_no ?? ''} onChange={({ detail }) => set(u, { account_no: detail.value || null })} />, copyButton(v.account_no, uiText("utilitiesPanel.account")))}</FormField>
                <FormField label={uiText("utilitiesPanel.username")}>{withControls(
                  <Input value={v.login ?? ''} onChange={({ detail }) => set(u, { login: detail.value || null })} />, copyButton(v.login, uiText("utilitiesPanel.username")))}</FormField>
                <FormField label={uiText("utilitiesPanel.password")}>{withControls(
                  <Input type={showPw[u.kind] ? 'text' : 'password'} value={v.password ?? ''} onChange={({ detail }) => set(u, { password: detail.value || null })} />,
                  <SpaceBetween direction="horizontal" size="xxs">
                    {copyButton(v.password, uiText("utilitiesPanel.password"))}
                    <Button iconName={showPw[u.kind] ? 'lock-private' : 'unlocked'} ariaLabel={uiText("utilitiesPanel.show.or.hide.password")} onClick={() => setShowPw((s) => ({ ...s, [u.kind]: !s[u.kind] }))} />
                  </SpaceBetween>)}
                </FormField>
                <FormField label={uiText("utilitiesPanel.account.holder")} description={uiText("utilitiesPanel.some.properties.use.a.s.name.and.others.use")}>
                  <Input value={v.opened_under ?? ''} onChange={({ detail }) => set(u, { opened_under: detail.value || null })} />
                </FormField>
                <FormField label={uiText("utilitiesPanel.issue")} description={uiText("utilitiesPanel.what.is.pending.or.who.has.not.replied")}>
                  <Input value={v.blocker ?? ''} onChange={({ detail }) => set(u, { blocker: detail.value || null })} />
                </FormField>
              </SpaceBetween>
            </Container>
          );
        })}
      </ColumnLayout>
      <HelpText>{uiText("utilitiesPanel.credentials.follow.existing.role.permissions.verify.the.information.before")}</HelpText>
    </SpaceBetween>
  );
}
