/** EGX Desk Strategy Core — the deterministic, BACK-TESTABLE engine behind the
 *  AI Signals section. Everything the LLM is allowed to say flows from these
 *  numbers: the same feature vector that the walk-forward backtest
 *  (scripts/backtest-signals.ts) validated historically is recomputed on the
 *  live candle series and handed to the model as evidence.
 *
 *  Design rules:
 *   - NO LOOKAHEAD: strategyFeaturesAt(pts, i) only reads pts[0..i] — the
 *     backtest replays history through the exact same function.
 *   - HONESTY: evidence strings are generated from the numbers themselves,
 *     never from the model's imagination; the LLM may re-weight, explain and
 *     translate them, but not invent values.
 *   - EGX-AWARE: liquidity gate (thin names are untradeable), volatility
 *     penalty (EGX ±10% circuit breakers make extreme-ATR names dangerous),
 *     trend-first (the Egyptian market's retail-driven momentum regime
 *     rewards trend alignment over deep mean-reversion).
 *
 *  The charter below is the "system prompt" the AI signals call uses — it is
 *  the tested strategy, written down. STRATEGY_REV is bumped whenever the
 *  scoring changes, which invalidates the published backtest until re-run. */

import { smaSeries, rsiSeries, macdSeries } from "@/lib/indicators";

export const STRATEGY_REV = "egx-trend-v1";

export type ChartPointLite = {
  date: string;
  close: number;
  volume: number | null;
  high?: number | null;
  low?: number | null;
};

export type StrategyFeatures = {
  ticker: string;
  close: number;
  trend: number; // -1..+1  price vs SMA20/50/200 + SMA50/SMA200 alignment
  momentum: number; // -1..+1  RSI regime + MACD histogram
  volumeC: number; // -1..+1  volume confirmation vs 20-session average
  position52: number; // -1..+1  place inside the rolling 52-week range
  pullback: number; // -1..+1  distance below the 20-session high (entry quality)
  atrPct: number; // % of price — risk context (volatility)
  volRatio20: number | null; // raw volume ratio for evidence
  rsi: number | null; // raw RSI for evidence
  macdHist: number | null; // raw MACD histogram for evidence
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  pos52: number | null; // raw 0..100 position for evidence
  belowHigh20Pct: number | null; // % below the 20-session high
  score: number; // composite -1..+1
  evidence: string[]; // short bilingual-safe evidence codes
};

/** Average True Range % (of close) over `n` sessions — EGX risk sizing unit. */
export function atrPctAt(pts: ChartPointLite[], n = 14): number | null {
  if (pts.length < n + 1) return null;
  let sum = 0;
  let count = 0;
  for (let i = pts.length - n; i < pts.length; i++) {
    const h = pts[i].high ?? pts[i].close;
    const l = pts[i].low ?? pts[i].close;
    const pc = pts[i - 1].close;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    sum += tr;
    count++;
  }
  const atr = count > 0 ? sum / count : null;
  const close = pts[pts.length - 1].close;
  return atr !== null && close > 0 ? (atr / close) * 100 : null;
}

function lastOf(series: (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) return v;
  }
  return null;
}

/** Core scoring — see the charter. `pts` must be the candles UP TO AND
 *  INCLUDING the evaluation session (slice before calling). */
