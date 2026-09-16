/** Server-side price-history layer — REAL daily/weekly candles for every EGX
 *  listed stock, fetched from Yahoo Finance's public chart API (symbols use
 *  the Cairo exchange suffix ".CA"). No API key, no auth, EGP-denominated.
 *
 *  Index history (EGX30 / EGX70 / EGX100) is NOT served by Yahoo (only the
 *  latest point), so indices come from the EGXBot-derived IndexDay table —
 *  see flows.ts.
 */

import { fetchUniverse, type Stock } from "./market";
import { marketStatus } from "./market-status";
import { historySymbol } from "./ticker-aliases";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export type ChartRange = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "5Y";

export const CHART_RANGES: ChartRange[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "5Y"];

const RANGE_MAP: Record<ChartRange, { yahoo: string; interval: string; maxDays: number }> = {
  // T26 — intraday timeframes: 1D = today's session in 5-minute bars,
  // 1W = the last five sessions in 15-minute bars (the most visible
  // charting gap vs TradingView/Yahoo, closed at zero data cost).
  "1D": { yahoo: "1d", interval: "5m", maxDays: 1 },
  "1W": { yahoo: "5d", interval: "15m", maxDays: 7 },
  "1M": { yahoo: "1mo", interval: "1d", maxDays: 31 },
  "3M": { yahoo: "3mo", interval: "1d", maxDays: 95 },
  "6M": { yahoo: "6mo", interval: "1d", maxDays: 190 },
  "1Y": { yahoo: "1y", interval: "1d", maxDays: 380 },
  "5Y": { yahoo: "5y", interval: "1wk", maxDays: 1900 },
};

export type ChartPoint = { date: string; close: number; volume: number | null; high?: number | null; low?: number | null; live?: boolean };

export type StockChart = {
  symbol: string; // plain ticker, e.g. COMI
  yahooSymbol: string; // COMI.CA
  range: ChartRange;
  currency: string;
  points: ChartPoint[];
  first: number | null;
  last: number | null;
  high: number | null;
  low: number | null;
  changePct: number | null; // over the shown window
  source: string;
  asOf: string; // last data date
  /** T27 — true when the series is a milestone reconstruction (no free
   *  daily history exists for the name); the UI labels it honestly. */
  milestones?: boolean;
  /** 52-week levels shown as dashed reference lines (milestone mode). */
  refHigh?: number | null;
  refLow?: number | null;
};

// ─────────────────────────────────────────────────────────── caching ───

