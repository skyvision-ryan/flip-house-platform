/** Match visible record values only; null is not zero or the word "null". */
export function matchesRecord(query: string, values: Array<string | number | null | undefined>): boolean {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
  const haystack = normalize(values.filter(v => v != null).join(' '));
  return normalize(query).trim().split(/\s+/).every(term => haystack.includes(term));
}
