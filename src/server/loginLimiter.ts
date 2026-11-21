export const MAX_FAILURES = 5;
export const WINDOW_MS = 10 * 60 * 1000;

// In-memory failure counter per key (we use "email:..." and "ip:..."). The clock is injected so tests need no real waiting.
// ponytail: per process and lost on restart; move to a DB table if the app ever runs on several servers.
export function createLimiter(now: () => number = Date.now, max = MAX_FAILURES, windowMs = WINDOW_MS) {
  const hits = new Map<string, number[]>();
  const recent = (key: string) => {
    const t = (hits.get(key) ?? []).filter((at) => now() - at < windowMs);
    if (t.length) hits.set(key, t);
    else hits.delete(key);
    return t;
  };
  return {
    isLocked: (key: string) => recent(key).length >= max,
    // Records one failure and returns how many are in the window.
    fail(key: string) {
      const t = recent(key);
      t.push(now());
      hits.set(key, t);
      if (hits.size > 10_000) for (const k of [...hits.keys()]) recent(k); // sweep so junk emails cannot grow the map forever
      return t.length;
    },
    clear: (key: string) => void hits.delete(key),
  };
}
export type Limiter = ReturnType<typeof createLimiter>;
