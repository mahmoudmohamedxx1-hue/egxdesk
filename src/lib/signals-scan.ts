/** Cross-market COMPOSITE SIGNALS scanner — the "best signals across the
 *  stocks" engine behind the Signals tab and the AI agent's `technicals`
 *  tool. For every traded EGX stock it combines THREE independent pillars:
 *
 *   TECHNICAL  — the SAME 13-indicator rating the company Technical Panel
 *                shows (6 moving averages + 8 oscillators over one year of
 *                Yahoo daily candles), score −1 … +1.
 *   FUNDAMENTAL — the src/lib/fundamentals.ts pillar engine over real
 *                TradingView scanner fields (P/E + P/B vs sector medians,
 *                ROE / net margin / debt-to-equity, dividend yield + payout
 *                sanity), score −1 … +1, null-safe per component.
 *   NEWS       — the src/lib/news-score.ts press pillar: a rule-based
 *                bilingual lexicon over the last 14 days of the archived
 *                Egyptian business press (Alborsaanews + Amwal Alghad),
 *                recency-weighted, score −1 … +1, null when no coverage.
 *
 *  COMPOSITE = 45% technical + 30% fundamental + 25% news (honest
 *  renormalization: news missing → 55/45 TA+FA; fundamentals missing →
 *  75/25 TA+news; both missing → pure technical). Rows are ranked by the
 *  composite. Quotes/perf/valuation fields come from the TradingView
 *  universe snapshot.
 *
 *  Cost: ~1 chart fetch per stock (shared cache with /api/chart) + one
 *  news-archive pass shared by the whole scan. The scan result is cached
 *  for an hour and pre-warmed at server boot (see lib/push-loop.ts) so
 *  users never wait for the full sweep. */

import { fetchUniverse, companyRow, type Stock } from "@/lib/market";
import { fetchStockChart, type StockChart } from "@/lib/history";
import {
  smaSeries,
  emaFull,
  rsiSeries,
  macdSeries,
  stochasticSeries,
  cciSeries,
  momentumSeries,
  williamsRSeries,
  bullBearSeries,
  aggregateSignals,
  type Signal,
} from "@/lib/indicators";
import {
  computeFundamentals,
  compositeScores3,
  sectorStatsMap,
  marketStats,
  statsFor,
  ratingFromScore,
  type SectorStats,
} from "@/lib/fundamentals";
import { newsScoreForTicker, newsScoresForUniverse, type NewsScore } from "@/lib/news-score";

export type Rating = "strongBuy" | "buy" | "neutral" | "sell" | "strongSell";

export type SignalRow = {
  ticker: string;
  name: string;
  nameAr: string;
  sectorEn: string;
  sectorAr: string;
  // quote block (merged fresh by the route from the universe snapshot)
  close: number;
  changePct: number;
  volume: number;
  valueTraded: number;
  marketCap: number | null;
  pe: number | null;
  divYield: number | null;
  // fundamental rating block (TradingView scanner fields, sector-relative)
  pb: number | null;
  roe: number | null;
  netMarginTTM: number | null;
  debtToEquity: number | null;
  fundScore: number | null; // −1 … +1, null when coverage < 2 components
  fundRating: Rating;
  fundCoverage: number; // 0 … 1 fraction of the 7 components with data
  valuation: number | null; // pillar scores
  quality: number | null;
  income: number | null;
  fundReasons: string[]; // short EN evidence lines
  fundReasonsAr: string[];
  // news pillar (T32 — 14-day press lexicon, rule-based, honestly labeled)
  newsScore: number | null; // −1 … +1, null when no coverage in the window
  newsRating: Rating;
  newsCount: number; // attributed articles in the 14-day window
  newsBull: number;
  newsBear: number;
  newsReasons: string[];
  newsReasonsAr: string[];
  // composite rating block — THE ranking signal (45% TA + 30% FA + 25% news)
  composite: number; // −1 … +1 (falls back to pure technical)
  compositeRating: Rating;
  // technical rating block
  rating: Rating;
  score: number;
  buy: number;
  neutral: number;
  sell: number;
  count: number;
  rsi: number | null;
  macdHist: number | null;
  macdSig: Signal;
  sma50: number | null;
  sma200: number | null;
  sma50Sig: Signal;
  sma200Sig: Signal;
  pos52: number | null; // 0–100 position inside the 52-week range
  volRatio: number | null; // session volume / 10-day average
  perf1M: number | null;
  perf6M: number | null;
  perfYTD: number | null;
  perfY: number | null;
  nextEarnings: string | null; // ISO date
  lastDate: string; // last candle date
};

