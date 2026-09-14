/** FUNDAMENTAL scoring engine — the "FA" half of the composite signal.
 *
 *  Everything here is computed ONLY from real TradingView scanner fields we
 *  already hold per stock (P/E, P/B, ROE, net margin, debt/equity, dividend
 *  yield, payout ratio) plus per-sector medians derived from the same live
 *  universe snapshot. No estimates, no analyst targets, no speculation —
 *  every number in a reason line is a field the scanner actually served.
 *
 *  Three pillars, each -1 … +1, null-safe (weights renormalize when a
 *  component is missing so a bank without P/B never gets punished):
 *
 *   VALUATION (pillar weight .40) — cheap vs the sector, not vs the world:
 *     - P/E   : log2(sectorMedian / pe), clamped ±1 → half the median = +1,
 *               double the median = −1. A loss-making TTM (pe ≤ 0) scores
 *               −0.5 with an explicit "loss-making" reason.        (w .60)
 *     - P/B   : same log2 ratio shape.                            (w .40)
 *
 *   QUALITY (pillar weight .35) — absolute, sector-agnostic anchors:
 *     - ROE        : clamp((roe − 8) / 17)  → 25% = +1, 8% = 0.    (w .45)
 *     - Net margin : clamp((m − 10) / 15)   → 25% = +1, 10% = 0.   (w .30)
 *     - Debt/Equity: clamp((1.2 − de) / .9) → 0.3 = +1, 1.2 = 0.  (w .25)
 *
 *   INCOME (pillar weight .25):
 *     - Div yield : clamp(dy / 10, −0.4 … +1) → 10% = +1, 0 = −0.4
 *                   (a non-payer is a mild minus on the EGX, not a sin).(w .70)
 *     - Payout    : ≤0.7 → +0.1 · 0.7–1 → −0.3 · >1 → −0.8
 *                   (unsustainable distribution).                  (w .30)
 *
 *  fundScore = weighted mean of the available pillars (renormalized); it is
 *  null when fewer than 2 of the 7 components exist — a stock with no
 *  fundamentals coverage stays technical-only instead of getting a noisy
 *  half-score. Rating thresholds mirror aggregateSignals() exactly, so a
 *  +0.6 fundamental means the same thing as a +0.6 technical. */

import type { Stock } from "@/lib/market";

export type Rating = "strongBuy" | "buy" | "neutral" | "sell" | "strongSell";

export type SectorStats = {
  n: number; // stocks contributing to the medians
  pe: number | null; // median of POSITIVE P/Es
  pb: number | null;
  roe: number | null;
  divYield: number | null;
};

export type Fundamentals = {
  score: number | null; // −1 … +1, null when coverage < 2 components
  rating: Rating; // derived; neutral when score is null
  coverage: number; // 0 … 1 — fraction of the 7 components with data
  valuation: number | null; // pillar scores
  quality: number | null;
  income: number | null;
  reasons: string[]; // short EN evidence lines
  reasonsAr: string[]; // short AR evidence lines
};

// ── helpers ──

const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));
const r1 = (v: number) => Number(v.toFixed(1));
const r2 = (v: number) => Number(v.toFixed(2));

