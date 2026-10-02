import Link from '@cloudscape-design/components/link';
import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';

/** Merchant product image by URL only. Never a receiving voucher; a blocked or broken image falls back to a plain link. */
export default function ProductThumb({ src, label }: { src: string | null | undefined; label: string }) {
  useLanguage();
  const [failed, setFailed] = useState(false);
  if (!src) return null;
  if (failed) return <Link external href={src}>{uiText("purchaseOrders.product.image")}</Link>;
  return <a className="proc-line-thumb" href={src} target="_blank" rel="noreferrer" aria-label={uiText("purchaseOrders.view.product.image", { value1: label })}>
    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  </a>;
}
