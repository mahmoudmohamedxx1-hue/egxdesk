/** Server-side price-history layer — REAL daily/weekly candles for every EGX
 *  listed stock, fetched from Yahoo Finance's public chart API (symbols use
 *  the Cairo exchange suffix ".CA"). No API key, no auth, EGP-denominated.
 *
 *  Index history (EGX30 / EGX70 / EGX100) is NOT served by Yahoo (only the
 *  latest point), so indices come from the EGXBot-derived IndexDay table —
 *  see flows.ts.
 */

import { fetchUniverse } from "./market";
import { marketStatus } from "./market-status";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export type ChartRange = "1W" | "1M" | "3M" | "6M" | "1Y" | "5Y";

export const CHART_RANGES: ChartRange[] = ["1W", "1M", "3M", "6M", "1Y", "5Y"];

const RANGE_MAP: Record<ChartRange, { yahoo: string; interval: string; maxDays: number }> = {
  "1W": { yahoo: "5d", interval: "1d", maxDays: 9 },
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
  const t = ticker.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!t) throw new Error("history: empty ticker");
  const cfg = RANGE_MAP[range];
  return cached(`chart:${t}:${range}`, 300_000, async () => {
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
        date: toDate(r.timestamp[i]),
        close: c,
        volume: typeof v === "number" && Number.isFinite(v) ? v : null,
        high: typeof h === "number" && Number.isFinite(h) && h >= c ? h : null,
        low: typeof l === "number" && Number.isFinite(l) && l <= c ? l : null,
      });
    }
    // keep only the last point per date (guards against duplicate intraday rows)
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
    // with the tape. Implemented HERE so every consumer (chart route,
    // technical panel, signals scan, AI signals, hourly reports) inherits it.
    const status = marketStatus();
    const lastPt = final[final.length - 1];
    let spliced = false;
    if (lastPt.date < status.lastSession) {
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
      symbol: t,
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
        : "Yahoo Finance (EGX daily candles)",
      asOf: final[final.length - 1].date,
    } satisfies StockChart;
  });
}