function median(values: number[]): number | null {
  if (values.length < 5) return null; // a 2-stock "sector median" is noise
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Per-sector medians over the live universe (positive values only). */
export function sectorStatsMap(stocks: Stock[]): Map<string, SectorStats> {
  const by = new Map<string, Stock[]>();
  for (const s of stocks) {
    if (!s.sector) continue;
    const arr = by.get(s.sector) ?? [];
    arr.push(s);
    by.set(s.sector, arr);
  }
  const out = new Map<string, SectorStats>();
  for (const [sector, arr] of by) {
    out.set(sector, {
      n: arr.length,
      pe: median(arr.map((s) => s.pe).filter((v): v is number => v !== null && v > 0 && Number.isFinite(v))),
      pb: median(arr.map((s) => s.pb).filter((v): v is number => v !== null && v > 0 && Number.isFinite(v))),
      roe: median(arr.map((s) => s.roe).filter((v): v is number => v !== null && Number.isFinite(v))),
      divYield: median(arr.map((s) => s.divYield).filter((v): v is number => v !== null && v > 0 && Number.isFinite(v))),
    });
  }
  return out;
}

/** Market-wide medians — the fallback when a sector has too few names. */
export function marketStats(stocks: Stock[]): SectorStats {
  return {
    n: stocks.length,
    pe: median(stocks.map((s) => s.pe).filter((v): v is number => v !== null && v > 0 && Number.isFinite(v))),
    pb: median(stocks.map((s) => s.pb).filter((v): v is number => v !== null && v > 0 && Number.isFinite(v))),
    roe: median(stocks.map((s) => s.roe).filter((v): v is number => v !== null && Number.isFinite(v))),
    divYield: median(stocks.map((s) => s.divYield).filter((v): v is number => v !== null && v > 0 && Number.isFinite(v))),
  };
}

/** Sector stats when the sector has enough names, else the whole market. */
export function statsFor(stock: Stock, bySector: Map<string, SectorStats>, market: SectorStats): SectorStats {
  const s = stock.sector ? bySector.get(stock.sector) : undefined;
  return s && s.n >= 5 && (s.pe !== null || s.pb !== null || s.roe !== null) ? s : market;
}

// ── rating (same thresholds as aggregateSignals in indicators.ts) ──

export function ratingFromScore(score: number | null): Rating {
  if (score === null || !Number.isFinite(score)) return "neutral";
  if (score > 0.5) return "strongBuy";
  if (score > 0.1) return "buy";
  if (score < -0.5) return "strongSell";
  if (score < -0.1) return "sell";
  return "neutral";
}

// ── the engine ──

type Component = {
  key: string;
  weight: number;
  score: number | null;
  reason?: string;
  reasonAr?: string;
};

function weighted(components: Component[]): { score: number | null; count: number } {
  const live = components.filter((c) => c.score !== null);
  if (!live.length) return { score: null, count: 0 };
  const wSum = live.reduce((a, c) => a + c.weight, 0);
  return {
    score: live.reduce((a, c) => a + (c.score as number) * c.weight, 0) / wSum,
    count: live.length,
  };
}

export function computeFundamentals(stock: Stock, stats: SectorStats): Fundamentals {
  // VALUATION — cheap/expensive vs sector medians
  const val: Component[] = [];
  if (stock.pe !== null && Number.isFinite(stock.pe)) {
    if (stock.pe <= 0) {
      val.push({ key: "pe", weight: 0.6, score: -0.5, reason: "Loss-making TTM", reasonAr: "خسائر عن آخر ١٢ شهراً" });
    } else if (stats.pe !== null && stats.pe > 0) {
      const s = clamp(Math.log2(stats.pe / stock.pe));
      val.push({
        key: "pe",
        weight: 0.6,
        score: s,
        reason: `P/E ${r1(stock.pe)} vs sector ${r1(stats.pe)}`,
        reasonAr: `م/ع ${r1(stock.pe)} مقابل وسيط القطاع ${r1(stats.pe)}`,
      });
    } else {
      val.push({ key: "pe", weight: 0.6, score: null });
    }
  }
  if (stock.pb !== null && Number.isFinite(stock.pb) && stock.pb > 0 && stats.pb !== null && stats.pb > 0) {
    const s = clamp(Math.log2(stats.pb / stock.pb));
    val.push({
      key: "pb",
      weight: 0.4,
      score: s,
      reason: `P/B ${r2(stock.pb)} vs sector ${r2(stats.pb)}`,
      reasonAr: `م/قيمة دفترية ${r2(stock.pb)} مقابل وسيط القطاع ${r2(stats.pb)}`,
    });
  }

  // QUALITY — absolute anchors
  const qual: Component[] = [];
  if (stock.roe !== null && Number.isFinite(stock.roe)) {
    const s = clamp((stock.roe - 8) / 17);
    qual.push({
      key: "roe",
      weight: 0.45,
      score: s,
      reason: `ROE ${r1(stock.roe)}%`,
      reasonAr: `عائد حقوق الملكية ${r1(stock.roe)}%`,
    });
  }
  if (stock.netMarginTTM !== null && Number.isFinite(stock.netMarginTTM)) {
    const s = clamp((stock.netMarginTTM - 10) / 15);
    qual.push({
      key: "margin",
      weight: 0.3,
      score: s,
      reason: `Net margin ${r1(stock.netMarginTTM)}%`,
      reasonAr: `هامش صافي ${r1(stock.netMarginTTM)}%`,
    });
  }
  if (stock.debtToEquity !== null && Number.isFinite(stock.debtToEquity) && stock.debtToEquity >= 0) {
    const s = clamp((1.2 - stock.debtToEquity) / 0.9);
    qual.push({
      key: "de",
      weight: 0.25,
      score: s,
      reason: `D/E ${r2(stock.debtToEquity)}`,
      reasonAr: `دين/حقوق ملكية ${r2(stock.debtToEquity)}`,
    });
  }

  // INCOME — distributions
  const inc: Component[] = [];
  if (stock.divYield !== null && Number.isFinite(stock.divYield)) {
    const s = clamp(stock.divYield / 10, -0.4, 1);
    inc.push({
      key: "dy",
      weight: 0.7,
      score: s,
      reason: stock.divYield > 0.05 ? `Div yield ${r1(stock.divYield)}%` : stock.divYield > 0 ? `Div yield ${r1(stock.divYield)}% (thin)` : "No dividend",
      reasonAr: stock.divYield > 0.05 ? `عائد توزيعات ${r1(stock.divYield)}%` : stock.divYield > 0 ? `عائد توزيعات ${r1(stock.divYield)}% (ضعيف)` : "بدون توزيعات",
    });
  }
  if (stock.payoutRatio !== null && Number.isFinite(stock.payoutRatio) && stock.payoutRatio >= 0) {
    const s = stock.payoutRatio > 1 ? -0.8 : stock.payoutRatio > 0.7 ? -0.3 : 0.1;
    inc.push({
      key: "payout",
      weight: 0.3,
      score: s,
      reason: `Payout ${Math.round(stock.payoutRatio * 100)}%${stock.payoutRatio > 1 ? " (unsustainable)" : ""}`,
      reasonAr: `نسبة توزيع ${Math.round(stock.payoutRatio * 100)}%${stock.payoutRatio > 1 ? " (غير مستدامة)" : ""}`,
    });
  }

  const v = weighted(val);
  const q = weighted(qual);
  const i = weighted(inc);
  const total = v.count + q.count + i.count;

  let score: number | null = null;
  if (total >= 2) {
    let wSum = 0;
    let acc = 0;
    if (v.score !== null) {
      acc += v.score * 0.4;
      wSum += 0.4;
    }
    if (q.score !== null) {
      acc += q.score * 0.35;
      wSum += 0.35;
    }
    if (i.score !== null) {
      acc += i.score * 0.25;
      wSum += 0.25;
    }
    score = wSum > 0 ? acc / wSum : null;
  }

  const reasons: string[] = [];
  const reasonsAr: string[] = [];
  for (const c of [...val, ...qual, ...inc]) {
    if (c.score !== null && c.reason) {
      reasons.push(c.reason);
      reasonsAr.push(c.reasonAr ?? c.reason);
    }
  }

  return {
    score: score !== null ? Number(clamp(score).toFixed(3)) : null,
    rating: ratingFromScore(score),
    coverage: total / 7,
    valuation: v.score !== null ? Number(v.score.toFixed(3)) : null,
    quality: q.score !== null ? Number(q.score.toFixed(3)) : null,
    income: i.score !== null ? Number(i.score.toFixed(3)) : null,
    reasons: reasons.slice(0, 7),
    reasonsAr: reasonsAr.slice(0, 7),
  };
}

/** Composite of the technical and fundamental scores: 55% TA + 45% FA when
 *  fundamentals have coverage; pure technical otherwise (honest fallback,
 *  never punishes a stock for missing scanner fields). */
export function compositeScores(tech: number, fund: number | null): { composite: number; fundWeight: number } {
  if (fund === null) return { composite: Number(tech.toFixed(3)), fundWeight: 0 };
  return { composite: Number((0.55 * tech + 0.45 * fund).toFixed(3)), fundWeight: 0.45 };
}

/** T32 — three-pillar composite: TECHNICAL + FUNDAMENTAL + NEWS.
 *
 *  Base blend 45% TA / 30% FA / 25% news. The news pillar is deliberately
 *  capped at 25% (a rule-based lexicon over 14 days of press — real, but
 *  noisier than price or reported financials) and its weight is NEVER
 *  inflated by a missing fundamental pillar: when fundamentals are null
 *  their 30% goes to the technical half (75/25), not to news. Missing news
 *  falls back to the T31 55/45 blend; both missing = pure technical. */
export function compositeScores3(
  tech: number,
  fund: number | null,
  news: number | null
): { composite: number; fundWeight: number; newsWeight: number } {
  if (fund === null && news === null)
    return { composite: Number(tech.toFixed(3)), fundWeight: 0, newsWeight: 0 };
  if (news === null)
    return {
      composite: Number((0.55 * tech + 0.45 * (fund ?? 0)).toFixed(3)),
      fundWeight: 0.45,
      newsWeight: 0,
    };
  if (fund === null)
    return {
      composite: Number((0.75 * tech + 0.25 * news).toFixed(3)),
      fundWeight: 0,
      newsWeight: 0.25,
    };
  return {
    composite: Number((0.45 * tech + 0.3 * fund + 0.25 * news).toFixed(3)),
    fundWeight: 0.3,
    newsWeight: 0.25,
  };
}
