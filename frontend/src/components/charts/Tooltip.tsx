import { ReactNode, useCallback, useRef, useState } from 'react';
import { BORDER, FONT, SHADOW, SURFACE, TEXT, TEXT_2 } from './palette';

export interface TipRow { label: string; value: string; color?: string }
interface TipState { x: number; y: number; title?: string; rows: TipRow[] }

/**
 * 图表悬停读数。数值是主角（加粗、主文本色），系列名是次要信息；系列用一小段色线标识。
 * 用法：const tip = useTooltip(); 在相对定位的容器里渲染 {tip.node}，在标记上 onMouseMove={(e)=>tip.show(e, …)} onMouseLeave={tip.hide}
 */
export function useTooltip() {
  const [state, setState] = useState<TipState | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const show = useCallback((e: React.MouseEvent, rows: TipRow[], title?: string) => {
    const host = ref.current?.parentElement;
    const rect = host?.getBoundingClientRect();
    const x = rect ? e.clientX - rect.left : e.clientX;
    const y = rect ? e.clientY - rect.top : e.clientY;
    setState({ x, y, rows, title });
  }, []);
  const hide = useCallback(() => setState(null), []);

  const node: ReactNode = (
    <div ref={ref} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden>
      {state && (
        <div
          style={{
            position: 'absolute', left: state.x + 12, top: state.y - 8, transform: 'translateY(-100%)',
            background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: SHADOW,
            padding: '8px 12px', fontFamily: FONT, fontSize: 13, color: TEXT, whiteSpace: 'nowrap', zIndex: 5, minWidth: 120,
          }}
        >
          {state.title && <div style={{ color: TEXT_2, marginBottom: 4 }}>{state.title}</div>}
          {state.rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: '18px' }}>
              {r.color && <span style={{ width: 12, height: 2, background: r.color, borderRadius: 1, flexShrink: 0 }} />}
              <span style={{ fontWeight: 700 }}>{r.value}</span>
              <span style={{ color: TEXT_2 }}>{r.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  return { show, hide, node };
}