export function strategyFeaturesAt(ticker: string, pts: ChartPointLite[]): StrategyFeatures | null {
  if (pts.length < 60) return null; // not enough history for a honest read
  const closes = pts.map((p) => p.close);
  const price = closes[closes.length - 1];
  if (!(price > 0)) return null;

  const sma20 = lastOf(smaSeries(closes, 20));
  const sma50 = lastOf(smaSeries(closes, 50));
  const sma200 = lastOf(smaSeries(closes, 200));
  const rsi = lastOf(rsiSeries(closes, 14));
  const macdHist = lastOf(macdSeries(closes).hist);

  // volume confirmation: last session vs 20-session average
  const vols = pts.slice(-21, -1).map((p) => p.volume ?? 0);
  const lastVol = pts[pts.length - 1].volume ?? 0;
  const avgVol = vols.length === 20 && vols.every((v) => v >= 0) ? vols.reduce((a, b) => a + b, 0) / 20 : null;
  const volRatio20 = avgVol !== null && avgVol > 0 ? lastVol / avgVol : null;

  // rolling 52-week position (uses whatever history we have, min 60)
  const window = Math.min(pts.length, 250);
  const slice = closes.slice(-window);
  const hi = Math.max(...slice);
  const lo = Math.min(...slice);
  const pos52 = hi > lo ? ((price - lo) / (hi - lo)) * 100 : null;

  // distance below the 20-session high (pullback quality)
  const hi20 = Math.max(...closes.slice(-20));
  const belowHigh20Pct = hi20 > 0 ? ((hi20 - price) / hi20) * 100 : null;

  const atr = atrPctAt(pts, 14);

  // ── factor scores (each -1..+1 unless noted) ──

  let trend = 0;
  let trendParts = 0;
  if (sma20 !== null) {
    trend += price > sma20 ? 1 : -1;
    trendParts++;
  }
  if (sma50 !== null) {
    trend += price > sma50 ? 1 : -1;
    trendParts++;
  }
  if (sma200 !== null) {
    trend += price > sma200 ? 1.5 : -1.5; // the long-term line weighs most
    trendParts += 1.5;
  }
  if (sma50 !== null && sma200 !== null) {
    trend += sma50 > sma200 ? 1 : -1; // golden/death cross alignment
    trendParts += 1;
  }
  if (trendParts > 0) trend = trend / trendParts;

  let momentum = 0;
  if (rsi !== null) {
    if (rsi >= 50 && rsi <= 65) momentum += 1; // healthy trend thrust
    else if (rsi > 65 && rsi <= 70) momentum += 0.4; // strong but stretched
    else if (rsi > 70) momentum -= 0.6; // overbought — poor entry
    else if (rsi >= 40 && rsi < 50) momentum -= 0.2; // soft
    else if (rsi < 30) momentum -= 0.8; // falling knife
    else momentum -= 0.5; // 30-40 weak
  }
  if (macdHist !== null) momentum += macdHist > 0 ? 1 : -1;
  momentum = Math.max(-1, Math.min(1, momentum / 2));

  let volumeC = 0;
  if (volRatio20 !== null) {
    if (volRatio20 >= 1.5) volumeC = 1; // strong participation
    else if (volRatio20 >= 1.1) volumeC = 0.5;
    else if (volRatio20 >= 0.8) volumeC = 0;
    else volumeC = -0.5; // fading interest
  }

  let position52 = 0;
  if (pos52 !== null) {
    if (pos52 >= 60 && pos52 <= 95) position52 = 1; // breakout zone
    else if (pos52 > 95) position52 = -0.4; // extended
    else if (pos52 >= 40) position52 = 0.3;
    else if (pos52 >= 20) position52 = -0.4;
    else position52 = -0.8; // near lows — downtrend
  }

  let pullback = 0;
  if (belowHigh20Pct !== null) {
    if (belowHigh20Pct <= 3) pullback = 0.6; // at highs (momentum ok, no dip)
    else if (belowHigh20Pct <= 8) pullback = 1; // orderly dip — best entries
    else if (belowHigh20Pct <= 15) pullback = 0.2;
    else pullback = -0.7; // damaged
  }

  // ── composite (trend-first weighting) ──
  let score =
    0.34 * trend + 0.22 * momentum + 0.12 * volumeC + 0.16 * position52 + 0.16 * pullback;

  // volatility penalty: EGX circuit breakers make extreme-ATR names hazardous
  if (atr !== null && atr > 6) score *= 0.7;
  score = Math.max(-1, Math.min(1, score));

  // ── evidence codes (raw numbers, LLM/UI re-narrates them) ──
  const evidence: string[] = [];
  if (sma50 !== null) evidence.push(`close vs SMA50: ${price > sma50 ? "above" : "below"}`);
  if (sma200 !== null) evidence.push(`close vs SMA200: ${price > sma200 ? "above" : "below"}`);
  if (sma50 !== null && sma200 !== null)
    evidence.push(`SMA50 ${sma50 > sma200 ? ">" : "<"} SMA200`);
  if (rsi !== null) evidence.push(`RSI14 ${rsi.toFixed(1)}`);
  if (macdHist !== null) evidence.push(`MACD hist ${macdHist > 0 ? "positive" : "negative"}`);
  if (volRatio20 !== null) evidence.push(`volume ×${volRatio20.toFixed(2)} of 20d avg`);
  if (pos52 !== null) evidence.push(`52w position ${pos52.toFixed(0)}%`);
  if (belowHigh20Pct !== null) evidence.push(`${belowHigh20Pct.toFixed(1)}% below 20d high`);
  if (atr !== null) evidence.push(`ATR14 ${atr.toFixed(2)}% of price`);

  return {
    ticker,
    close: price,
    trend,
    momentum,
    volumeC,
    position52,
    pullback,
    atrPct: atr ?? 0,
    volRatio20,
    rsi,
    macdHist,
    sma20,
    sma50,
    sma200,
    pos52,
    belowHigh20Pct,
    score: Number(score.toFixed(3)),
    evidence,
  };
}

