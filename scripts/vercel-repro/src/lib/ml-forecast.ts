/** T44 — ML FORECAST ENGINE (the quant core of the signals upgrade).
 *
 *  A per-ticker logistic-regression model, TRAINED IN-PROCESS on the SAME
 *  candles the strategy engine already reads (no external service, no
 *  precomputed magic numbers). Inspired by the feature-extraction /
 *  multi-model pipelines in Nikhilkohli1/Stock-Prediction-Portfolio-Optimization
 *  and chaudharigauravi/Machine_learning_In_Finance, rebuilt to fit this
 *  app's house rules:
 *
 *  HONESTY CONTRACT:
 *   - DETERMINISTIC: weights start at ZERO, fixed learning rate, fixed epoch
 *     count, fixed feature set — the same candles always produce the same
 *     probability (no RNG anywhere, ever).
 *   - NO LOOKAHEAD: feature row i is computed from candles [0..i] ONLY; the
 *     label for row i reads the NEXT `HORIZON` closes after i. The model
 *     that predicts "today" is trained on rows whose labels are fully in
 *     the past, and its quality is measured by one-step-ahead predictions
 *     on the held-out validation tail — the same discipline the
 *     walk-forward backtest applies to the rule strategies.
 *   - REPORTED WITH ITS OWN SCORECARD: every forecast ships with the
 *     model's hit rate on its validation window and the number of training
 *     rows. A model that never validated above coin-flip is served at
 *     reduced strength (see ml-forecast strategy in strategies.ts) — we
 *     never present a weak learner as an oracle.
 *
 *  Model: p(up over next 5 sessions) = sigmoid(w·x), 9 features, trained
 *  with plain gradient descent (batch size = all rows, L2 = 0). ~150 epochs
 *  over ≤ ~200 rows trains in well under a millisecond per stock. */

import { smaSeries, rsiSeries, macdSeries } from "@/lib/indicators";
import type { ChartPointLite } from "@/lib/strategy";

export type MlForecast = {
  /** probability (0..1) that the next 5 sessions net a positive return */
  probUp: number;
  /** hit rate of the held-out validation tail (directional accuracy on
   *  bars whose labels the model NEVER saw in training — strict holdout:
   *  training labels end VAL_BARS + HORIZON bars before the last candle) */
  hitRate: number | null;
  /** rows the model was trained on */
  trainedRows: number;
  /** one-step-ahead rows the hit rate was measured on */
  valRows: number;
  /** training-window mean |Δw| — tiny ⇒ the model saw a degenerate tape
   *  (flat/suspended): the forecast is then honest but weak */
  converged: boolean;
};

const HORIZON = 5; // label horizon (sessions)
const MIN_BARS = 160; // need this many candles to train at all
const VAL_BARS = 40; // held-out one-step-ahead validation tail
const EPOCHS = 150;
const LR = 0.55; // learning rate — tuned once, frozen (determinism)

const FEATS = 9;

/** Feature row at index i — reads candles [0..i] only.
 *  Every feature is scale-free (ratio/percent/bounded) so one fixed learning
 *  rate works across 0.5 EGP and 500 EGP names alike. */
