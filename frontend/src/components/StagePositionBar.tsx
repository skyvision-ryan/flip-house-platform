import Box from '@cloudscape-design/components/box';
import Icon from '@cloudscape-design/components/icon';
import type { GroupPosition } from '../api/client';
import { useMeta } from '../lib/meta';
import { segmentsOf } from '../lib/stageGroups';
import { BORDER, ORDINAL_BLUE, SURFACE, TEXT, TEXT_2, track } from './charts/palette';

/**
 * 五格位置条（KAN-75 块 2，目标图 04–09 头卡下那一条）。
 * 只表「这套房走到哪一格」：已过的格带勾、当前格加深、后面的浅灰。没有百分比、没有 n/m。
 * 买房格里再写子位置（未购入 · 已出价 / escrow 中 · 过门前档位）。位置只由后端 group_position 决定。
 * 色值全部来自设计令牌（palette.ts），本文件不出现裸色。
 */
export default function StagePositionBar({ position, compact = false }: { position: GroupPosition | null | undefined; compact?: boolean }) {
  const meta = useMeta();
  const segments = segmentsOf(meta?.stage_groups, position);
  if (!segments.length) return null;
  const fill = { done: ORDINAL_BLUE[1], current: ORDINAL_BLUE[4], future: track(BORDER, 35) } as const;
  const ink = { done: SURFACE, current: SURFACE, future: TEXT_2 } as const;
  if (compact) {
    // 表格里的紧凑形态：一行文字说位置，下面一条五格细条只表「走到第几格」，不放文字
    return (
      <div role="group" aria-label={`阶段位置：${position?.label ?? ''}`} title={segments.map((s) => `${s.index} ${s.label}${s.note ? `（${s.note}）` : ''}`).join(' → ')}>
        <div style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{position?.label}</div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${segments.length}, 1fr)`, gap: 2, marginTop: 4 }}>
          {segments.map((s) => <div key={s.key} style={{ height: 5, borderRadius: 2, background: fill[s.state], border: s.state === 'future' ? `1px solid ${BORDER}` : '1px solid transparent' }} />)}
        </div>
      </div>
    );
  }
  return (
    <div role="group" aria-label={`阶段位置：${position?.label ?? ''}`}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))`, gap: 4 }}>
        {segments.map((s) => (
          <div
            key={s.key}
            aria-current={s.state === 'current' ? 'step' : undefined}
            title={s.note ? `${s.label}：${s.note}` : s.label}
            style={{
              background: fill[s.state], color: ink[s.state], borderRadius: 4,
              border: s.state === 'future' ? `1px solid ${BORDER}` : '1px solid transparent',
              padding: '6px 10px', minWidth: 0, overflow: 'hidden',
              fontWeight: s.state === 'current' ? 700 : 500, fontSize: 13, lineHeight: 1.3,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.state === 'done' && <Icon name="check" size="small" variant="inverted" />}
              <span style={{ opacity: s.state === 'future' ? 0.85 : 1 }}>{s.index} {s.label}</span>
              {s.state === 'current' && <span style={{ fontWeight: 500, fontSize: 11, border: `1px solid ${SURFACE}`, borderRadius: 999, padding: '0 6px' }}>当前</span>}
            </div>
            {s.note && <div style={{ fontWeight: 400, fontSize: 12, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: s.state === 'future' ? TEXT_2 : SURFACE }}>{s.note}</div>}
          </div>
        ))}
      </div>
      {<Box variant="small" color="text-body-secondary" margin={{ top: 'xxs' }}><span style={{ color: TEXT }}>阶段位置</span>，只由关键节点推进，不代表任务完成比例。</Box>}
    </div>
  );
}
