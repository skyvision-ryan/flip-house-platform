import { localizedMetadata } from '../i18n/systemLabels.ts';
import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, Meta } from '../api/client';

const MetaContext = createContext<Meta | null>(null);

export function MetaProvider({ children }: { children: ReactNode }) {
  useLanguage();
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => { api.meta().then(value => setMeta(localizedMetadata(value))).catch(() => setMeta(null)); }, []);
  return <MetaContext.Provider value={meta}>{children}</MetaContext.Provider>;
}

export function useMeta(): Meta | null {
  return useContext(MetaContext);
}

export function labelOf(list: { value: string; label: string }[] | undefined, value: string | null | undefined): string {
  if (!value) return '—';
  return systemText(list?.find((o) => o.value === value)?.label ?? value);
}
