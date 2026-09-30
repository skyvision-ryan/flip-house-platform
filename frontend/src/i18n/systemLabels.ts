import { systemText } from './core.ts';
/** Stable, read-only facade over system metadata. Values/codes and object identity
 * stay unchanged across language switches, so metadata effects never reload data. */
export function localizedMetadata<T extends object>(source: T): T {
  const cache = new WeakMap<object, object>();
  const labels = new Set(['label', 'short', 'title', 'duties', 'purpose', 'completion_rule', 'instructions', 'evidence_hint', 'done_when', 'desc']);
  function wrap<O extends object>(object: O): O {
    const cached = cache.get(object); if (cached) return cached as O;
    const proxy = new Proxy(object, { get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value === 'string' && labels.has(String(key))) return systemText(value);
      if (value && typeof value === 'object') return wrap(value);
      return value;
    } });
    cache.set(object, proxy); return proxy;
  }
  return wrap(source);
}
