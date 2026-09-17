/** T43 — SIGNAL TRACK RECORD: the proof layer for the AI signals.
 *
 *  Every signal set the pipeline publishes is persisted (AiSignalSet). This
 *  module replays those PUBLISHED picks against the real candles that came
 *  AFTER issue, so a visitor can see — with dates and numbers — what each
 *  past signal actually did: hit its target, get stopped, expire flat, or
 *  still be open. No simulation, no backfill: a signal that was never
 *  published is never tracked. The record therefore starts the day the
 *  persistence did and grows with every published set.
 *
 *  Honesty rules:
 *   - episodes are keyed to the FIRST set that carried the pick; the plan
 *     (entry/stop/target) is the plan AS ISSUED that day, never re-derived;
 *   - outcome classification uses DAILY CLOSING prints only (the same
 *     close-based math the charter uses) — intraday wicks are not in the
 *     1Y daily series and are not invented;
 *   - a ticker whose candles can't be fetched is counted as `skipped`,
 *     not silently dropped and not guessed;
 *   - old pre-T43 sets (single target) classify against that target — the
 *     ladder (T1 partial) is reported when the plan carries it. */

import { db } from "@/lib/db";
import { fetchStockChart, type ChartPoint } from "@/lib/history";

export type TrackedSignal = {
  ticker: string;
  stance: "long";
  issuedAt: string; // ISO timestamp of the first set carrying the pick
  issuedDate: string; // YYYY-MM-DD (Cairo) — the issue session
  conviction: number;
  entry: number;
  stop: number;
  target: number; // the plan at issue (T2 for ladder plans)
  hasLadder: boolean;
  lastClose: number;
  retPct: number; // (lastClose − entry) / entry × 100
  bestPct: number; // best closing print since issue
  worstPct: number; // worst closing print since issue
  sessionsElapsed: number; // trading sessions with a print after issue
  status: "target" | "stopped" | "expired" | "open";
  partialT1: boolean; // touched T1 (ladder plans) at some point
  endedDate: string | null; // the session that resolved/stopped it
};

export type TrackRecord = {
  evaluatedAt: string;
  since: string | null; // earliest issuedAt tracked
  signals: TrackedSignal[]; // newest first
  summary: {
    tracked: number;
    evaluated: number; // with candle paths
    pending: number; // issued but no forward session print yet
    skipped: number; // candle fetch failed
    hits: number; // target before stop
    stopped: number;
    expired: number;
    open: number;
    hitRate: number | null; // hits / (hits + stopped)
    avgRetPct: number | null; // closed signals only
    avgOpenRetPct: number | null; // currently-open signals
  };
};

// ── tuning ──
const MAX_SETS = 400; // rows scanned (pruning keeps ~20 + 60 daily reps)
const MAX_EPISODES = 40; // episodes surfaced
const MAX_TICKER_FETCHES = 24; // distinct candles fetched per rebuild
const EPISODE_GAP_MS = 72 * 3600_000; // absent >3 days ⇒ new episode later
const CACHE_TTL_MS = 10 * 60_000;

type SetRow = { createdAt: Date; data: string };
export type { SetRow };
type PickLite = {
  ticker: string;
  stance: "long" | "avoid";
  conviction: number;
  entry: number | null;
  stop: number | null;
  target: number | null;
  horizonSessions?: number;
  t1?: number | null;
};

function parsePicks(row: SetRow): PickLite[] {
  try {
    const d = JSON.parse(row.data) as { picks?: unknown };
    if (!Array.isArray(d.picks)) return [];
    return d.picks
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map((o) => {
        // T43 shape carries the ladder inside `plan`; pre-T43 sets carry
        // only the flat entry/stop/target — read both honestly
        const plan = (o.plan ?? null) as Record<string, unknown> | null;
        return {
          ticker: typeof o.ticker === "string" ? o.ticker : "",
          stance: o.stance === "avoid" ? "avoid" : "long",
          conviction: Math.min(5, Math.max(1, Math.round(Number(o.conviction) || 2))),
          entry: typeof o.entry === "number" ? o.entry : null,
          stop: typeof o.stop === "number" ? o.stop : null,
          target: typeof o.target === "number" ? o.target : null,
          horizonSessions: typeof o.horizonSessions === "number" ? o.horizonSessions : undefined,
          t1:
            plan && typeof plan.t1 === "number"
              ? plan.t1
              : typeof o.t1 === "number"
                ? o.t1
                : null,
        } satisfies PickLite;
      })
      .filter((p) => p.ticker !== "");
  } catch {
    return [];
  }
}

