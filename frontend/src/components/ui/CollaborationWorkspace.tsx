import { type ReactNode, useEffect, useRef } from 'react';
import Button from '@cloudscape-design/components/button';

/** Continuous list/detail surface. On narrow screens selecting a task opens its detail. */
export default function CollaborationWorkspace({ main, detail, processing = false, detailOpen, onBack, backLabel = '返回任务列表' }: {
  main: ReactNode; detail: ReactNode; processing?: boolean; detailOpen?: boolean; onBack?: () => void; backLabel?: string;
}) {
  const detailRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const canGoBack = !!onBack;
  useEffect(() => {
    if (detailOpen && canGoBack) {
      lastFocus.current = document.activeElement as HTMLElement;
      if (detailRef.current && getComputedStyle(mainRef.current!).display === 'none') {
        // Leave room for the sticky product header and Cloudscape's mobile toolbar.
        detailRef.current.style.scrollMarginTop = `${(document.getElementById('top-nav')?.getBoundingClientRect().height ?? 100) + 64}px`;
        detailRef.current.focus({ preventScroll: true });
        detailRef.current.scrollIntoView({ block: 'start' });
      }
    }
  }, [detailOpen, canGoBack]);
  const back = () => { onBack?.(); requestAnimationFrame(() => lastFocus.current?.focus()); };
  return <div className="ui-workspace-scope"><div className={`ui-workspace${processing ? ' ui-workspace-processing' : ''}`} data-detail-open={!!detailOpen} data-mobile-detail={!!onBack}>
    <div className="ui-workspace-main" ref={mainRef}>{main}</div>
    <aside className="ui-workspace-detail" ref={detailRef} tabIndex={-1} aria-label={processing ? '事项处理' : '摘要'}>
      {onBack && <div className="ui-workspace-back"><Button iconName="arrow-left" onClick={back}>{backLabel}</Button></div>}
      {detail}
    </aside>
  </div></div>;
}
