/** Shared in-memory sliding-window rate limiter (per key, usually an IP).
 *  Good enough for a personal tool's secondary routes; it resets on process
 *  restart — the agent route's primary limit is persisted in SQLite
 *  (UsageEvent), this module is the lightweight option for everything else. */

export function makeRateLimiter(limit: number, windowMs: number) {
  const map = new Map<string, number[]>();
  return function limited(key: string): boolean {
    const now = Date.now();
    const arr = (map.get(key) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) {
      map.set(key, arr);
      return true;
    }
    arr.push(now);
    map.set(key, arr);
    // drop stale entries so the map can never grow unbounded
    if (map.size > 500) {
      for (const [k, v] of map) if (v.every((t) => now - t >= windowMs)) map.delete(k);
    }
    return false;
  };
}

/** T48 — failure lockout with PEEK vs RECORD separated: `locked(key)` only
 *  checks (no side effects, so a route can gate on it before doing work),
 *  `record(key)` counts one failure. Used by the verify route to stop code
 *  guessing per mailbox: 5 wrong codes → 15-minute lockout for that mailbox. */
export function makeFailureLockout(limit: number, windowMs: number) {
  const map = new Map<string, number[]>();
  function locked(key: string): boolean {
    const now = Date.now();
    const arr = (map.get(key) ?? []).filter((t) => now - t < windowMs);
    map.set(key, arr);
    if (map.size > 500) {
      for (const [k, v] of map) if (v.every((t) => now - t >= windowMs)) map.delete(k);
    }
    return arr.length >= limit;
  }
  function record(key: string): void {
    const now = Date.now();
    const arr = (map.get(key) ?? []).filter((t) => now - t < windowMs);
    arr.push(now);
    map.set(key, arr);
  }
  return { locked, record };
}
