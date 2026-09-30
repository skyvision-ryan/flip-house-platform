import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import { createContext, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CARD_REGISTRY, cardFeedback, type CardKey } from '../lib/cardRegistry';

export const ReviewContext = createContext(false);
export const useReviewOn = () => useContext(ReviewContext);

/** 编号属于组件，不属于渲染顺序。路由和对象上下文区分重复实例。 */
export default function ReviewTag({ cardId, context }: { cardId: CardKey; context?: string }) {
  useLanguage();
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
    <button type="button" title={systemText(feedback)} aria-label={uiText("sentences.copy.feedback.location.for.card", { value1: (label) })} onClick={async (e) => {
      e.stopPropagation();
      try { await navigator.clipboard.writeText(feedback); setCopied(true); setFailed(false); }
      catch { setCopied(false); setFailed(true); }
    }}>{label} · {copied ? uiText("reviewTag.copied") : uiText("reviewTag.copy.location")}</button>
    {failed && <span role="status">{uiText("reviewTag.cannot.copy.record")} {label} {uiText("reviewTag.and.the.current.page.address")}</span>}
    <span className="ui-sr-only" role="status">{copied ? uiText("reviewTag.feedback.location.copied") : ''}</span>
  </div>;
}
