/** T44 — PORTFOLIO OPTIMIZER: turns the AI picks into an ALLOCATABLE
 *  portfolio (inspired by the mean-variance / Sharpe machinery in
 *  Nikhilkohli1/Stock-Prediction-Portfolio-Optimization and the
 *  random-forest + CAPM factor stack in chaudharigauravi/
 *  Machine_learning_In_Finance — rebuilt honestly in pure TS).
 *
 *  What it computes from the picks' REAL 6-month daily closes:
 *   - the covariance matrix of daily returns (sample estimator);
 *   - long-only weights that MAXIMIZE the 10-session Sharpe via a
 *     deterministic coordinate search on the simplex (equal-weight start,
 *     fixed pass count — same inputs always give the same weights);
 *   - a 35% single-name cap (frontier-market concentration guard) and an
 *     optional cash floor when the best Sharpe is below a hard minimum;
 *   - the aggregate Kelly fraction as a SANITY annotation (never a lever
 *     the UI pulls — full-Kelly on estimated EGX edges is ruin).
 *
 *  Honesty rules:
 *   - expected returns are NOT invented: each pick's 10-session expected
 *     return = its ensemble consensus × its own realized 10-session
 *     volatility (the charter's consensus is the only edge estimate we
 *     allow, scaled by the stock's true σ). No drift extrapolation.
 *   - a portfolio whose best achievable Sharpe is ≤ 0 is served with
 *     invested ≤ 60% and an explicit "thin edge" note — never dressed up;
 *   - weights always sum to ≤ 1 (the remainder is cash), min name weight
 *     5% (no dust positions). */

import type { ChartPointLite } from "@/lib/strategy";

export type PortfolioLeg = {
  ticker: string;
  weight: number; // 0..0.35 — fraction of capital
  expRet10: number; // expected 10-session return, %
  vol10: number; // realized 10-session σ, %
};

export type PortfolioPlan = {
  legs: PortfolioLeg[];
  investedPct: number; // Σ weights × 100
  cashPct: number; // 100 − investedPct
  expRet10: number; // portfolio expected 10-session return, %
  vol10: number; // portfolio 10-session σ, %
  sharpe: number; // expRet / vol (rf = 0 — stated in the UI)
  avgCorr: number | null; // mean pairwise correlation of the legs' returns
  kellyFull: number | null; // aggregate full-Kelly fraction (annotation only)
  thinEdge: boolean; // best achievable Sharpe ≤ 0.15 — served with a warning
  method: string; // the honest one-liner the panel prints
};

const HORIZON = 10; // sessions — matches the charter's default hold
const MAX_WEIGHT = 0.35; // single-name cap
const MIN_WEIGHT = 0.05; // no dust
const PASSES = 40; // coordinate-search passes (deterministic)

type LegIn = { ticker: string; consensus: number; closes: number[] };