function featureRow(
  closes: number[],
  vols: (number | null)[],
  i: number
): number[] | null {
  const c = closes[i];
  if (!(c > 0)) return null;
  // returns over 5 and 10 sessions
  const ret5 = i >= 5 ? (c - closes[i - 5]) / closes[i - 5] : null;
  const ret10 = i >= 10 ? (c - closes[i - 10]) / closes[i - 10] : null;
  // RSI14 (bounded 0..100 → −0.5..0.5)
  const rsiWindow = closes.slice(0, i + 1);
  const rsiArr = rsiSeries(rsiWindow, 14);
  const rsi = rsiArr.length ? rsiArr[rsiArr.length - 1] : null;
  // MACD histogram, normalized by price (scale-free)
  const macdArr = macdSeries(closes.slice(0, i + 1));
  const hist = macdArr.hist.length ? macdArr.hist[macdArr.hist.length - 1] : null;
  const macdNorm = hist !== null && hist !== undefined && Number.isFinite(hist) ? hist / c : null;
  // volume ratio vs the PREVIOUS 20 sessions (no self-inclusion)
  let volRatio: number | null = null;
  if (i >= 21) {
    const prev = vols.slice(i - 20, i);
    const nums = prev.filter((v): v is number => v !== null && v !== undefined && v >= 0);
    if (nums.length === 20) {
      const avg = nums.reduce((a, b) => a + b, 0) / 20;
      const cur = vols[i];
      if (avg > 0 && cur !== null && cur !== undefined) volRatio = cur / avg;
    }
  }
  // position inside the 20-session range (0..1)
  let pos20: number | null = null;
  if (i >= 20) {
    const win = closes.slice(i - 19, i + 1);
    const hi = Math.max(...win);
    const lo = Math.min(...win);
    if (hi > lo) pos20 = (c - lo) / (hi - lo);
  }
  // distance from SMA50 in % (bounded via tanh-style clamp)
  let distSma50: number | null = null;
  if (i >= 50) {
    const s = smaSeries(closes.slice(0, i + 1), 50);
    const sma = s.length ? s[s.length - 1] : null;
    if (sma !== null && sma > 0) distSma50 = ((c - sma) / sma) * 100;
  }
  // realized volatility: stdev of the last 10 session returns (%)
  let vol10: number | null = null;
  if (i >= 11) {
    const rs: number[] = [];
    for (let j = i - 9; j <= i; j++) rs.push((closes[j] - closes[j - 1]) / closes[j - 1]);
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    const varr = rs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / rs.length;
    vol10 = Math.sqrt(varr) * 100;
  }
  if (
    ret5 === null || ret10 === null || rsi === null || macdNorm === null ||
    volRatio === null || pos20 === null || distSma50 === null || vol10 === null
  ) {
    return null;
  }
  const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
  return [
    clamp(ret5 * 10, 1), // 5-session return, ±10% → ±1
    clamp(ret10 * 10, 1),
    rsi / 100 - 0.5,
    clamp(macdNorm * 50, 1), // hist/price, 2% of price → 1
    clamp(volRatio - 1, 1), // 2× volume → +1
    pos20 - 0.5,
    clamp(distSma50 / 15, 1), // ±15% over SMA50 → ±1
    clamp(vol10 / 5, 1), // 5% daily σ → 1
    1, // bias term
  ];
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

/** Train on rows [0, trainEnd) and predict the feature row at `predictIdx`.
 *  Deterministic: zero init, fixed epochs/learning rate. Returns the weights
 *  so the caller can score the holdout tail with the SAME model. */
function trainModel(rows: { x: number[]; y: number }[]): { w: number[]; converged: boolean } {
  const w = new Array<number>(FEATS).fill(0);
  const n = rows.length;
  let lastDelta = Infinity;
  for (let ep = 0; ep < EPOCHS; ep++) {
    const grad = new Array<number>(FEATS).fill(0);
    for (const r of rows) {
      const p = sigmoid(w.reduce((a, wi, k) => a + wi * r.x[k], 0));
      const err = p - r.y;
      for (let k = 0; k < FEATS; k++) grad[k] += err * r.x[k];
    }
    let delta = 0;
    for (let k = 0; k < FEATS; k++) {
      const step = (LR * grad[k]) / Math.max(1, n);
      w[k] -= step;
      delta += Math.abs(step);
    }
    lastDelta = delta;
  }
  return { w, converged: lastDelta < 1e-4 };
}

const predictWith = (w: number[], x: number[]) => sigmoid(w.reduce((a, wi, k) => a + wi * x[k], 0));

/** Full forecast for one candle series — strict holdout validation:
 *  training labels end at bar (n − VAL_BARS − 1) (their HORIZON-ahead
 *  windows close before the validation zone starts), the SAME weights score
 *  the validation bars, and the served probability is the model's prediction
 *  at the LAST bar (whose label is, by construction, still in the future). */
export function mlForecast(pts: ChartPointLite[]): MlForecast | null {
  const n = pts.length;
  if (n < MIN_BARS) return null;
  const closes = pts.map((p) => p.close);
  const vols = pts.map((p) => p.volume ?? null);

  // label at bar i: mean of closes (i+1..i+HORIZON) vs close i (positive ⇒ 1)
  const labelAt = (i: number): number | null => {
    if (i + HORIZON >= n) return null;
    let sum = 0;
    let cnt = 0;
    for (let j = i + 1; j <= i + HORIZON; j++) {
      sum += closes[j];
      cnt++;
    }
    return closes[i] < sum / cnt ? 1 : 0;
  };

  // training set: every bar whose label fully resolves BEFORE the
  // validation zone — the model never sees a validation outcome
  const trainEnd = n - VAL_BARS - HORIZON;
  const trainRows: { x: number[]; y: number }[] = [];
  for (let i = 50; i <= trainEnd; i++) {
    const x = featureRow(closes, vols, i);
    const y = labelAt(i);
    if (x && y !== null) trainRows.push({ x, y });
  }
  if (trainRows.length < 60) return null; // too little signal to train honestly

  // holdout: score the validation bars with the frozen training weights
  const { w, converged } = trainModel(trainRows);
  let valHit = 0;
  let valN = 0;
  for (let i = n - VAL_BARS; i < n; i++) {
    const x = featureRow(closes, vols, i);
    const y = labelAt(i);
    if (!x || y === null) continue;
    if ((predictWith(w, x) >= 0.5 ? 1 : 0) === y) valHit++;
    valN++;
  }

  const xToday = featureRow(closes, vols, n - 1);
  if (!xToday) return null;

  return {
    probUp: Number(predictWith(w, xToday).toFixed(3)),
    hitRate: valN >= 10 ? Number((valHit / valN).toFixed(3)) : null,
    trainedRows: trainRows.length,
    valRows: valN,
    converged,
  };
}

/** Bounded in-process cache: one forecast per (ticker, last candle date) —
 *  the hourly scan and the 45-min AI refresh ask for the same thing. */
const g = globalThis as unknown as {
  __egxMlCache?: Map<string, { f: MlForecast | null; at: number }>;
};
const cache = (g.__egxMlCache ??= new Map());
const CACHE_TTL = 60 * 60_000;

export function mlForecastCached(ticker: string, pts: ChartPointLite[]): MlForecast | null {
  const lastDate = pts.length ? pts[pts.length - 1].date : "";
  const key = `${ticker}:${lastDate}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.f;
  const f = mlForecast(pts);
  if (cache.size > 400) cache.clear(); // bounded
  cache.set(key, { f, at: Date.now() });
  return f;
}