/** Cairo calendar day (YYYY-MM-DD) of an ISO instant. */
function cairoDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Minutes-since-midnight (Cairo) of an ISO instant — used to tell an
 *  intraday issue (the same session's candle is still ahead of it) from a
 *  post-close issue (the same session's candle was already in the scan). */
function cairoMinutes(d: Date): number {
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

type Episode = {
  ticker: string;
  issuedAt: Date;
  issuedDate: string;
  afterClose: boolean; // issued after that session's close (16:00 Cairo)
  conviction: number;
  entry: number;
  stop: number;
  target: number;
  t1: number | null;
  hasLadder: boolean;
  horizon: number;
  lastSeen: Date;
};

/** Build LONG episodes from the persisted sets (ascending): a pick opens an
 *  episode when its ticker reappears after ≥ EPISODE_GAP_MS away; the plan
 *  and conviction freeze at the FIRST set of the episode. Exported for the
 *  T43 test suite (pure function over rows). */
export function buildEpisodes(rows: SetRow[]): Episode[] {
  const active = new Map<string, Episode>();
  const done: Episode[] = [];
  const finish = (ep: Episode) => {
    done.push(ep);
  };
  for (const row of rows) {
    const picks = parsePicks(row);
    const seen = new Set<string>();
    for (const p of picks) {
      if (p.stance !== "long" || p.entry === null || p.stop === null || p.target === null) continue;
      seen.add(p.ticker);
      const prev = active.get(p.ticker);
      if (prev && row.createdAt.getTime() - prev.lastSeen.getTime() <= EPISODE_GAP_MS) {
        prev.lastSeen = row.createdAt; // continuation — plan stays frozen
      } else {
        if (prev) finish(prev);
        active.set(p.ticker, {
          ticker: p.ticker,
          issuedAt: row.createdAt,
          issuedDate: cairoDay(row.createdAt),
          afterClose: cairoMinutes(row.createdAt) >= 16 * 60, // session closes 14:30 Cairo
          conviction: p.conviction ?? 2,
          entry: p.entry,
          stop: p.stop,
          target: p.target,
          t1: typeof p.t1 === "number" ? p.t1 : null,
          hasLadder: typeof p.t1 === "number",
          horizon: Math.min(20, Math.max(5, Math.round(p.horizonSessions ?? 10))),
          lastSeen: row.createdAt,
        });
      }
    }
    // a pick absent from this set starts its decay clock
    for (const [tk, ep] of active) {
      if (!seen.has(tk) && row.createdAt.getTime() - ep.lastSeen.getTime() > EPISODE_GAP_MS) {
        finish(ep);
        active.delete(tk);
      }
    }
  }
  for (const ep of active.values()) finish(ep);
  return done;
}

/** Classify one episode against the candles that FOLLOW the issue. For a
 *  post-close issue (the common case) the forward path starts the NEXT
 *  session. For an intraday issue the issue session's OWN close is still
 *  ahead of the set, so that day's candle counts as the first forward print. */
export function classifyEpisode(
  ep: Episode,
  candles: ChartPoint[]
): TrackedSignal | null {
  const fwd = candles.filter(
    (c) => c.date > ep.issuedDate || (c.date === ep.issuedDate && !ep.afterClose)
  );
  if (!fwd.length) return null; // no forward print yet — pending, not skipped
  const horizonGrace = Math.round(ep.horizon * 1.5);
  let status: TrackedSignal["status"] = "open";
  let endedDate: string | null = null;
  let partialT1 = false;
  let resolved = false;
  for (const c of fwd) {
    if (c.close <= ep.stop) {
      status = "stopped";
      endedDate = c.date;
      resolved = true;
      break;
    }
    if (c.close >= ep.target) {
      status = "target";
      endedDate = c.date;
      resolved = true;
      break;
    }
    if (ep.t1 !== null && c.close >= ep.t1) partialT1 = true;
    // expiry: past the horizon grace with no resolution
    if (!resolved && status === "open" && fwd.indexOf(c) + 1 > horizonGrace) {
      status = "expired";
      endedDate = c.date;
      resolved = true;
      break;
    }
  }
  const last = fwd[fwd.length - 1];
  const retPct = Number((((last.close - ep.entry) / ep.entry) * 100).toFixed(2));
  let bestPct = -Infinity;
  let worstPct = Infinity;
  for (const c of fwd) {
    bestPct = Math.max(bestPct, ((c.close - ep.entry) / ep.entry) * 100);
    worstPct = Math.min(worstPct, ((c.close - ep.entry) / ep.entry) * 100);
  }
  return {
    ticker: ep.ticker,
    stance: "long",
    issuedAt: ep.issuedAt.toISOString(),
    issuedDate: ep.issuedDate,
    conviction: ep.conviction,
    entry: ep.entry,
    stop: ep.stop,
    target: ep.target,
    hasLadder: ep.hasLadder,
    lastClose: last.close,
    retPct,
    bestPct: Number(bestPct.toFixed(2)),
    worstPct: Number(worstPct.toFixed(2)),
    sessionsElapsed: fwd.length,
    status,
    partialT1,
    endedDate,
  };
}

// ── cache (one rebuild per 10 min, invalidated by a newer set) ──

const g = globalThis as unknown as {
  __egxTrackCache?: { at: number; newestId: string | null; record: TrackRecord };
};

export async function getTrackRecord(): Promise<TrackRecord> {
  let rows: SetRow[] = [];
  let newestId: string | null = null;
  try {
    const all = await db.aiSignalSet.findMany({
      orderBy: { createdAt: "asc" },
      take: MAX_SETS,
      select: { id: true, createdAt: true, data: true },
    });
    rows = all.map((r) => ({ createdAt: r.createdAt, data: r.data }));
    newestId = all.length ? all[all.length - 1].id : null;
  } catch {
    rows = [];
  }
  const cached = g.__egxTrackCache;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS && cached.newestId === newestId && rows.length) {
    return cached.record;
  }

  const empty: TrackRecord = {
    evaluatedAt: new Date().toISOString(),
    since: null,
    signals: [],
    summary: {
      tracked: 0, evaluated: 0, pending: 0, skipped: 0, hits: 0, stopped: 0, expired: 0, open: 0,
      hitRate: null, avgRetPct: null, avgOpenRetPct: null,
    },
  };
  if (!rows.length) {
    g.__egxTrackCache = { at: Date.now(), newestId, record: empty };
    return empty;
  }

  // newest-first episodes, capped
  const episodes = buildEpisodes(rows)
    .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())
    .slice(0, MAX_EPISODES);

  // one candle fetch per distinct ticker (bounded, cached upstream 5 min)
  const tickers = [...new Set(episodes.map((e) => e.ticker))].slice(0, MAX_TICKER_FETCHES);
  const charts = new Map<string, ChartPoint[]>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < tickers.length) {
      const t = tickers[cursor++];
      try {
        const chart = await fetchStockChart(t, "1Y");
        charts.set(t, chart.points);
      } catch {
        /* counted as skipped below */
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  };
  await Promise.all(Array.from({ length: 4 }, () => worker()));

  const signals: TrackedSignal[] = [];
  let skipped = 0;
  let pending = 0;
  for (const ep of episodes) {
    const candles = charts.get(ep.ticker);
    if (!candles) {
      skipped++;
      continue;
    }
    const t = classifyEpisode(ep, candles);
    if (t) signals.push(t);
    else pending++; // issued but the next session hasn't printed yet
  }

  const closed = signals.filter((s) => s.status === "target" || s.status === "stopped" || s.status === "expired");
  const hits = signals.filter((s) => s.status === "target").length;
  const stopped = signals.filter((s) => s.status === "stopped").length;
  const expired = signals.filter((s) => s.status === "expired").length;
  const open = signals.filter((s) => s.status === "open").length;
  const closedWithStop = hits + stopped;
  const avg = (xs: number[]) => (xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)) : null);

  const record: TrackRecord = {
    evaluatedAt: new Date().toISOString(),
    since: signals.length ? signals[signals.length - 1].issuedAt : null,
    signals,
    summary: {
      tracked: signals.length,
      evaluated: signals.length,
      pending,
      skipped,
      hits,
      stopped,
      expired,
      open,
      hitRate: closedWithStop > 0 ? Number((hits / closedWithStop).toFixed(3)) : null,
      avgRetPct: avg(closed.map((s) => s.retPct)),
      avgOpenRetPct: avg(signals.filter((s) => s.status === "open").map((s) => s.retPct)),
    },
  };
  g.__egxTrackCache = { at: Date.now(), newestId, record };
  return record;
}
