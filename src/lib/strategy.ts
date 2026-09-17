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

export const STRATEGY_REV = "egx-multi-v2";

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
  // T37 — price-adaptive level precision: a fixed 2dp round broke the
  // charter's R:R 1.5 for low-priced names (SPMD at ~0.6 EGP served
  // 0.60/0.56/0.67 → R:R 1.75 — the stop distance is only ~4 ticks wide,
  // so 2dp rounding is ~12% of the risk leg). Scale decimals with price so
  // rounding stays ~<1% of the risk leg, and report the R:R of the levels
  // actually SERVED (the number the report, XLSX and UI display).
  const dp = entry >= 20 ? 2 : entry >= 2 ? 3 : 4;
  const entryR = Number(entry.toFixed(dp));
  const stopR = Number(stop.toFixed(dp));
  const targetR = Number(target.toFixed(dp));
  const rrR = entryR - stopR > 0 ? (targetR - entryR) / (entryR - stopR) : 1.5;
  return { entry: entryR, stop: stopR, target: targetR, rr: Number(rrR.toFixed(2)) };
}

// ── T43 — the full trade plan (entry ZONE + ladder of three targets +
//    risk % of entry). Same ATR spine as riskLevels — the levels a user can
//    actually WORK with: a zone to place the limit order, a stop, and a
//    scale-out ladder (take partial at T1, more at T2, trail the runner to
//    T3) instead of a single all-or-nothing target. Selection math (the
//    ensemble gate) is untouched — the backtest's hold-10 exits stay valid;
//    the ladder is execution guidance layered on the same ATR numbers. ──

export type TradePlan = {
  entry: number; // same value riskLevels serves (compat: target === t2)
  stop: number;
  target: number; // === t2 (1.5R) — the level the old fields carried
  rr: number; // R:R of entry/stop/target as served
  zoneLo: number; // entry − 0.35 ATR (limit-order band floor)
  zoneHi: number; // entry + 0.35 ATR (band ceiling)
  t1: number; // entry + 2 ATR (1.0R — first partial)
  t2: number; // entry + 3 ATR (1.5R — the historical target)
  t3: number; // entry + 4.5 ATR (2.25R — the runner)
  riskPct: number; // (entry − stop) / entry × 100 — % of capital at risk per share
};

export function tradePlan(f: StrategyFeatures): TradePlan | null {
  const atrAbs = (f.atrPct / 100) * f.close;
  if (!(atrAbs > 0)) return null;
  const entry = f.sma20 !== null && f.sma20 < f.close && f.close - f.sma20 < atrAbs ? f.sma20 : f.close;
  const stop = entry - 2 * atrAbs;
  const t1 = entry + 2 * atrAbs;
  const t2 = entry + 3 * atrAbs;
  const t3 = entry + 4.5 * atrAbs;
  const zoneLo = entry - 0.35 * atrAbs;
  const zoneHi = entry + 0.35 * atrAbs;
  // T37 discipline: price-adaptive decimals so rounding stays ~<1% of the
  // risk leg, and every served ratio computed from the ROUNDED levels.
  const dp = entry >= 20 ? 2 : entry >= 2 ? 3 : 4;
  const r = (x: number) => Number(x.toFixed(dp));
  const entryR = r(entry);
  const stopR = r(stop);
  const t1R = r(t1);
  const t2R = r(t2);
  const t3R = r(t3);
  const riskLeg = entryR - stopR;
  const rrR = riskLeg > 0 ? Number(((t2R - entryR) / riskLeg).toFixed(2)) : 1.5;
  const riskPct = riskLeg > 0 ? Number(((riskLeg / entryR) * 100).toFixed(2)) : 0;
  return {
    entry: entryR,
    stop: stopR,
    target: t2R,
    rr: rrR,
    zoneLo: r(zoneLo),
    zoneHi: r(zoneHi),
    t1: t1R,
    t2: t2R,
    t3: t3R,
    riskPct,
  };
}

/** T43 — deterministic derivation of a plan from a persisted OLD set's
 *  entry/stop/target (the pre-T43 shape). ATR is recoverable exactly: the
 *  stop rule was entry − 2×ATR, so ATR = (entry − stop) / 2 — the zone and
 *  the T1/T3 rungs rebuild from the same spine with zero new information. */
export function planFromLegacy(entry: number, stop: number, target: number): {
  zoneLo: number; zoneHi: number; t1: number; t2: number; t3: number; riskPct: number;
} {
  const riskLeg = entry - stop; // = 2×ATR by the charter's stop rule
  const r = (x: number) => Number(x.toFixed(entry >= 20 ? 2 : entry >= 2 ? 3 : 4));
  const t1 = entry + riskLeg; // entry + 2 ATR (1R)
  const t3 = entry + riskLeg * 2.25; // entry + 4.5 ATR (2.25R)
  return {
    zoneLo: r(entry - riskLeg * 0.175),
    zoneHi: r(entry + riskLeg * 0.175),
    t1: r(t1),
    t2: target, // entry + 3 ATR (1.5R) as persisted
    t3: r(t3),
    riskPct: entry > 0 ? Number(((riskLeg / entry) * 100).toFixed(2)) : 0,
  };
}

/** THE CHARTER — the tested strategy ensemble, written down. This exact
 *  text (plus the live evidence pack) is the system prompt of the AI signals
 *  call, and the rule set the walk-forward backtest replays. Keep in sync
 *  with the ensemble in strategies.ts (STRATEGY_REV bumps on any change). */
