/** Walk-forward backtest of the EGX trend strategy (src/lib/strategy.ts).
 *
 *  Method: replay the EXACT live scoring function over history — at every
 *  rebalance date (every 10 trading sessions) the strategy sees only candles
 *  up to that date (no lookahead), ranks the universe, takes up to 5 longs
 *  with score >= 0.5, holds 10 sessions, exits. Costs 0.35% round trip.
 *  Benchmark: equal-weight forward return of the whole eligible universe.
 *
 *  Universe: today's 40 most-traded EGX names (selection caveat, noted in
 *  the output). Data: Yahoo Finance 3y daily candles (.CA symbols).
 *
 *  Run: bun scripts/backtest-signals.ts
 *  Output: src/data/backtest.json (served by /api/ai-signals as evidence). */
import { writeFileSync } from "node:fs";
import { fetchUniverse } from "@/lib/market";
import { strategyFeaturesAt, STRATEGY_REV, type ChartPointLite } from "@/lib/strategy";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const WARMUP = 200; // sessions needed before a window is scored (SMA200)
const HOLD = 10; // sessions per position
const STEP = 10; // rebalance cadence (non-overlapping windows)
const TOPN = 5; // max simultaneous longs
const SCORE_MIN = 0.5; // charter long gate
const COST_PCT = 0.35; // round-trip cost (commissions + stamp + levy)
const UNIVERSE_N = 40; // most-traded names today

type Series = { ticker: string; nameAr: string; pts: ChartPointLite[] };
type YahooChart = {
  chart?: {
    result?: {
      timestamp?: number[];
      indicators?: {
        quote?: { close?: (number | null)[]; volume?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[] }[];
      };
    }[];
  };
};

