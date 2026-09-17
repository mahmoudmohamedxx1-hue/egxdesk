"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Fetch live JSON from an API route and keep it fresh: refetches on mount,
 *  on window focus and on a fixed interval.
 *
 *  Task 20: all mounted hooks for the SAME url now share one module-level
 *  entry (in-flight dedup + a 15s result window + subscriber broadcast), so
 *  the 15+ views/hooks that poll the same routes (e.g. /api/companies,
 *  /api/overview) never fire duplicate concurrent requests — one fetch feeds
 *  every subscriber. Interval ticks and focus refreshes ride the same dedup,
 *  which silently absorbs the N-views-polling-independently problem without
 *  touching a single view. */

type Entry = {
  at: number; // last successful/failed completion time
  data: unknown;
  err: boolean;
  dataAt: number; // T41 — when the CURRENT data was actually fetched (0 = never)
  subs: Set<() => void>;
  inflight: Promise<void> | null;
};

const shared = new Map<string, Entry>();
const SHARE_TTL_MS = 15_000; // a completed result is reused for this long
const MAX_ENTRIES = 48; // bounded module cache

function entryFor(url: string): Entry {
  let e = shared.get(url);
  if (!e) {
    if (shared.size >= MAX_ENTRIES) {
      // drop the oldest entry (or one with no subscribers)
      const victim = [...shared.entries()].find(([, v]) => v.subs.size === 0) ?? [...shared.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (victim) shared.delete(victim[0]);
    }
    e = { at: 0, data: null, err: false, dataAt: 0, subs: new Set(), inflight: null };
    shared.set(url, e);
  }
  return e;
}

async function sharedRefresh(url: string): Promise<void> {
  const e = entryFor(url);
  if (e.inflight) return e.inflight; // someone else is already fetching
  const p = (async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      e.data = json;
      e.err = false;
      e.dataAt = Date.now();
    } catch {
      e.err = true;
    } finally {
      e.at = Date.now();
      e.inflight = null;
      for (const notify of e.subs) notify();
    }
  })();
  e.inflight = p;
  return p;
}

async function fetchIfStale(url: string): Promise<void> {
  const e = entryFor(url);
  if (e.inflight) return e.inflight;
  if (Date.now() - e.at < SHARE_TTL_MS) return; // fresh enough — reuse
  return sharedRefresh(url);
}

/** How long a failing feed may keep serving its last GOOD data before the
 *  views fall back to the honest error card: a brief hiccup should not blank
 *  a screen that has fresh-enough numbers; a SUSTAINED outage must never
 *  masquerade as live data. */
export const STALE_GRACE_MS = 10 * 60_000;

/** The honest-degradation rule every view shares: the feed is "dead" when it
 *  is erroring AND we have no data at all, or the last good data is older
 *  than the grace window. A brief hiccup over fresh data keeps serving. */
export function isDeadFeed(r: { error: boolean; data: unknown; staleMs: number | null }): boolean {
  if (!r.error) return false;
  if (r.data == null) return true;
  return (r.staleMs ?? Number.POSITIVE_INFINITY) > STALE_GRACE_MS;
}

export function useLiveData<T>(url: string, intervalMs = 60_000) {
  const [, setVersion] = useState(0);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    await sharedRefresh(url);
  }, [url]);

  useEffect(() => {
    mounted.current = true;
    const e = entryFor(url);
    const notify = () => {
      if (!mounted.current) return;
      setVersion((v) => v + 1); // re-render from the shared entry
      setError(e.err);
      if (e.at > 0) setLoading(false);
    };
    e.subs.add(notify);

    if (e.at > 0) {
      // warm cache from a sibling view — show it instantly, then top up
      notify();
      void fetchIfStale(url);
    } else {
      // cold — loading stays true until the first completion notifies
      void fetchIfStale(url);
    }

    const t = setInterval(() => void fetchIfStale(url), intervalMs);
    const onFocus = () => void fetchIfStale(url);
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      e.subs.delete(notify);
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [url, intervalMs]);

  const e = shared.get(url);
  return {
    data: (e?.data as T | undefined) ?? null,
    error: error || (e ? e.err : false),
    loading,
    refresh,
    /** T41 — age of the CURRENT data (ms since its successful fetch; null
     *  when never fetched). With `error`, views use it to decide between
     *  "keep serving fresh-enough data" and the honest error card. */
    staleMs: e && e.dataAt ? Date.now() - e.dataAt : null,
  };
}