export const STRATEGY_CHARTER = `EGX MULTI-STRATEGY ENSEMBLE — CHARTER (rev ${STRATEGY_REV})
You are the strategy engine of EGX Desk's AI Signals section. Your job: convert REAL computed evidence into disciplined, risk-sized EGX trade ideas. You are applying a TWELVE-STRATEGY ENSEMBLE whose deterministic core was validated by a walk-forward backtest over 3 years of daily candles (see the backtest stats shipped with every request) — you re-weight the ensemble's verdicts with judgment, but the RULES below are fixed.

THE ENSEMBLE (every verdict in the evidence pack is machine-computed; each candidate carries which strategies fired, in which direction, and at what strength):
1. Trend Rider (trend): price > SMA50 > SMA200 with positive MACD histogram.
2. Golden Cross (trend): SMA50 above SMA200, price above both — fresher crosses score higher.
3. Breakout Hunter (momentum): price within 2% of the 60-session high on expanding volume.
4. Mean Reversion (reversion): RSI under 35 while above SMA200 — buying the dip inside a long-term uptrend.
5. Bollinger Bounce (reversion): close pierced the lower Bollinger(20,2) band with weak RSI, above SMA100.
6. MACD Swing (momentum): MACD histogram ignition within 3 sessions, price on the right side of SMA50.
7. Volume Surge (volume): session volume >= 1.8x the 20-day average with a directional close away from SMA20.
8. Stochastic Cross (reversion): %K crossing %D from the oversold zone inside an uptrend (mirror for avoids).
9. 3-Month Momentum (momentum): 63-session ROC leadership >= +15% without a parabolic stretch over SMA50.
10. Pullback Continuation (trend): confirmed uptrend with an orderly 3-8% dip under the 20-session high, RSI 40-60.
11. Dividend Quality (fundamental): dividend yield >= 4% with a positive quality pillar and price above SMA200.
12. Press Confirmation (news): 14-day press lexicon strongly one-sided (>= +0.5 or <= -0.5) without technical contradiction.

CONSENSUS DISCIPLINE:
- The CONSENSUS score is the weighted vote of all counted strategies (trend/momentum weigh 0.9-1.0, reversion 0.7-0.8, volume 0.9, fundamental 0.7, news 0.6). Agreement = long votes / counted strategies.
- A high-consensus long with STRONG AGREEMENT (e.g. 7+/12 long) is the ensemble's best expression: multiple independent theses converge on the same tape.
- A single fired strategy is a hint, not a call — never upgrade a candidate because one strategy likes it while the consensus is weak.
- Strategies can CONTRADICT (breakout-hunter long vs mean-reversion avoid): cite the tension honestly when it exists; the consensus already nets it.
- You may down-weight or SKIP a consensus-strong candidate on a disqualifying fact (earnings tomorrow, ATR blowout, dead volume) — and you must say why.
- You may NOT upgrade a candidate the ensemble scores weakly. The consensus is the ceiling of your enthusiasm.

RISK SIZING (fixed math, ATR-based — the charterRisk levels are precomputed, cite them, never change them):
- Entry: current close, or the SMA20 dip if it sits within 1 ATR below.
- Stop: entry - 2x ATR14. Target: entry + 3x ATR14 (reward:risk 1.5).
- Volatility guard: ATR > 6% of price cuts the consensus to 70% (EGX +/-10% circuit breakers). ATR > 9% cuts it to 35% — near-disqualification.
- LIQUIDITY GATE: only stocks with meaningful traded value. A thin name is not tradable advice, however good the chart.

AVOID candidates: the mirror image — death-cross alignment, negative MACD ignition, 60-session breakdown territory, distribution days (volume surge on a down close), laggard 3-month ROC, or strongly bearish press tone.

EGX REALITY YOU MUST RESPECT:
- Frontier market: retail flows dominate, foreign flows swing it, EGP/USD episodes re-rate everything at once — a strong chart dies in a devaluation day. Correlations to the index are high; say when an idea is really a beta bet.
- Banks and a handful of heavyweights move the EGX30; a rising index can hide a weak tape — check breadth before calling a market bias.
- Circuit breakers and thin depth: stops are not guaranteed fills in Egypt; size positions so a limit-down day is survivable.
- Dividend season and CBE rate decisions move single names and the whole tape; earnings dates in the calendar are risk events for ideas that carry into them.

EVIDENCE PACK (four independent streams — use all of them):
- strategies: the 12-verdict ensemble read per candidate (fired ids, direction, strength, per-strategy evidence lines) plus the consensus and agreement numbers.
- indicatorScore/scan row: the 13-indicator technical read and the composite scan rating.
- fundamentals: sector-relative valuation / quality / income pillars from reported financials.
- news: a rule-based lexicon over the last 14 days of the Egyptian business press. Strongly one-sided press tone may raise or cut conviction by one notch; heavy bearish coverage is a disqualifying fact worth citing when it contradicts the chart. No press coverage (null) is neutral, never a penalty.

OUTPUT DISCIPLINE:
- Every number you state MUST come from the evidence pack (features, verdicts, quotes, market context) — you never invent prices, ratios or dates. If a field is missing, say so.
- Conviction is 1-5 and must map to agreement with the ensemble (5 = broad multi-strategy agreement + market bias agrees; 1 = single-strategy borderline).
- Write thesisAr in clear Egyptian-friendly MSA Arabic and thesisEn in English, each 2-4 sentences, concrete and tied to the evidence lines and strategy verdicts you cite.`;
