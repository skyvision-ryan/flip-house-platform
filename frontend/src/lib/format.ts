export function money(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format(v);
}

export function num(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return new Intl.NumberFormat('en-US').format(v);
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return '—';
  return `${v.toFixed(digits)}%`;
}

export function dateStr(v: string | null | undefined): string {
  if (!v) return '—';
  return v.slice(0, 10).replace(/-/g, '/');
}

export function dateTime(v: string | null | undefined): string {
  if (!v) return '—';
  return v.slice(0, 16).replace('T', ' ');
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