type Entry = { data: unknown; at: number };
const cache = new Map<string, Entry>();
const stale = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const flying = inflight.get(key);
  if (flying) return flying as Promise<T>;
  const p = (async () => {
    try {
      const data = await loader();
      cache.set(key, { data, at: Date.now() });
      stale.set(key, { data, at: Date.now() });
      return data;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  try {
    return await p;
  } catch (err) {
    const s = stale.get(key);
    if (s) return s.data as T;
    throw err;
  }
}

// ─────────────────────────────────────────────────────────── parsing ───

function toDate(tsSec: number): string {
  // Yahoo timestamps are UTC; shift to the exchange's Cairo day so the
  // daily candle is labelled with the session date (EGX closes 14:30 Cairo).
  const cairo = new Date((tsSec + 3 * 3600) * 1000); // Africa/Cairo = UTC+3 (no DST)
  return cairo.toISOString().slice(0, 10);
}

/** Intraday bar label: "YYYY-MM-DD HH:mm" in Cairo time — the date part
 *  keeps the series sortable and dedup-able, the time part makes each
 *  5m/15m bar its own point. */
function toDateTime(tsSec: number): string {
  const cairo = new Date((tsSec + 3 * 3600) * 1000);
  return cairo.toISOString().slice(0, 16).replace("T", " ");
}

type YahooChart = {
  chart?: {
    result?: {
      meta?: { symbol?: string; currency?: string; previousClose?: number };
      timestamp?: number[];
      indicators?: {
        quote?: { close?: (number | null)[]; volume?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[] }[];
      };
    }[];
    error?: { description?: string };
  };
};

export async function fetchStockChart(ticker: string, range: ChartRange): Promise<StockChart> {
  // T38 — the aliased Reuters tickers (NAPR, MKIT…) are OUR canonical ids,
  // but Yahoo's EGX history serves those names under the ISIN symbol —
  // historySymbol() maps back (and passes everything else through). The
  // response still reports the REQUESTED ticker as `symbol`.
  const req = ticker.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const t = historySymbol(req);
  if (!req) throw new Error("history: empty ticker");
  const cfg = RANGE_MAP[range];
  const intraday = cfg.interval !== "1d" && cfg.interval !== "1wk";
  // intraday windows move with the tape while the market is open — cache
  // them for one minute instead of five
  return cached(`chart:${t}:${range}`, intraday ? 60_000 : 300_000, async () => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(`${t}.CA`)}?range=${cfg.yahoo}&interval=${cfg.interval}&includePrePost=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 404) throw new Error("history: symbol not on Yahoo");
    if (!res.ok) throw new Error(`yahoo chart ${res.status}`);
    const json = (await res.json()) as YahooChart;
    const r = json.chart?.result?.[0];
    if (!r || !r.timestamp?.length) throw new Error("history: no candles");
    const closes = r.indicators?.quote?.[0]?.close ?? [];
    const volumes = r.indicators?.quote?.[0]?.volume ?? [];
    const highs = r.indicators?.quote?.[0]?.high ?? [];
    const lows = r.indicators?.quote?.[0]?.low ?? [];
    const points: ChartPoint[] = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      const c = closes[i];
      if (typeof c !== "number" || !Number.isFinite(c)) continue;
      const v = volumes[i];
      const h = highs[i];
      const l = lows[i];
      points.push({
        date: intraday ? toDateTime(r.timestamp[i]) : toDate(r.timestamp[i]),
        close: c,
        volume: typeof v === "number" && Number.isFinite(v) ? v : null,
        high: typeof h === "number" && Number.isFinite(h) && h >= c ? h : null,
        low: typeof l === "number" && Number.isFinite(l) && l <= c ? l : null,
      });
    }
    // keep only the last point per date key (guards duplicate rows — for
    // intraday the key carries the bar time so every bar survives)
    const byDate = new Map<string, ChartPoint>();
    for (const p of points) byDate.set(p.date, p);
    const final = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (final.length < 2) throw new Error("history: not enough candles");

    // Task 23 fix — Yahoo routinely publishes the latest EGX session with a
    // NULL close for hours after the EGX close (null candles are dropped
    // above), so charts, technical panels and signals all ended a session
    // behind the live quote header. When the candle series lags the last
    // real session, splice the live TradingView close as a final "live"
    // candle: after close it IS the session's final print; intraday it moves
    // with the tape. DAILY/WEEKLY only — the intraday series already updates
    // in real time and a daily-style spliced point would collide with the
    // last live bar. Implemented HERE so every consumer (chart route,
    // technical panel, signals scan, AI signals, hourly reports) inherits it.
    const status = marketStatus();
    const lastPt = final[final.length - 1];
    let spliced = false;
    if (!intraday && lastPt.date < status.lastSession) {
      try {
        const universe = await fetchUniverse();
        const live = universe.find((s) => s.ticker === t);
        if (live && live.close > 0) {
          final.push({
            date: status.lastSession,
            close: live.close,
            volume: live.volume > 0 ? live.volume : null,
            live: true,
          });
          spliced = true;
        }
      } catch {
        // universe hiccup — candles stay as-is (still honest, just lagging)
      }
    }

    const closesArr = final.map((p) => p.close);
    const first = closesArr[0];
    const last = closesArr[closesArr.length - 1];
    return {
      symbol: req,
      yahooSymbol: `${t}.CA`,
      range,
      currency: r.meta?.currency ?? "EGP",
      points: final,
      first,
      last,
      high: Math.max(...closesArr),
      low: Math.min(...closesArr),
      changePct: first > 0 ? ((last - first) / first) * 100 : null,
      source: spliced
        ? "Yahoo Finance (EGX daily candles) + live TradingView close (latest session)"
        : intraday
          ? `Yahoo Finance (EGX ${cfg.interval} intraday bars, Cairo time)`
          : "Yahoo Finance (EGX daily candles)",
      asOf: final[final.length - 1].date,
    } satisfies StockChart;
  });
}

// ───────────────────────────────────── T27: milestone fallback ───
// ~86 of the 295 EGX names have NO daily history on any free source
// (Yahoo: 404 or a single stub bar). The TradingView universe row still
// carries REAL performance anchors for each horizon (Perf.1M/3M/6M/YTD/Y/
// 3Y/5Y + 52w high/low), so a chart can be reconstructed from verified
// milestone prices: price(horizon ago) = close / (1 + perf%). Every point
// is a real measured price — the label says exactly what it is.

