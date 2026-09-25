import Icon from '@cloudscape-design/components/icon';
import type { GroupPosition } from '../api/client';
import { useMeta } from '../lib/meta';
import { segmentsOf } from '../lib/stageGroups';
import HelpText from './HelpText';

/** 五格仅表示关键节点推进到的位置，不用时间或任务完成数推算。 */
export default function StagePositionBar({ position, compact = false }: { position: GroupPosition | null | undefined; compact?: boolean }) {
  const meta = useMeta();
  const segments = segmentsOf(meta?.stage_groups, position);
  if (!segments.length) return null;
  const stateLabel = { done: '已完成', current: '当前位置', future: '未到达' } as const;
  return <div role="group" aria-label={`阶段位置：${position?.label ?? ''}`} className={compact ? 'ui-stage-compact' : undefined}>
    {compact && <div className="ui-stage-position-label">{position?.label}</div>}
    <div className={`ui-stage-segments${compact ? ' ui-stage-segments-compact' : ''}`}>
      {segments.map((s) => <div key={s.key} className={`ui-stage-segment ui-stage-${s.state}`}
        aria-current={s.state === 'current' ? 'step' : undefined}
        title={`${s.label}：${stateLabel[s.state]}${s.note ? ` · ${s.note}` : ''}`}>
        <div className="ui-stage-rail" role="img" aria-label={`${s.label}：${stateLabel[s.state]}`} />
        {!compact && <>
          <div className="ui-stage-label">
            <span className="ui-stage-number" aria-hidden="true">{s.state === 'done' ? <Icon name="check" size="small" /> : s.index}</span>
            <span>{s.label}</span>
            {s.state === 'current' && <span className="ui-stage-current-label">当前</span>}
          </div>
          {s.note && <div className="ui-stage-note">{s.note}</div>}
        </>}
      </div>)}
    </div>
    {!compact && <HelpText>浅蓝表示已完成，深蓝表示当前位置，灰色表示未到达。位置由关键节点推进，不代表任务完成比例。</HelpText>}
  </div>;
}