export type SignalsScan = {
  asOf: string; // ISO scan time
  scanned: number;
  failed: number;
  rows: SignalRow[]; // sorted by score desc
};

// ── scan-level cache (in-flight dedup + 60-minute result TTL) ──

type Entry = { data: unknown; at: number };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const flying = inflight.get(key);
  if (flying) return flying as Promise<T>;
  const p = (async () => {
    const data = await loader();
    cache.set(key, { data, at: Date.now() });
    return data;
  })();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

// ── single-stock rating (mirror of the Technical Panel computation) ──

function lastOf(series: (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) return v;
  }
  return null;
}

export function computeSignalRow(
  stock: Stock,
  chart: StockChart,
  sector?: { bySector: Map<string, SectorStats>; market: SectorStats },
  news?: NewsScore | null
): SignalRow | null {
  const pts = chart.points;
  if (pts.length < 60) return null; // not enough history for a meaningful rating
  const closes = pts.map((p) => p.close);
  const highs = pts.map((p) => p.high ?? null);
  const lows = pts.map((p) => p.low ?? null);
  const price = closes[closes.length - 1];

  const sma20 = lastOf(smaSeries(closes, 20));
  const sma50 = lastOf(smaSeries(closes, 50));
  const sma200 = lastOf(smaSeries(closes, 200));
  const ema20 = lastOf(emaFull(closes, 20));
  const ema50 = lastOf(emaFull(closes, 50));
  const ema100 = lastOf(emaFull(closes, 100));
  const rsi = lastOf(rsiSeries(closes, 14));
  const stoch = stochasticSeries(highs, lows, closes, 14, 3, 3);
  const stochK = lastOf(stoch.k);
  const stochD = lastOf(stoch.d);
  const macd = macdSeries(closes);
  const macdHist = lastOf(macd.hist);
  const cci = lastOf(cciSeries(highs, lows, closes, 20));
  const mom = lastOf(momentumSeries(closes, 10));
  const wr = lastOf(williamsRSeries(highs, lows, closes, 14));
  const bbp = lastOf(bullBearSeries(closes, 13));

  const maSignal = (v: number | null): Signal =>
    v === null ? "neutral" : price > v ? "buy" : price < v ? "sell" : "neutral";

  const rows: { value: number | null; signal: Signal }[] = [
    { value: sma20, signal: maSignal(sma20) },
    { value: sma50, signal: maSignal(sma50) },
    { value: sma200, signal: maSignal(sma200) },
    { value: ema20, signal: maSignal(ema20) },
    { value: ema50, signal: maSignal(ema50) },
    { value: ema100, signal: maSignal(ema100) },
    { value: rsi, signal: rsi === null ? "neutral" : rsi < 30 ? "buy" : rsi > 70 ? "sell" : "neutral" },
    { value: stochK, signal: stochK === null ? "neutral" : stochK < 20 ? "buy" : stochK > 80 ? "sell" : "neutral" },
    { value: stochD, signal: stochD === null ? "neutral" : stochD < 20 ? "buy" : stochD > 80 ? "sell" : "neutral" },
    { value: macdHist, signal: macdHist === null ? "neutral" : macdHist > 0 ? "buy" : "sell" },
    { value: cci, signal: cci === null ? "neutral" : cci < -100 ? "buy" : cci > 100 ? "sell" : "neutral" },
    { value: mom, signal: mom === null ? "neutral" : mom > 0 ? "buy" : mom < 0 ? "sell" : "neutral" },
    { value: wr, signal: wr === null ? "neutral" : wr < -80 ? "buy" : wr > -20 ? "sell" : "neutral" },
    { value: bbp, signal: bbp === null ? "neutral" : bbp > 0 ? "buy" : "sell" },
  ];

  const active = rows.filter((r) => r.value !== null);
  const summary = aggregateSignals(active.map((r) => r.signal));

  // ── fundamental half (real scanner fields; sector medians when the sector
  // has ≥5 names, else market-wide medians) ──
  const stats = sector ? statsFor(stock, sector.bySector, sector.market) : marketStats([stock]);
  const fund = computeFundamentals(stock, stats);
  const ns: NewsScore | null = news ?? null;
  const { composite, fundWeight, newsWeight } = compositeScores3(summary.score, fund.score, ns?.score ?? null);

  const pos52 =
    stock.high52 !== null && stock.low52 !== null && stock.high52 > stock.low52 && price > 0
      ? ((price - stock.low52) / (stock.high52 - stock.low52)) * 100
      : null;

  const row = companyRow(stock);
  const nextEarnings =
    stock.nextEarnings && stock.nextEarnings > 1.7e9
      ? new Date(stock.nextEarnings * 1000).toISOString().slice(0, 10)
      : null;

  return {
    ticker: row.ticker,
    name: row.name,
    nameAr: row.nameAr,
    sectorEn: row.sectorEn,
    sectorAr: row.sectorAr,
    close: stock.close,
    changePct: stock.changePct,
    volume: stock.volume,
    valueTraded: stock.valueTraded,
    marketCap: stock.marketCap,
    pe: stock.pe,
    divYield: stock.divYield,
    // fundamental block
    pb: stock.pb,
    roe: stock.roe,
    netMarginTTM: stock.netMarginTTM,
    debtToEquity: stock.debtToEquity,
    fundScore: fund.score,
    fundRating: fund.rating,
    fundCoverage: Number(fund.coverage.toFixed(2)),
    valuation: fund.valuation,
    quality: fund.quality,
    income: fund.income,
    fundReasons: fund.reasons,
    fundReasonsAr: fund.reasonsAr,
    // news pillar
    newsScore: ns ? ns.score : null,
    newsRating: ns ? ns.rating : ratingFromScore(null),
    newsCount: ns ? ns.count : 0,
    newsBull: ns ? ns.bull : 0,
    newsBear: ns ? ns.bear : 0,
    newsReasons: ns ? ns.reasons : [],
    newsReasonsAr: ns ? ns.reasonsAr : [],
    // composite block — the ranking signal
    composite,
    compositeRating:
      fundWeight > 0 || newsWeight > 0 ? ratingFromScore(composite) : summary.rating,
    rating: summary.rating,
    score: Number(summary.score.toFixed(3)),
    buy: summary.buy,
    neutral: summary.neutral,
    sell: summary.sell,
    count: active.length,
    rsi: rsi !== null ? Number(rsi.toFixed(1)) : null,
    macdHist: macdHist !== null ? Number(macdHist.toFixed(3)) : null,
    macdSig: macdHist === null ? "neutral" : macdHist > 0 ? "buy" : "sell",
    sma50: sma50 !== null ? Number(sma50.toFixed(2)) : null,
    sma200: sma200 !== null ? Number(sma200.toFixed(2)) : null,
    sma50Sig: maSignal(sma50),
    sma200Sig: maSignal(sma200),
    pos52: pos52 !== null ? Number(pos52.toFixed(0)) : null,
    volRatio: row.volumeRatio !== null ? Number(row.volumeRatio.toFixed(2)) : null,
    perf1M: stock.perf1M,
    perf6M: stock.perf6M,
    perfYTD: stock.perfYTD,
    perfY: stock.perfY,
    nextEarnings,
    lastDate: pts[pts.length - 1].date,
  };
}

