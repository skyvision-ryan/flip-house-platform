import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import Icon from '@cloudscape-design/components/icon';
import type { GroupPosition } from '../api/client';
import { useMeta } from '../lib/meta';
import { segmentsOf } from '../lib/stageGroups';
import HelpText from './HelpText';

/** 五格仅表示关键节点推进到的位置，不用时间或任务完成数推算。 */
export default function StagePositionBar({ position, compact = false }: { position: GroupPosition | null | undefined; compact?: boolean }) {
  useLanguage();
  const meta = useMeta();
  const segments = segmentsOf(meta?.stage_groups, position);
  if (!segments.length) return null;
  const stateLabel = { done: '已完成', current: '当前位置', future: '未到达', history: '录入前历史待核验' } as const;
  return <div role="group" aria-label={uiText("sentences.stage.position", { value1: (systemText(position?.label ?? '')) })} className={compact ? 'ui-stage-compact' : undefined}>
    {compact && <div className="ui-stage-position-label">{systemText(position?.label)}</div>}
    <div className={`ui-stage-segments${compact ? ' ui-stage-segments-compact' : ''}`}>
      {segments.map((s) => <div key={s.key} className={`ui-stage-segment ui-stage-${s.state}`}
        aria-current={s.state === 'current' ? 'step' : undefined}
        title={`${systemText(s.label)}: ${systemText(stateLabel[s.state])}${s.note ? ` · ${s.note}` : ''}`}>
        <div className="ui-stage-rail" role="img" aria-label={`${systemText(s.label)}: ${systemText(stateLabel[s.state])}`} />
        {!compact && <>
          <div className="ui-stage-label">
            <span className="ui-stage-number" aria-hidden="true">{s.state === 'done' ? <Icon name="check" size="small" /> : s.index}</span>
            <span>{systemText(s.label)}</span>
            {s.state === 'current' && <span className="ui-stage-current-label">{uiText("stagePositionBar.current")}</span>}
          </div>
          {s.note && <div className="ui-stage-note">{systemText(s.note)}</div>}
        </>}
      </div>)}
    </div>
    {!compact && <HelpText>{uiText("stagePositionBar.light.blue.marks.passed.stages.dark.blue.marks.the")}</HelpText>}
  </div>;
}