/** Skip Fri/Sat (EGX weekend) when walking a date backward N calendar days. */
function sessionsAgo(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay(); // 5=Fri, 6=Sat
    if (dow !== 5 && dow !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

/** Trading sessions since Jan 1 (for the YTD anchor date). */
function sessionsSinceJan1(): number {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const d = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  let count = 0;
  while (d.getTime() < now.getTime()) {
    const dow = d.getUTCDay(); // 5=Fri, 6=Sat
    if (dow !== 5 && dow !== 6) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return Math.max(1, count);
}

const MILESTONE_RANGES: Record<ChartRange, number[]> = {
  // horizons (in trading sessions) worth anchoring per requested range
  "1D": [1, 5],
  "1W": [1, 5],
  "1M": [1, 5, 21],
  "3M": [1, 5, 21, 63],
  "6M": [5, 21, 63, 126],
  "1Y": [21, 63, 126, 252],
  "5Y": [63, 252, 504, 756, 1260],
};

const PERFS: { key: "perfW" | "perf1M" | "perf3M" | "perf6M" | "perfY" | "perf3Y" | "perf5Y"; sessions: number }[] = [
  { key: "perfW", sessions: 5 },
  { key: "perf1M", sessions: 21 },
  { key: "perf3M", sessions: 63 },
  { key: "perf6M", sessions: 126 },
  { key: "perfY", sessions: 252 },
  { key: "perf3Y", sessions: 756 },
  { key: "perf5Y", sessions: 1260 },
];

/** Reconstruct a milestone chart for a stock the free history sources do not
 *  cover. Points are verified horizon prices derived from the live
 *  TradingView performance fields; high52/low52 ride along as reference
 *  levels. Throws when even the anchors are unavailable. */
export function milestoneChart(
  ticker: string,
  range: ChartRange,
  stock: { close: number; perfW: number | null; perf1M: number | null; perf3M: number | null; perf6M: number | null; perfYTD: number | null; perfY: number | null; perf3Y: number | null; perf5Y: number | null; high52: number | null; low52: number | null }
): StockChart {
  const t = ticker.toUpperCase();
  if (!stock.close || stock.close <= 0) throw new Error("milestones: no live quote");
  const want = new Set(MILESTONE_RANGES[range]);
  const anchors: { date: string; close: number }[] = [];
  for (const { key, sessions } of PERFS) {
    const perf = stock[key] as number | null;
    if (perf === null || !Number.isFinite(perf) || !want.has(sessions)) continue;
    const denom = 1 + perf / 100;
    if (denom <= 0) continue;
    anchors.push({ date: sessionsAgo(sessions), close: stock.close / denom });
  }
  const ytd = stock.perfYTD;
  if (ytd !== null && Number.isFinite(ytd) && (range === "1Y" || range === "5Y")) {
    const denom = 1 + ytd / 100;
    if (denom > 0) anchors.push({ date: sessionsAgo(sessionsSinceJan1()), close: stock.close / denom });
  }
  // the live close is the final anchor
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  anchors.push({ date: today.toISOString().slice(0, 10), close: stock.close });
  // dedupe by date (multiple horizons can land on the same session when the
  // stock is new) and sort oldest → newest
  const byDate = new Map<string, number>();
  for (const a of anchors) if (Number.isFinite(a.close) && a.close > 0) byDate.set(a.date, a.close);
  const points = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, close]) => ({ date, close, volume: null as number | null }));
  if (points.length < 2) throw new Error("milestones: not enough anchors");
  const closes = points.map((p) => p.close);
  const first = closes[0];
  const last = closes[closes.length - 1];
  return {
    symbol: t,
    yahooSymbol: `${t}.CA`,
    range,
    currency: "EGP",
    points,
    first,
    last,
    high: stock.high52 && stock.high52 >= last ? stock.high52 : Math.max(...closes),
    low: stock.low52 && stock.low52 <= last ? stock.low52 : Math.min(...closes),
    changePct: first > 0 ? ((last - first) / first) * 100 : null,
    source:
      "TradingView performance milestones — no public daily history exists for this name; points are verified horizon prices (1W/1M/3M/6M/YTD/1Y) reconstructed from live performance data",
    asOf: points[points.length - 1].date,
    milestones: true,
    refHigh: stock.high52,
    refLow: stock.low52,
  } satisfies StockChart;
}