// ── the full-market scan ──

const SCAN_TTL = 60 * 60_000; // indicators are daily-candle based — hourly is honest
const CONCURRENCY = 6;
const STAGGER_MS = 120;

async function runScan(): Promise<SignalsScan> {
  const universe = await fetchUniverse();
  // only stocks with a live price (suspended/zero-price rows have no signals)
  const candidates = universe.filter((s) => s.close > 0 && s.ticker);
  // sector + market medians for the fundamental half (one pass, shared)
  const bySector = sectorStatsMap(universe);
  const market = marketStats(universe);
  // news pillar — one press-archive pass for the whole market (10-min TTL
  // inside; a DB hiccup degrades to "no news" and the blend renormalizes)
  const newsMap = await newsScoresForUniverse(universe).catch((e) => {
    console.warn("[signals] news pillar unavailable:", e instanceof Error ? e.message : e);
    return new Map<string, NewsScore>();
  });
  const rows: SignalRow[] = [];
  let failed = 0;

  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const stock = candidates[cursor++];
      try {
        const chart = await fetchStockChart(stock.ticker, "1Y");
        const row = computeSignalRow(stock, chart, { bySector, market }, newsMap.get(stock.ticker) ?? null);
        if (row) rows.push(row);
        else failed++;
      } catch {
        failed++; // a broken upstream for one stock never breaks the scan
      }
      await new Promise((r) => setTimeout(r, STAGGER_MS));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  rows.sort((a, b) => b.composite - a.composite);
  return {
    asOf: new Date().toISOString(),
    scanned: rows.length,
    failed,
    rows,
  };
}

