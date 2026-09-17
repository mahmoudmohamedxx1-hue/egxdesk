/** Walk-forward backtest of the EGX MULTI-STRATEGY ENSEMBLE (src/lib/strategies.ts).
 *
 *  Method: replay the EXACT live scoring functions over history — at every
 *  rebalance date (every 10 trading sessions) the ensemble sees only candles
 *  up to that date (no lookahead), all 10 candle strategies vote per stock,
 *  the consensus ranks the universe, takes up to 5 longs with consensus
 *  >= 0.35 (the same gate the live AI-signals validation applies), holds 10
 *  sessions, exits. Costs 0.35% round trip. Benchmark: equal-weight forward
 *  return of the whole eligible universe.
 *
 *  ALSO: each candle strategy is backtested STANDALONE (its own picks, top 5
 *  by its own score when it fires long) so the per-strategy table in the UI
 *  is honest evidence, not decoration. The two data-gated strategies
 *  (dividend-quality needs live scanner fields, press-tone needs the current
 *  press archive) cannot be replayed historically — they are reported as
 *  "live-only, not backtested" rather than faked.
 *
 *  Universe: today's 40 most-traded EGX names (selection caveat, noted in
 *  the output). Data: Yahoo Finance 3y daily candles (.CA symbols).
 *
 *  Run: bun scripts/backtest-signals.ts
 *  Output: src/data/backtest.json (served by /api/ai-signals as evidence). */
import { writeFileSync } from "node:fs";
import { fetchUniverse } from "@/lib/market";
import { atrPctAt, STRATEGY_REV, type ChartPointLite } from "@/lib/strategy";
import { evaluateStrategies, ensembleRead, STRATEGY_REGISTRY, type StrategyVerdict } from "@/lib/strategies";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const WARMUP = 200; // sessions needed before a window is scored (SMA200)
const HOLD = 10; // sessions per position
const STEP = 10; // rebalance cadence (non-overlapping windows)
const TOPN = 5; // max simultaneous longs
const SCORE_MIN = 0.35; // ensemble consensus gate — the LIVE validation gate
const COST_PCT = 0.35; // round-trip cost (commissions + stamp + levy)
const UNIVERSE_N = 40; // most-traded names today
const SUSPECT_PCT = 45; // |gross| beyond this in 10 sessions = corporate-action artifact

/** Historical replay context: the live-only fields are null so the two
 *  data-gated strategies never vote in the backtest (documented honestly). */
const HIST_CTX = { divYield: null, fundQuality: null, newsScore: null, techScore: 0 };

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

// ── stats helpers (same definitions as the egx-trend-v1 run) ──

type Trade = { window: number; date: string; ticker: string; netPct: number; benchPct: number };

