import Box from '@cloudscape-design/components/box';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { Submission } from '../api/client';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText, systemText } from '../i18n/core';
import { dateTime } from '../lib/format';
import ExpandableSection from './ui/ExpandableSection';
export default function SubmissionList({ subs }: { subs: Submission[] }) {
  useLanguage();
  if (!subs.length) return null;
  return (
    <ExpandableSection headerText={uiText("sentences.submissions", { value1: (subs.length) })} variant="footer" defaultExpanded={subs.length <= 2}>
      <SpaceBetween size="s">
        {subs.map((s) => (
          <div key={s.id} className="ui-submission">
            <div><Box variant="span" fontWeight="bold">{uiText("taskWorkbench.number")} {s.seq} {uiText("taskWorkbench.attempts")}</Box>　<StatusIndicator type={s.decision === 'confirmed' ? 'success' : s.decision === 'returned' ? 'error' : 'pending'}>{systemText(s.decision_label)}</StatusIndicator></div>
            <Box variant="small" color="text-body-secondary">{s.submitted_by?.display_name ?? '—'} · {dateTime(s.submitted_at)}{s.note ? ` · ${s.note}` : ''}</Box>
            {s.files.length > 0 && <Box variant="small">{s.files.map((f) => <span key={f.id} className="ui-file-link"><Link href={`/api/files/${f.id}/download`} external>{f.filename}</Link></span>)}</Box>}
            {s.decision !== 'pending' && <Box variant="small" color="text-body-secondary">{s.decided_by?.display_name ?? '—'} · {dateTime(s.decided_at)}{s.decision_reason ? `：${s.decision_reason}` : ''}</Box>}
          </div>
        ))}
      </SpaceBetween>
    </ExpandableSection>
  );
}
