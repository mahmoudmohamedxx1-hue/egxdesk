/** T26 — self-collected intraday ticks for the 1D / 1W chart timeframes.
 *
 *  No free data source serves true EGX intraday candles: Yahoo Finance
 *  answers intraday queries with ONE stamped bar per day (the session
 *  summary), and TradingView's public scanner exposes only the live quote.
 *  So the desk samples the live (~15-min delayed) TradingView universe
 *  itself — one scanner call covers the whole exchange — every ~5 minutes
 *  while the EGX session is open, and persists the ticks to SQLite.
 *
 *  Sampling is LAZY and debounced: any request to /api/chart (or the
 *  overview) calls sampleIfDue(); if the market is open and the last sample
 *  is older than SAMPLE_EVERY_MS, one universe fetch fans out into a
 *  createMany of ~295 ticks. No cron, no background process required.
 *
 *  Reads diff the cumulative session volume into per-bar volume so the
 *  chart's volume histogram looks like a real intraday tape. Until the
 *  first sessions are collected (weekend, cold deploy), the chart route
 *  falls back to daily candles with an honest source label.
 */

import { db } from "./db";
import { fetchUniverse } from "./market";
import { marketStatus } from "./market-status";

const SAMPLE_EVERY_MS = 4 * 60 * 1000; // ~5-minute buckets once latency lands

type SamplerState = { lastAt: number; inflight: Promise<void> | null };
const globalForSampler = globalThis as unknown as { egxIntradaySampler?: SamplerState };
const state: SamplerState = (globalForSampler.egxIntradaySampler ??= { lastAt: 0, inflight: null });

/** Cairo-time "YYYY-MM-DD HH:MM" bucket key for a wall-clock Date. */
function cairoMinuteKey(d = new Date()): string {
  const cairo = new Date(d.getTime() + 3 * 3600 * 1000); // Africa/Cairo = UTC+3, no DST
  return cairo.toISOString().slice(0, 16).replace("T", " ");
}

/** Take one universe snapshot into the tick store (idempotent per minute). */
async function sampleOnce(): Promise<void> {
  const minuteKey = cairoMinuteKey();
  const universe = await fetchUniverse();
  const rows = universe
    .filter((s) => s.close > 0 && s.ticker)
    .map((s) => ({
      ticker: s.ticker,
      minuteKey,
      close: s.close,
      volume: s.volume > 0 ? s.volume : null,
      changePct: Number.isFinite(s.changePct) ? s.changePct : null,
    }));
  if (!rows.length) return;
  // SQLite does not support createMany(skipDuplicates) — diff against what
  // the minute bucket already holds and insert only the new tickers.
  const existing = await db.intradayTick.findMany({ where: { minuteKey }, select: { ticker: true } });
  const have = new Set(existing.map((e) => e.ticker));
  const fresh = rows.filter((r) => !have.has(r.ticker));
  if (fresh.length) await db.intradayTick.createMany({ data: fresh });
  // prune: keep a rolling ~2 weeks of calendar time (sessions beyond the
  // 5-session chart window are never read)
  try {
    await db.intradayTick.deleteMany({ where: { ts: { lt: new Date(Date.now() - 16 * 24 * 3600 * 1000) } } });
  } catch {
    /* prune is best-effort */
  }
}

/** Lazy, debounced sampler — call it from hot read routes. Never throws. */
export function sampleIfDue(): void {
  const status = marketStatus();
  if (!status.open) return; // only sample while the session is live
  if (Date.now() - state.lastAt < SAMPLE_EVERY_MS) return;
  if (state.inflight) return;
  state.lastAt = Date.now();
  state.inflight = (async () => {
    try {
      await sampleOnce();
    } catch (err) {
      console.error("intraday: sample failed", err);
      // allow a retry sooner than the full interval on failure
      state.lastAt = Date.now() - SAMPLE_EVERY_MS + 60_000;
    } finally {
      state.inflight = null;
    }
  })();
}

export type IntradayPoint = {
  date: string; // "YYYY-MM-DD HH:MM" (Cairo)
  close: number;
  volume: number | null; // per-bar (diffed) volume
};

/** Ticks for the last `sessions` distinct collected sessions, oldest →
 *  newest. Returns [] when nothing has been collected yet. */
export async function intradayPoints(ticker: string, sessions: number): Promise<IntradayPoint[]> {
  const t = ticker.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const all = await db.intradayTick.findMany({
    where: { ticker: t },
    orderBy: { minuteKey: "asc" },
    select: { minuteKey: true, close: true, volume: true },
  });
  if (!all.length) return [];
  const dates = Array.from(new Set(all.map((r) => r.minuteKey.slice(0, 10)))); // ascending already
  const keep = new Set(dates.slice(-sessions));
  const rows = all.filter((r) => keep.has(r.minuteKey.slice(0, 10)));
  // diff cumulative volume → per-bar volume (session boundary resets)
  const out: IntradayPoint[] = [];
  let prevVol: number | null = null;
  let prevDate = "";
  for (const r of rows) {
    const day = r.minuteKey.slice(0, 10);
    const vol = r.volume ?? null;
    let barVol: number | null = null;
    if (vol !== null && vol >= 0) {
      barVol = prevVol !== null && day === prevDate && vol >= prevVol ? vol - prevVol : vol;
    }
    out.push({ date: r.minuteKey, close: r.close, volume: barVol });
    prevVol = vol;
    prevDate = day;
  }
  return out;
}

/** How many distinct sessions the tick store currently holds (for labels). */
export async function intradaySessionsCollected(): Promise<number> {
  const rows = await db.intradayTick.findMany({ select: { minuteKey: true }, distinct: ["minuteKey"] });
  return new Set(rows.map((r) => r.minuteKey.slice(0, 10))).size;
}
