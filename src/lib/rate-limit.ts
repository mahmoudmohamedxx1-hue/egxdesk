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
