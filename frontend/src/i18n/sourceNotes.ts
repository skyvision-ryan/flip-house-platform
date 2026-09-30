import { systemText } from './core.ts';
/** Only auto-generated source explanations have a snapshot. Employee source notes stay original. */
export function sourceNote(source: { note?: string | null; note_template_snapshot?: string | null } | undefined): string | null | undefined {
  return source?.note && source.note === source.note_template_snapshot ? systemText(source.note) : source?.note;
}
