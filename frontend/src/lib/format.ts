import { m as uiText, language } from '../i18n/core.ts';
export function money(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return new Intl.NumberFormat(language() === 'en' ? 'en-US' : 'zh-CN', { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format(v);
}

export function num(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return new Intl.NumberFormat(language() === 'en' ? 'en-US' : 'zh-CN').format(v);
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return '—';
  return `${v.toFixed(digits)}%`;
}

export function dateStr(v: string | null | undefined): string {
  if (!v) return '—';
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!day) return v;
  if (language() !== 'en') return v.slice(0, 10).replace(/-/g, '/');
  // Date-only business facts are calendar dates, never instants converted to LA.
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]))));
}

export function dateTime(v: string | null | undefined): string {
  if (!v) return '—';
  // Historical naive timestamps retain their recorded wall-clock time.
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(v)) return `${dateStr(v)} ${v.slice(11, 16)}`.trim();
  const instant = new Date(v);
  if (!Number.isFinite(instant.getTime())) return v;
  return new Intl.DateTimeFormat(language() === 'en' ? 'en-US' : 'zh-CN', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(instant);
}

export function text(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

/** 两个 YYYY-MM-DD 之间差几天；任一为空返回 null。工期条和项目头卡共用。 */
export function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);
}

/** Required amount input: blank is unknown; zero remains an explicit amount. */
export function requiredNumberError(value: string): string | undefined {
  if (!value.trim()) return uiText("format.enter.an.amount.enter.0.only.for.a.known");
  if (!Number.isFinite(Number(value))) return uiText("format.enter.a.valid.number");
}
