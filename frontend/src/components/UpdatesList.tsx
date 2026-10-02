import { projectUpdateText } from '../i18n/taskDisplay.ts';
import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { Update } from '../api/client';
import { RoleLabel } from './RoleLabel';

const KIND_TAB: Record<string, string> = { file: 'files', data: 'data', expense: 'budget', budget: 'budget', analysis: 'analysis', step: 'overview', project: 'overview', project_company: 'overview', utility: 'data&section=utilities', inspection: 'overview', procurement: 'procurement' };
const KIND_LABEL: Record<string, string> = { get project_company() { return uiText('company.label'); }, get file() { return uiText("updatesList.files"); }, get data() { return uiText("updatesList.data"); }, get expense() { return uiText("updatesList.expenses"); }, get budget() { return uiText("updatesList.budget"); }, get analysis() { return uiText("updatesList.analysis"); }, get step() { return uiText("updatesList.checklist"); }, get project() { return uiText("app.projects"); }, get utility() { return uiText("updatesList.utilities"); }, get inspection() { return uiText("updatesList.inspections"); }, get procurement() { return uiText("app.procurement"); } };

const dayKey = (iso: string) => iso.slice(0, 10);
const hm = (iso: string) => iso.slice(11, 16);
function dayLabel(d: string): string {
  const today = new Date(); const t = today.toISOString().slice(0, 10);
  const y = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
  if (d === t) return uiText("updatesList.today");
  if (d === y) return uiText("updatesList.yesterday");
  return d.slice(5).replace('-', '/');
}

/** 把“上传了现场照片：demo.png”拆成 动作 + 对象，对象加粗。 */
function split(text: string): { action: string; object: string | null } {
  const i = text.indexOf('：');
  if (i < 0) {
    const m = text.match(/^(.*?了)(.+)$/);
    return m ? { action: m[1], object: m[2] } : { action: text, object: null };
  }
  return { action: text.slice(0, i), object: text.slice(i + 1) };
}

/** “谁更新了什么”：按天分组。窄屏整行换行，不截断——手机上也要读得全。 */
export default function UpdatesList({ items, showProject, onGo, emptyText = '还没有更新记录。' }: { items: Update[]; showProject?: boolean; onGo: (href: string) => void; emptyText?: string }) {
  useLanguage();
  if (!items.length) return <Box color="text-body-secondary">{systemText(emptyText)}</Box>;
  const groups: { day: string; rows: Update[] }[] = [];
  for (const u of items) {
    const d = dayKey(u.created_at);
    const g = groups[groups.length - 1];
    if (g && g.day === d) g.rows.push(u); else groups.push({ day: d, rows: [u] });
  }
  return (
    <SpaceBetween size="s">
      {groups.map((g) => (
        <div key={g.day}>
          <Box variant="small" color="text-body-secondary" fontWeight="bold" margin={{ bottom: 'xxs' }}>{dayLabel(g.day)}</Box>
          {g.rows.map((u) => {
            const href = `/projects/${u.project_id}?tab=${KIND_TAB[u.kind] ?? 'overview'}`;
            const { action, object } = split(projectUpdateText(u));
            return (
              <div
                key={u.id}
                className="ui-update-row"
              >
                <Box variant="small" color="text-body-secondary">{hm(u.created_at)}</Box>
                {u.actor_name ? <Box variant="span">{u.actor_name}</Box> : <RoleLabel code={u.actor} />}
                {showProject && (
                  <Link href={href} onFollow={(e) => { e.preventDefault(); onGo(href); }}>{u.project_name ?? '—'}</Link>
                )}
                <Badge color="grey">{KIND_LABEL[u.kind] ?? u.kind}</Badge>
                <Box variant="span">
                  <Box variant="span" color="text-body-secondary">{action}{object ? '：' : ''}</Box>
                  {object && <Box variant="span" fontWeight="bold">{object}</Box>}
                </Box>
                {!showProject && (
                  <Link href={href} variant="secondary" fontSize="body-s" onFollow={(e) => { e.preventDefault(); onGo(href); }}>{uiText("updatesList.view")}</Link>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </SpaceBetween>
  );
}
