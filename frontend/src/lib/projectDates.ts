/** Explicit offsets only. Historical naive wall clocks have no provable instant. */
const dayFormat = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles', year:'numeric', month:'2-digit', day:'2-digit'});
export function businessDate(now: number | Date = Date.now()): string { return dayFormat.format(now); }
export function creationInstant(value: string | null | undefined): number | null {
  if (!value || !/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : null;
}
export function isNewToday(value: string | null | undefined, day = businessDate()): boolean {
  const time = creationInstant(value);
  return time != null && businessDate(time) === day;
}
export function compareNewToday(a: {id:number; created_at:string; updated_at:string}, b: {id:number; created_at:string; updated_at:string}, day = businessDate()): number {
  const x = isNewToday(a.created_at, day), y = isNewToday(b.created_at, day);
  if (x !== y) return x ? -1 : 1;
  if (x) return creationInstant(b.created_at)! - creationInstant(a.created_at)! || b.id - a.id;
  return b.updated_at.localeCompare(a.updated_at);
}
export function prioritizeToday<T extends {created_at?: string}>(rows: readonly T[], id: (row:T)=>number, day = businessDate()): T[] {
  return [...rows].sort((a,b) => {
    const x = isNewToday(a.created_at, day), y = isNewToday(b.created_at, day);
    return x !== y ? (x ? -1 : 1) : x ? creationInstant(b.created_at)! - creationInstant(a.created_at)! || id(b)-id(a) : 0;
  });
}
export function projectListReturnPath(value: string | null, focus?: number): string {
  const query = value?.startsWith('/projects?') ? value.slice('/projects?'.length) : '';
  const params = new URLSearchParams(query);
  if (focus != null) params.set('focus', String(focus));
  return `/projects${params.size ? `?${params}` : ''}`;
}
