import type { CSSProperties, ReactNode } from 'react';

type Fact = { label: ReactNode; value: ReactNode; span?: number };
/** 按卡片实际宽度排列，不用窗口宽度把 292px 摘要挤成两列。 */
export default function Facts({ items, columns = 2, layout = 'grid' }: { items: Fact[]; columns?: number; layout?: 'grid' | 'rows' }) {
  return <dl className={`ui-facts${layout === 'rows' ? ' ui-facts-list' : ''}`} style={{ '--fact-columns': columns, '--fact-narrow-columns': Math.min(columns, 2) } as CSSProperties}>
    {items.map((item, index) => <div key={index} className="ui-fact" style={item.span ? { gridColumn: '1 / -1' } : undefined}>
      <dt>{item.label}</dt><dd>{item.value}</dd>
    </div>)}
  </dl>;
}