async function fetchDaily3y(ticker: string): Promise<ChartPointLite[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(`${ticker}.CA`)}?range=3y&interval=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`yahoo ${res.status} for ${ticker}`);
  const json = (await res.json()) as YahooChart;
  const r = json.chart?.result?.[0];
  if (!r?.timestamp?.length) throw new Error(`no candles for ${ticker}`);
  const q = r.indicators?.quote?.[0] ?? {};
  const byDate = new Map<string, ChartPointLite>();
  for (let i = 0; i < r.timestamp.length; i++) {
    const c = q.close?.[i];
    if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) continue;
    const v = q.volume?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    byDate.set(new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10), {
      date: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10),
      close: c,
      volume: typeof v === "number" && Number.isFinite(v) ? v : null,
      high: typeof h === "number" && Number.isFinite(h) && h >= c ? h : null,
      low: typeof l === "number" && Number.isFinite(l) && l <= c ? l : null,
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function main() {
  const t0 = Date.now();
  const universe = await fetchUniverse();
  const liquid = universe
    .filter((s) => s.close > 0 && s.valueTraded > 0)
    .sort((a, b) => b.valueTraded - a.valueTraded)
    .slice(0, UNIVERSE_N);
  console.log(`universe: ${liquid.length} most-traded names (of ${universe.length})`);

  // fetch 3y daily candles, concurrency 6
  const series: Series[] = [];
  let failed = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < liquid.length) {
      const s = liquid[cursor++];
      try {
        const pts = await fetchDaily3y(s.ticker);
        if (pts.length >= WARMUP + HOLD) {
          const row = universe.find((x) => x.ticker === s.ticker);
          series.push({ ticker: s.ticker, nameAr: row?.name ?? s.ticker, pts });
        } else failed++;
      } catch {
        failed++;
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  };
  await Promise.all(Array.from({ length: 6 }, () => worker()));
  console.log(`candles ok: ${series.length}, failed/short: ${failed}`);

  // shared calendar
  const calendar = [...new Set(series.flatMap((s) => s.pts.map((p) => p.date)))].sort();
  const lastIdxAtOrBefore = (s: Series, date: string): number => {
    // binary search on dates
    let lo = 0;
    let hi = s.pts.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (s.pts[mid].date <= date) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  };

  type Trade = { window: number; date: string; ticker: string; nameAr: string; netPct: number; benchPct: number };
  const trades: Trade[] = [];
  const suspects: Trade[] = []; // |gross| > 45% in 10 sessions — corporate-action artifacts (rights issues/splits), excluded from stats
  type WindowRow = { date: string; picks: string[]; netPct: number; benchPct: number };
  const windows: WindowRow[] = [];
  let noPickWindows = 0;
  const SUSPECT_PCT = 45;

  for (let w = WARMUP; w + HOLD < calendar.length; w += STEP) {
    const evalDate = calendar[w];
    const exitDate = calendar[w + HOLD];
    // per-stock entry closes + features
    const cands: { ticker: string; nameAr: string; score: number; entryIdx: number; entryClose: number }[] = [];
    const eligible: { ticker: string; entryClose: number; exitClose: number }[] = [];
    for (const s of series) {
      const i = lastIdxAtOrBefore(s, evalDate);
      if (i < WARMUP) continue; // not enough history at that date
      // stale candle (suspension) — skip for eligibility
      if (calendar.indexOf(s.pts[i].date) < w - 7) continue;
      const j = lastIdxAtOrBefore(s, exitDate);
      if (j <= i) continue; // no exit print
      eligible.push({ ticker: s.ticker, entryClose: s.pts[i].close, exitClose: s.pts[j].close });
      const f = strategyFeaturesAt(s.ticker, s.pts.slice(0, i + 1));
      if (f && f.score >= SCORE_MIN) {
        cands.push({ ticker: s.ticker, nameAr: s.nameAr, score: f.score, entryIdx: i, entryClose: s.pts[i].close });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    const picks = cands.slice(0, TOPN);
    const benchPct =
      eligible.length > 0
        ? (eligible.reduce((acc, e) => acc + (e.exitClose / e.entryClose - 1), 0) / eligible.length) * 100
        : 0;
    if (picks.length === 0) {
      noPickWindows++;
      windows.push({ date: evalDate, picks: [], netPct: 0, benchPct: Number(benchPct.toFixed(2)) });
      continue;
    }
    for (const p of picks) {
      const e = eligible.find((x) => x.ticker === p.ticker)!;
      const gross = (e.exitClose / e.entryClose - 1) * 100;
      const netPct = gross - COST_PCT;
      const row: Trade = { window: windows.length, date: evalDate, ticker: p.ticker, nameAr: p.nameAr, netPct: Number(netPct.toFixed(2)), benchPct: Number(benchPct.toFixed(2)) };
      if (Math.abs(gross) > SUSPECT_PCT) {
        suspects.push(row); // likely rights-issue/split print — excluded, counted honestly
        continue;
      }
      trades.push(row);
    }
    const kept = picks.filter((p) => !suspects.some((s) => s.window === windows.length && s.ticker === p.ticker));
    const netPct = kept.length > 0 ? kept.reduce((acc, p) => {
      const e = eligible.find((x) => x.ticker === p.ticker)!;
      return acc + (e.exitClose / e.entryClose - 1) * 100 - COST_PCT;
    }, 0) / kept.length : 0;
    windows.push({ date: evalDate, picks: picks.map((p) => p.ticker), netPct: Number(netPct.toFixed(2)), benchPct: Number(benchPct.toFixed(2)) });
  }

  // ── stats ──
  const wins = trades.filter((t) => t.netPct > 0);
  const losses = trades.filter((t) => t.netPct <= 0);
  const sumWin = wins.reduce((a, t) => a + t.netPct, 0);
  const sumLoss = Math.abs(losses.reduce((a, t) => a + t.netPct, 0));
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  // equity curves (equal-weight per window, compounding)
  let eq = 1;
  let peak = 1;
  let maxDD = 0;
  for (const w of windows) {
    eq *= 1 + w.netPct / 100;
    peak = Math.max(peak, eq);
    maxDD = Math.min(maxDD, (eq / peak - 1) * 100);
  }
  let benchEq = 1;
  for (const w of windows) benchEq *= 1 + w.benchPct / 100;

  const sortedNets = [...trades].sort((a, b) => a.netPct - b.netPct).map((t) => t.netPct);
  const stats = {
    windows: windows.length,
    noPickWindows,
    trades: trades.length,
    suspectExcluded: suspects.length,
    hitRate: trades.length ? Number((wins.length / trades.length).toFixed(3)) : 0,
    avgNetPct: Number(avg(trades.map((t) => t.netPct)).toFixed(2)),
    avgWinPct: Number(avg(wins.map((t) => t.netPct)).toFixed(2)),
    avgLossPct: Number(avg(losses.map((t) => t.netPct)).toFixed(2)),
    profitFactor: sumLoss > 0 ? Number((sumWin / sumLoss).toFixed(2)) : null,
    avgExcessPct: Number(avg(trades.map((t) => t.netPct - t.benchPct)).toFixed(2)),
    beatBenchRate: trades.length ? Number((trades.filter((t) => t.netPct > t.benchPct).length / trades.length).toFixed(3)) : 0,
    strategyCumPct: Number(((eq - 1) * 100).toFixed(1)),
    benchCumPct: Number(((benchEq - 1) * 100).toFixed(1)),
    maxDrawdownPct: Number(maxDD.toFixed(1)),
    bestPct: trades.length ? Number(Math.max(...trades.map((t) => t.netPct)).toFixed(1)) : 0,
    worstPct: trades.length ? Number(Math.min(...trades.map((t) => t.netPct)).toFixed(1)) : 0,
    medianNetPct: sortedNets.length ? Number(sortedNets[Math.floor(sortedNets.length / 2)].toFixed(2)) : 0,
  };

  const out = {
    asOf: new Date().toISOString(),
    strategyRev: STRATEGY_REV,
    method: "walk-forward, no lookahead: every 10 sessions rank the universe with the live scoring function over candles up to that date only; longs = top 5 with score >= 0.5; hold 10 sessions; costs 0.35% round trip; benchmark = equal-weight universe",
    params: { warmupSessions: WARMUP, holdSessions: HOLD, topN: TOPN, scoreMin: SCORE_MIN, costPctRoundTrip: COST_PCT },
    universe: { size: series.length, selection: `today's ${UNIVERSE_N} most-traded EGX names with 3y daily history` },
    stats,
    windows: windows.slice(-12),
    notes: [
      "Past performance is NOT a guarantee — the backtest validates the RULES on history, it cannot validate the LLM's future judgment.",
      `Trades with |gross return| > ${SUSPECT_PCT}% inside a 10-session hold (${suspects.length} found) are excluded as likely rights-issue/split print artifacts.`,
      "Universe is today's most-traded names — mild survivorship/selection bias is possible.",
      "Quotes are ~15-min delayed daily candles; fills at next available close, no intraday stops modeled (EGX circuit breakers make stop fills uncertain).",
    ],
  };

  writeFileSync("src/data/backtest.json", JSON.stringify(out, null, 2));
  console.log(`\n=== BACKTEST (${((Date.now() - t0) / 1000).toFixed(0)}s) ===`);
  console.log(JSON.stringify(stats, null, 2));
  console.log(`\nwritten: src/data/backtest.json (${windows.length} windows, ${trades.length} trades)`);
}

main().catch((err) => {
  console.error("backtest failed:", err);
  process.exit(1);
});