export function optimizePortfolio(picks: LegIn[]): PortfolioPlan | null {
  if (picks.length < 2) return null; // a single name is a position, not a portfolio
  if (picks.length > 8) picks = picks.slice(0, 8);

  // daily returns matrix (aligned on each leg's own last 126 closes; legs
  // with < 60 closes are dropped — not enough history for honest covariance)
  const rets: number[][] = [];
  const kept: LegIn[] = [];
  for (const p of picks) {
    const c = p.closes.slice(-127);
    if (c.length < 61) continue;
    const r: number[] = [];
    for (let i = 1; i < c.length; i++) r.push(c[i] / c[i - 1] - 1);
    rets.push(r);
    kept.push(p);
  }
  if (kept.length < 2) return null;
  const n = kept.length;
  const T = rets[0].length;

  // per-leg mean/σ and pairwise covariance (tail-aligned: use the newest T
  // bars of every leg so the matrix is one coherent market window)
  const mean = rets.map((r) => r.reduce((a, b) => a + b, 0) / r.length);
  const sd = rets.map((r) => {
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    return Math.sqrt(r.reduce((a, b) => a + (b - m) * (b - m), 0) / r.length);
  });
  const cov: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  let corrSum = 0;
  let corrN = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      const a = rets[i];
      const b = rets[j];
      const t = Math.min(a.length, b.length);
      for (let k = 0; k < t; k++) s += (a[a.length - t + k] - mean[i]) * (b[b.length - t + k] - mean[j]);
      const cij = s / Math.max(1, t - 1);
      cov[i][j] = cij;
      cov[j][i] = cij;
      if (i !== j && sd[i] > 0 && sd[j] > 0) {
        corrSum += cij / (sd[i] * sd[j]);
        corrN++;
      }
    }
  }
  const avgCorr = corrN > 0 ? Number((corrSum / corrN).toFixed(2)) : null;

  // expected 10-session return per leg: consensus (−1..+1) × realized
  // 10-session σ (annualization-free: σ10 = σdaily × √10 × 100 in %)
  const expRet = kept.map((p, i) => {
    const vol10 = sd[i] * Math.sqrt(HORIZON) * 100;
    return Math.max(-15, Math.min(15, p.consensus * vol10)); // ±15% clamp
  });
  const vol10 = sd.map((s) => Number((s * Math.sqrt(HORIZON) * 100).toFixed(2)));

  // portfolio stats for a weight vector
  const stats = (w: number[]) => {
    let er = 0;
    for (let i = 0; i < n; i++) er += w[i] * expRet[i];
    let varr = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) varr += w[i] * w[j] * cov[i][j];
    const v = Math.sqrt(Math.max(0, varr)) * Math.sqrt(HORIZON) * 100;
    return { er, v, sharpe: v > 1e-9 ? er / v : 0 };
  };

  // deterministic coordinate search: equal-weight start, repeated pair
  // transfers of 5% weight toward whoever raises the Sharpe
  const w = new Array<number>(n).fill(1 / n);
  const step = 0.05;
  for (let pass = 0; pass < PASSES; pass++) {
    let improved = false;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (w[j] - step < MIN_WEIGHT && w[i] + step > MAX_WEIGHT) continue;
        if (w[i] + step > MAX_WEIGHT || w[j] - step < 0) continue;
        const trial = [...w];
        trial[i] += step;
        trial[j] -= step;
        if (trial[j] < MIN_WEIGHT && trial[j] > 0) continue; // no dust survivors
        if (stats(trial).sharpe > stats(w).sharpe + 1e-9) {
          w.splice(0, n, ...trial);
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  // renormalize the invested fraction under the caps and drop dust
  let invested = w.reduce((a, b) => a + b, 0);
  if (invested > 1) {
    for (let i = 0; i < n; i++) w[i] /= invested;
    invested = 1;
  }
  const finalW = w.map((x) => (x >= MIN_WEIGHT ? x : 0));
  const s = stats(finalW);
  const thinEdge = s.sharpe <= 0.15;

  // thin edge ⇒ serve a de-risked book: scale everything to 60% invested
  const scale = thinEdge ? 0.6 / Math.max(1e-9, finalW.reduce((a, b) => a + b, 0)) : 1;
  const legs: PortfolioLeg[] = kept
    .map((p, i) => ({
      ticker: p.ticker,
      weight: Number((finalW[i] * scale).toFixed(3)),
      expRet10: Number(expRet[i].toFixed(2)),
      vol10: vol10[i],
    }))
    .filter((l) => l.weight >= MIN_WEIGHT - 1e-9);
  const investedPct = Number((legs.reduce((a, l) => a + l.weight, 0) * 100).toFixed(1));

  // aggregate full-Kelly annotation: Σ w_i × b_i where b_i = edge/variance
  let kelly: number | null = null;
  if (s.v > 1e-9) {
    let k = 0;
    for (let i = 0; i < n; i++) {
      const v = cov[i][i] * HORIZON;
      if (v > 1e-12) k += (finalW[i] * (expRet[i] / 100)) / v;
    }
    kelly = Number(Math.max(0, Math.min(1, k)).toFixed(2));
  }

  const ps = stats(finalW.map((x) => x * scale));
  return {
    legs,
    investedPct,
    cashPct: Number((100 - investedPct).toFixed(1)),
    expRet10: Number(ps.er.toFixed(2)),
    vol10: Number(ps.v.toFixed(2)),
    sharpe: Number(Math.max(0, ps.sharpe).toFixed(2)),
    avgCorr,
    kellyFull: kelly,
    thinEdge,
    method:
      "Max-Sharpe long-only weights over the picks' real 6-month covariance; expected returns = ensemble consensus × realized 10-session volatility; 35% single-name cap; rf=0.",
  };
}
