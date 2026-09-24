import { createContext, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CARD_REGISTRY, cardFeedback, type CardKey } from '../lib/cardRegistry';

export const ReviewContext = createContext(false);
export const useReviewOn = () => useContext(ReviewContext);

/** 编号属于组件，不属于渲染顺序。路由和对象上下文区分重复实例。 */
export default function ReviewTag({ cardId, context }: { cardId: CardKey; context?: string }) {
  const on = useReviewOn();
  const location = useLocation();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setCopied(false); setFailed(false); }, [cardId, context, location.pathname, location.search]);
  if (!on) return null;
  const card = CARD_REGISTRY[cardId];
  const label = `#${String(card.id).padStart(2, '0')}`;
  const feedback = cardFeedback(cardId, location.pathname, location.search, context);
  return <div className="ui-card-ref" data-card-reference={card.id} onClick={(e) => e.stopPropagation()}>
    <span className="ui-card-ref-name">{card.title}{context ? ` · ${context}` : ''}</span>
    <button type="button" title={feedback} aria-label={`复制卡片 ${label} 的反馈位置`} onClick={async (e) => {
      e.stopPropagation();
      try { await navigator.clipboard.writeText(feedback); setCopied(true); setFailed(false); }
      catch { setCopied(false); setFailed(true); }
    }}>{label} · {copied ? '已复制' : '复制位置'}</button>
    {failed && <span role="status">无法复制，请记录 {label} 与当前页面地址。</span>}
    <span className="ui-sr-only" role="status">{copied ? '反馈位置已复制' : ''}</span>
  </div>;
}
