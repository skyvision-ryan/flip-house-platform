import Badge from '@cloudscape-design/components/badge';
import Popover from '@cloudscape-design/components/popover';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import { dateTime, pct } from '../lib/format';

const LABEL: Record<string, string> = { manual: '人工', public_record: '公共记录', lark: 'Lark', model: '估算', ai: 'AI' };
// 审计 #A13：原先 manual=green、public_record=blue、model/ai=severity-low/medium，
// 拿状态色和严重度令牌表「数据来源」。来源是分类信息不是状态，一律中性；
// 来源差异靠 LABEL 的文字和下面的 Popover 说清楚。

export default function SourceBadge({ source, fetchedAt, confidence, note }: { source: string; fetchedAt?: string; confidence?: number | null; note?: string | null }) {
  const badge = <Badge color="grey">{LABEL[source] ?? source}</Badge>;
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
            { label: '来源', value: LABEL[source] ?? source },
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
