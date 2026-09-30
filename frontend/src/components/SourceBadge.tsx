import { sourceNote } from '../i18n/sourceNotes.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import Badge from '@cloudscape-design/components/badge';
import Popover from '@cloudscape-design/components/popover';
import { dateTime, pct } from '../lib/format';
import { useMeta } from '../lib/meta';
import { sourceLabel } from '../lib/sources';
import KeyValuePairs from './ui/Facts';

// KAN-71：标签走 lib/sources 的三级回退（后端词表 → 内置表 → 原值），这里不再自己维护一张表。
// 审计 #A13：原先 manual=green、public_record=blue、model/ai=severity-low/medium，
// 拿状态色和严重度令牌表「数据来源」。来源是分类信息不是状态，一律中性；
// 来源差异靠 LABEL 的文字和下面的 Popover 说清楚。

export default function SourceBadge({ source, fetchedAt, confidence, note, note_template_snapshot }: { source: string; fetchedAt?: string; confidence?: number | null; note?: string | null; note_template_snapshot?: string | null }) {
  useLanguage();
  const meta = useMeta();
  const label = sourceLabel(source, meta?.sources);
  const badge = <Badge color="grey">{label}</Badge>;
  if (!fetchedAt && confidence == null && !note) return badge;
  return (
    <Popover
      dismissButton={false}
      position="top"
      size="medium"
      triggerType="custom"
      content={
        <KeyValuePairs
          columns={1}
          items={[
            { label: uiText("fieldWithSource.source"), value: label },
            { label: uiText("sourceBadge.retrieved.at"), value: dateTime(fetchedAt) },
            { label: uiText("fieldWithSource.confidence"), value: confidence == null ? '—' : pct(confidence * 100, 0) },
            ...(note ? [{ label: uiText("inspectionsPanel.notes"), value: sourceNote({ note, note_template_snapshot }) }] : []),
          ]}
        />
      }
    >
      {badge}
    </Popover>
  );
}
