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

export default function SourceBadge({ source, fetchedAt, confidence, note }: { source: string; fetchedAt?: string; confidence?: number | null; note?: string | null }) {
  const meta = useMeta();
  const label = sourceLabel(source, meta?.sources);
  const badge = <Badge color="grey" style={{ root: { background: 'var(--ui-page)', color: 'var(--ui-secondary)', borderColor: 'var(--ui-border)', borderWidth: '1px', borderRadius: '4px', paddingBlock: '1px', paddingInline: '7px' } }}>{label}</Badge>;
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
            { label: '来源', value: label },
            { label: '获取时间', value: dateTime(fetchedAt) },
            { label: '把握度', value: confidence == null ? '—' : pct(confidence * 100, 0) },
            ...(note ? [{ label: '备注', value: note }] : []),
          ]}
        />
      }
    >
      {badge}
    </Popover>
  );
}