/** ATR-based risk levels for a long idea (the charter's default sizing). */
export function riskLevels(f: StrategyFeatures): { entry: number; stop: number; target: number; rr: number } | null {
  const atrAbs = (f.atrPct / 100) * f.close;
  if (!(atrAbs > 0)) return null;
  // entry: today's close (or the SMA20 dip if it sits within 1 ATR below)
  const entry = f.sma20 !== null && f.sma20 < f.close && f.close - f.sma20 < atrAbs ? f.sma20 : f.close;
  const stop = entry - 2 * atrAbs;
  const target = entry + 3 * atrAbs; // 1.5 reward per unit of risk
  const rr = (target - entry) / (entry - stop);
  return {
    entry: Number(entry.toFixed(2)),
    stop: Number(stop.toFixed(2)),
    target: Number(target.toFixed(2)),
    rr: Number(rr.toFixed(2)),
  };
}

/** THE CHARTER — the tested strategy, written down. This exact text (plus the
 *  live evidence pack) is the system prompt of the AI signals call, and the
 *  rule set the walk-forward backtest replays. Keep in sync with the scoring
 *  code above (STRATEGY_REV bumps on any change). */
export const STRATEGY_CHARTER = `EGX TREND STRATEGY — CHARTER (rev ${STRATEGY_REV})
You are the strategy engine of EGX Desk's AI Signals section. Your job: convert REAL computed evidence into disciplined, risk-sized EGX trade ideas. You are applying a rule set whose deterministic core was validated by a walk-forward backtest over 3 years of daily candles (see the backtest stats shipped with every request) — you re-weight evidence with judgment, but the RULES below are fixed.

ENTRY DISCIPLINE (long candidates):
1. TREND FIRST: price above SMA50 and SMA200, SMA50 above SMA200. A stock below its 200-day line is not a long, however cheap it looks.
2. MOMENTUM: RSI 50-65 is the healthy thrust zone; MACD histogram positive. RSI > 70 = stretched — either skip or demand a pullback entry. RSI < 40 = no long.
3. VOLUME CONFIRMS: session volume at or above the 20-day average. Moves on fading volume are suspect in a retail-driven market.
4. POSITION: inside the upper 40% of the 52-week range, ideally 60-95% (breakout territory). Above 95% = extended — prefer waiting for a dip toward SMA20.
5. PULLBACK QUALITY: 3-8% below the 20-session high is the sweet spot (orderly dip in an uptrend). More than 15% below = damaged trend.
AVOID / BEAR candidates: the mirror image — price below SMA50/SMA200, SMA50 under SMA200, MACD negative, RSI weak or knife-falling, near 52-week lows on weak volume.

RISK SIZING (fixed math, ATR-based):
- Entry: current close, or the SMA20 dip if it sits within 1 ATR below.
- Stop: entry − 2×ATR14. Target: entry + 3×ATR14 (reward:risk 1.5).
- Volatility guard: ATR > 6% of price → cut conviction in half (EGX ±10% circuit breakers). ATR > 9% → no idea, skip.
- LIQUIDITY GATE: only stocks with meaningful traded value. A thin name is not tradable advice, however good the chart.

EGX REALITY YOU MUST RESPECT:
- Frontier market: retail flows dominate, foreign flows swing it, EGP/USD episodes re-rate everything at once — a strong chart dies in a devaluation day. Correlations to the index are high; say when an idea is really a beta bet.
- Banks and a handful of heavyweights move the EGX30; a rising index can hide a weak tape — check breadth before calling a market bias.
- Circuit breakers and thin depth: stops are not guaranteed fills in Egypt; size positions so a limit-down day is survivable.
- Dividend season and CBE rate decisions move single names and the whole tape; earnings dates in the calendar are risk events for ideas that carry into them.

EVIDENCE PACK (three independent streams — use all of them):
- strategy/indicatorScore: the technical stream the charter rules above operate on (trend, momentum, volume, position).
- fundamentals: sector-relative valuation / quality / income pillars from reported financials — a secondary confirmation layer, never a standalone reason to override a failed technical gate.
- news: a rule-based lexicon over the last 14 days of the Egyptian business press (articles, bull/bear counts, score). Strongly one-sided press tone may raise or cut conviction by one notch; heavy bearish coverage is a disqualifying fact worth citing when it contradicts the chart. No press coverage (null) is neutral, never a penalty.

OUTPUT DISCIPLINE:
- Every number you state MUST come from the evidence pack (features, quotes, market context) — you never invent prices, ratios or dates. If a field is missing, say so.
- Conviction is 1-5 and must map to how many charter factors fully align (5 = all factors + market bias agrees; 1 = borderline).
- You may down-weight or SKIP a candidate the charter scores highly if the evidence pack shows a disqualifying fact (earnings tomorrow, ATR blowout, dead volume) — and you must say why.
- You may NOT upgrade a candidate the charter scores poorly. The rules are the ceiling of your enthusiasm.
- Write thesisAr in clear Egyptian-friendly MSA Arabic and thesisEn in English, each 2-4 sentences, concrete and tied to the evidence lines you cite.`;