export function scanSignals(): Promise<SignalsScan> {
  return cached("signals-scan", SCAN_TTL, runScan);
}

/** Serve-time NEWS refresh (T32): the scan cache holds technicals +
 *  fundamentals for up to an hour (both are daily-candle / snapshot based,
 *  so that is honest), but the news pillar is minute-level. This re-blends
 *  every row's news fields + composite with a FRESH press pass (10-minute
 *  TTL inside newsScoresForUniverse) — pure math, no chart refetches — and
 *  re-ranks the rows. Called by /api/signals on every GET. */
export async function reblendNews(
  rows: SignalRow[],
  universe: { ticker: string; name: string }[]
): Promise<SignalRow[]> {
  let newsMap: Map<string, NewsScore>;
  try {
    newsMap = await newsScoresForUniverse(universe);
  } catch {
    return rows; // a press-archive hiccup keeps the scan-time blend — honest
  }
  const out = rows.map((r) => {
    const ns = newsMap.get(r.ticker) ?? null;
    if (ns === null && r.newsCount === 0) return r; // nothing to update
    const { composite } = compositeScores3(r.score, r.fundScore, ns?.score ?? null);
    return {
      ...r,
      newsScore: ns ? ns.score : null,
      newsRating: ns ? ns.rating : ratingFromScore(null),
      newsCount: ns ? ns.count : 0,
      newsBull: ns ? ns.bull : 0,
      newsBear: ns ? ns.bear : 0,
      newsReasons: ns ? ns.reasons : [],
      newsReasonsAr: ns ? ns.reasonsAr : [],
      composite,
      compositeRating:
        r.fundScore !== null || (ns !== null && ns.score !== null)
          ? ratingFromScore(composite)
          : r.rating,
    };
  });
  out.sort((a, b) => b.composite - a.composite);
  return out;
}

/** Single-stock rating for the AI agent's `technicals` tool and the
 *  company page composite signal card (TA + FA + news). */
export async function signalForTicker(tickerRaw: string): Promise<SignalRow | null> {
  const t = tickerRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const universe = await fetchUniverse();
  const stock = universe.find((s) => s.ticker === t);
  if (!stock) return null;
  try {
    const chart = await fetchStockChart(t, "1Y");
    const news = await newsScoreForTicker(stock.ticker, stock.name).catch(() => null);
    return computeSignalRow(
      stock,
      chart,
      {
        bySector: sectorStatsMap(universe),
        market: marketStats(universe),
      },
      news
    );
  } catch {
    return null;
  }
}