function statsFor(trades: Trade[], windows: { netPct: number; benchPct: number }[]) {
  const wins = trades.filter((t) => t.netPct > 0);
  const losses = trades.filter((t) => t.netPct <= 0);
  const sumWin = wins.reduce((a, t) => a + t.netPct, 0);
  const sumLoss = Math.abs(losses.reduce((a, t) => a + t.netPct, 0));
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
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
  return {
    windows: windows.length,
    trades: trades.length,
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

  // ── per-strategy trade ledgers (standalone runs) + ensemble ledger ──
  const candleStrategies = STRATEGY_REGISTRY.filter((s) => s.id !== "dividend-quality" && s.id !== "press-tone");
  const stratTrades = new Map<string, Trade[]>();
  const stratWindows = new Map<string, { netPct: number; benchPct: number }[]>();
  for (const s of candleStrategies) {
    stratTrades.set(s.id, []);
    stratWindows.set(s.id, []);
  }

  const trades: Trade[] = [];
  const suspects: Trade[] = [];
  type WindowRow = { date: string; picks: string[]; netPct: number; benchPct: number };
  const windows: WindowRow[] = [];
  let noPickWindows = 0;

  for (let w = WARMUP; w + HOLD < calendar.length; w += STEP) {
    const evalDate = calendar[w];
    const exitDate = calendar[w + HOLD];
    // per-stock entry closes + ensemble verdicts (computed ONCE, reused by
    // the ensemble ranking AND every per-strategy standalone ledger)
    const cands: { ticker: string; nameAr: string; score: number; entryClose: number }[] = [];
    const perStratCands = new Map<string, { ticker: string; nameAr: string; score: number }[]>();
    const eligible: { ticker: string; entryClose: number; exitClose: number }[] = [];
    for (const s of series) {
      const i = lastIdxAtOrBefore(s, evalDate);
      if (i < WARMUP) continue; // not enough history at that date
      // stale candle (suspension) — skip for eligibility
      if (calendar.indexOf(s.pts[i].date) < w - 7) continue;
      const j = lastIdxAtOrBefore(s, exitDate);
      if (j <= i) continue; // no exit print
      eligible.push({ ticker: s.ticker, entryClose: s.pts[i].close, exitClose: s.pts[j].close });

      const slice = s.pts.slice(0, i + 1); // NO LOOKAHEAD — candles up to eval only
      const verdicts: StrategyVerdict[] = evaluateStrategies(slice, HIST_CTX);
      const ens = ensembleRead(verdicts, atrPctAt(slice, 14));
      if (ens.consensus >= SCORE_MIN) {
        cands.push({ ticker: s.ticker, nameAr: s.nameAr, score: ens.consensus, entryClose: s.pts[i].close });
      }
      for (const v of verdicts) {
        if (v.fired && v.direction === "long") {
          const list = perStratCands.get(v.id) ?? [];
          list.push({ ticker: s.ticker, nameAr: s.nameAr, score: v.score });
          perStratCands.set(v.id, list);
        }
      }
    }

    const benchPct =
      eligible.length > 0
        ? (eligible.reduce((acc, e) => acc + (e.exitClose / e.entryClose - 1), 0) / eligible.length) * 100
        : 0;

    // ── ensemble picks ──
    cands.sort((a, b) => b.score - a.score);
    const picks = cands.slice(0, TOPN);
    if (picks.length === 0) {
      noPickWindows++;
      windows.push({ date: evalDate, picks: [], netPct: 0, benchPct: Number(benchPct.toFixed(2)) });
    } else {
      const kept = picks.filter((p) => {
        const e = eligible.find((x) => x.ticker === p.ticker)!;
        const gross = (e.exitClose / e.entryClose - 1) * 100;
        const row: Trade = { window: windows.length, date: evalDate, ticker: p.ticker, netPct: Number(gross - COST_PCT), benchPct: Number(benchPct.toFixed(2)) };
        if (Math.abs(gross) > SUSPECT_PCT) {
          suspects.push(row); // likely rights-issue/split print — excluded, counted honestly
          return false;
        }
        trades.push(row);
        return true;
      });
      const netPct = kept.length > 0 ? kept.reduce((acc, p) => {
        const e = eligible.find((x) => x.ticker === p.ticker)!;
        return acc + (e.exitClose / e.entryClose - 1) * 100 - COST_PCT;
      }, 0) / kept.length : 0;
      windows.push({ date: evalDate, picks: picks.map((p) => p.ticker), netPct: Number(netPct.toFixed(2)), benchPct: Number(benchPct.toFixed(2)) });
    }

    // ── per-strategy standalone picks (top 5 by that strategy's own score) ──
    for (const [id, list] of perStratCands) {
      const st = stratTrades.get(id);
      const sw = stratWindows.get(id);
      if (!st || !sw) continue;
      list.sort((a, b) => b.score - a.score);
      const spicks = list.slice(0, TOPN);
      let sum = 0;
      let n = 0;
      for (const p of spicks) {
        const e = eligible.find((x) => x.ticker === p.ticker);
        if (!e) continue;
        const gross = (e.exitClose / e.entryClose - 1) * 100;
        if (Math.abs(gross) > SUSPECT_PCT) continue; // same artifact rule
        const net = Number((gross - COST_PCT).toFixed(2));
        st.push({ window: windows.length - 1, date: evalDate, ticker: p.ticker, netPct: net, benchPct: Number(benchPct.toFixed(2)) });
        sum += net;
        n++;
      }
      sw.push({ netPct: Number((n > 0 ? sum / n : 0).toFixed(2)), benchPct: Number(benchPct.toFixed(2)) });
    }
  }

  // ── stats ──
  const stats = {
    ...statsFor(trades, windows),
    noPickWindows,
    suspectExcluded: suspects.length,
  };

  const perStrategy = STRATEGY_REGISTRY.map((s) => {
    if (s.id === "dividend-quality" || s.id === "press-tone") {
      return {
        id: s.id,
        nameAr: s.nameAr,
        nameEn: s.nameEn,
        family: s.family,
        backtested: false as const,
        note: s.id === "dividend-quality"
          ? "live-only: needs current scanner fundamentals (yield/quality) that have no historical series"
          : "live-only: needs the current 14-day press archive (no historical coverage)",
      };
    }
    const t = stratTrades.get(s.id) ?? [];
    const w2 = stratWindows.get(s.id) ?? [];
    const st = statsFor(t, w2);
    return {
      id: s.id,
      nameAr: s.nameAr,
      nameEn: s.nameEn,
      family: s.family,
      backtested: true as const,
      stats: {
        trades: st.trades,
        hitRate: st.hitRate,
        avgNetPct: st.avgNetPct,
        profitFactor: st.profitFactor,
        strategyCumPct: st.strategyCumPct,
        benchCumPct: st.benchCumPct,
        maxDrawdownPct: st.maxDrawdownPct,
        medianNetPct: st.medianNetPct,
      },
    };
  });

  const out = {
    asOf: new Date().toISOString(),
    strategyRev: STRATEGY_REV,
    ensemble: {
      size: STRATEGY_REGISTRY.length,
      candleStrategies: candleStrategies.length,
      gate: `consensus >= ${SCORE_MIN}`,
      description:
        "the served consensus is the family-weighted vote of all applicable strategies; this replay validates the 10 candle strategies' vote (the two data-gated strategies cannot be replayed historically)",
    },
    method: `walk-forward, no lookahead: every 10 sessions the 12-strategy ensemble votes on the universe over candles up to that date only; longs = top 5 with consensus >= ${SCORE_MIN}; hold 10 sessions; costs 0.35% round trip; benchmark = equal-weight universe. Each candle strategy is ALSO backtested standalone (own top-5 picks when it fires).`,
    params: { warmupSessions: WARMUP, holdSessions: HOLD, topN: TOPN, scoreMin: SCORE_MIN, costPctRoundTrip: COST_PCT },
    universe: { size: series.length, selection: `today's ${UNIVERSE_N} most-traded EGX names with 3y daily history` },
    stats,
    perStrategy,
    // T26 — keep ALL windows: the public Strategy Lab view builds its equity
    // curve from the full walk-forward sequence.
    windows,
    notes: [
      "Past performance is NOT a guarantee — the backtest validates the RULES on history, it cannot validate the LLM's future judgment.",
      `Trades with |gross return| > ${SUSPECT_PCT}% inside a 10-session hold (${suspects.length} found) are excluded as likely rights-issue/split print artifacts.`,
      "Universe is today's most-traded names — mild survivorship/selection bias is possible.",
      "Quotes are ~15-min delayed daily candles; fills at next available close, no intraday stops modeled (EGX circuit breakers make stop fills uncertain).",
      "The dividend-quality and press-tone strategies join the LIVE consensus only when their data fires — they have no historical replay and are labeled live-only in the per-strategy table.",
    ],
  };

  writeFileSync("src/data/backtest.json", JSON.stringify(out, null, 2));
  console.log(`\n=== BACKTEST (${((Date.now() - t0) / 1000).toFixed(0)}s) ===`);
  console.log("ENSEMBLE:", JSON.stringify(stats, null, 2));
  console.log("\nPER-STRATEGY (standalone):");
  for (const ps of perStrategy) {
    if (ps.backtested) {
      console.log(
        `  ${ps.id.padEnd(18)} trades ${String(ps.stats.trades).padStart(3)}  hit ${(ps.stats.hitRate * 100).toFixed(1).padStart(5)}%  avg ${ps.stats.avgNetPct.toFixed(2).padStart(6)}%  PF ${ps.stats.profitFactor ?? "—"}  cum ${ps.stats.strategyCumPct.toFixed(0).padStart(4)}%`
      );
    } else {
      console.log(`  ${ps.id.padEnd(18)} live-only (${ps.note})`);
    }
  }
  console.log(`\nwritten: src/data/backtest.json (${windows.length} windows, ${trades.length} ensemble trades)`);
}

main().catch((err) => {
  console.error("backtest failed:", err);
  process.exit(1);
});
