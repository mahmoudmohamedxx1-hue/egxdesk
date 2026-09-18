/** EGX Desk MULTI-STRATEGY ENGINE (Task 42 → T44) — the signals upgrade.
 *
 *  The AI Signals section used to run ONE charter strategy (egx-trend-v1).
 *  It now runs an ENSEMBLE of EIGHTEEN independent, deterministic strategies
 *  — each with its own trigger, family weight and evidence codes — and the
 *  served consensus is the weighted vote of all applicable strategies.
 *
 *  Design rules (inherited from strategy.ts, unchanged):
 *   - NO LOOKAHEAD: every evaluation reads only the candles handed to it;
 *     the walk-forward backtest (scripts/backtest-signals.ts) replays
 *     history through these exact functions.
 *   - HONESTY: every verdict is machine-computed from real candles /
 *     scanner fields / the press lexicon / the ML model's own holdout
 *     scorecard / OFFICIAL EGX filings / the real investor-flow record.
 *     The LLM narrates and weighs verdicts; it never invents one.
 *   - EGX-AWARE: the liquidity gate and ATR volatility guard stay; each
 *     strategy declares its own family weight so trend/momentum read
 *     heavier than news/confirmation, mirroring the market's
 *     retail-momentum regime.
 *
 *  The 18 strategies (ids are stable — they ship in the API, XLSX and
 *  backtest evidence). T44 added the QUANT layer (13-16: ml-forecast,
 *  pattern-reversal, rsi-divergence, zscore-reversion) and the SMART-MONEY
 *  layer (17-18: insider-flow from official EGX filings, whale-watch from
 *  the real foreign-institution flow record):
 *    trend-rider        ِركوب الترند        SMA stack + MACD + RSI thrust
 *    golden-cross       التقاطع الذهبي      SMA50/SMA200 cross state + freshness
 *    breakout-hunter    صائد الاختراق       Donchian 60-session high proximity
 *    mean-reversion     ارتداد المتوسط      Connors-style dip in a long-term uptrend
 *    bb-bounce          ارتداد بولينجر      Lower-band pierce + RSI, above SMA100
 *    macd-swing         تأرجح ماكد          Fresh MACD-histogram ignition vs SMA50
 *    volume-surge       انفجار الحجم        ≥1.8× volume + up day + above SMA20
 *    stoch-cross        تقاطع الاستوكاستك   %K/%D cross from the oversold zone
 *    momentum-3m        زخم 3 أشهر          63-session ROC leadership, non-parabolic
 *    pullback-continue  تصحيح في ترند صاعد  Orderly 3-8% dip inside an uptrend
 *    dividend-quality   جودة التوزيعات      Yield + quality pillar, trend-safe
 *    press-tone         تأكيد الصحافة       14-day press lexicon strongly one-sided
 *    ml-forecast        توقع تعلم الآلة     Per-ticker logistic model (holdout-validated)
 *    pattern-reversal   أنماط الانعكاس      Engulfing / hammer / morning-evening star
 *    rsi-divergence     تباعد RSI            Price-vs-RSI swing divergence
 *    zscore-reversion   ارتداد الانحراف      50-session z-score stretch snap-back
 *    insider-flow       إشارة المطلعين      Official EGX insider/treasury filings
 *    whale-watch        رادار الحيتان       Foreign-institution flow regime
 */

import {
  smaSeries,
  rsiSeries,
  macdSeries,
  stochasticSeries,
  bollingerSeries,
  rocSeries,
} from "@/lib/indicators";
import { atrPctAt, type ChartPointLite } from "@/lib/strategy";
import type { MlForecast } from "@/lib/ml-forecast";

// ── types ──

export type StrategyFamily = "trend" | "momentum" | "reversion" | "volume" | "fundamental" | "news" | "ml" | "flow";

export type StrategyVerdict = {
  id: string;
  nameAr: string;
  nameEn: string;
  family: StrategyFamily;
  fired: boolean; // trigger conditions met
  direction: "long" | "avoid" | null; // null when not fired
  score: number; // 0..1 strength of the trigger when fired
  evidence: string[]; // machine evidence codes (EN; UI/evidenceAr translate)
};

export type StrategyCtx = {
  /** dividend yield in PERCENT (TradingView scanner field), null when absent */
  divYield: number | null;
  /** fundamentals quality pillar (−1..+1), null when coverage too thin */
  fundQuality: number | null;
  /** 14-day press-lexicon score (−1..+1), null when no attributed coverage */
  newsScore: number | null;
  /** the 13-indicator technical score of the scan row (−1..+1) */
  techScore: number;
  /** T44 — per-ticker ML forecast (data-gated strategy; ml-forecast.ts) */
  ml: MlForecast | null;
  /** T44 — official insider/major-holder filings read for this ticker */
  insider: InsiderRead | null;
  /** T44 — market-wide smart-money regime (foreign-institution flows) */
  whale: WhaleRead | null;
};

/** T44 — insider/major-holder filing read for ONE ticker over the last 90
 *  days of OFFICIAL EGX disclosures (post-execution forms + treasury
 *  trades). Built by lib/smart-money.ts from src/data/insiders.json. */
export type InsiderRead = {
  buys: number; // insider / major-holder BUY filings
  sells: number; // SELL filings
  treasuryBuys: number; // company treasury-share purchase filings
  treasurySells: number;
  lastDate: string | null; // most recent filing date (YYYY-MM-DD)
};

/** T44 — the market-wide smart-money regime, from the REAL EGX
 *  investor-category flow data (foreign institutions net, EGP mn). Null
 *  when the flow layer is unavailable — whale-watch then stays silent. */
export type WhaleRead = {
  forInstNet1d: number | null; // latest session, EGP mn
  forInstNet3d: number | null; // sum of the last 3 sessions, EGP mn
  instSharePct: number | null; // institutions' share of turnover (latest)
  asOf: string | null; // YYYY-MM-DD of the latest session in the read
};

export type EnsembleRead = {
  consensus: number; // −1..+1 weighted vote of all applicable strategies
  longVotes: number; // strategies firing long
  avoidVotes: number; // strategies firing avoid
  applicable: number; // strategies with enough data to fire at all
  agreement: number; // longVotes / applicable (0 when nothing applicable)
  verdicts: StrategyVerdict[]; // every applicable verdict, fired first
  evidence: string[]; // union of fired evidence codes (capped at 12)
};

export const STRATEGY_REGISTRY: { id: string; nameAr: string; nameEn: string; family: StrategyFamily; weight: number; oneLineAr: string; oneLineEn: string }[] = [
  { id: "trend-rider", nameAr: "ركوب الترند", nameEn: "Trend Rider", family: "trend", weight: 1.0,
    oneLineAr: "ترتيب المتوسطات 50/200 + ماكد موجب في منطقة اندفاع RSI الصحية", oneLineEn: "SMA50/200 stack + positive MACD inside the healthy RSI thrust zone" },
  { id: "golden-cross", nameAr: "التقاطع الذهبي", nameEn: "Golden Cross", family: "trend", weight: 0.9,
    oneLineAr: "المتوسط 50 فوق 200 والسعر فوق الاثنين — يقوى عند حداثة التقاطع", oneLineEn: "SMA50 above SMA200 with price above both — stronger when the cross is fresh" },
  { id: "breakout-hunter", nameAr: "صائد الاختراق", nameEn: "Breakout Hunter", family: "momentum", weight: 1.0,
    oneLineAr: "السعر على بعد ≤2% من قمة 60 جلسة (أو أراضٍ جديدة) مع توسّع في الحجم", oneLineEn: "Price within 2% of the 60-session high (or new-high ground) on expanding volume" },
  { id: "mean-reversion", nameAr: "ارتداد المتوسط", nameEn: "Mean Reversion", family: "reversion", weight: 0.8,
    oneLineAr: "هبوط RSI دون 35 والسعر فوق المتوسط 200 — شراء الترهّل داخل ترند صاعد", oneLineEn: "Connors-style: RSI under 35 while above SMA200 — buying the dip inside a long-term uptrend" },
  { id: "bb-bounce", nameAr: "ارتداد بولينجر", nameEn: "Bollinger Bounce", family: "reversion", weight: 0.8,
    oneLineAr: "اختراق الحد السفلي لبولينجر مع RSI ضعيف فوق المتوسط 100", oneLineEn: "Lower Bollinger pierce with weak RSI while above SMA100" },
  { id: "macd-swing", nameAr: "تأرجح ماكد", nameEn: "MACD Swing", family: "momentum", weight: 0.9,
    oneLineAr: "اشتعال هيستوغرام ماكد خلال 3 جلسات مع السعر فوق المتوسط 50", oneLineEn: "MACD-histogram ignition within 3 sessions with price above SMA50" },
  { id: "volume-surge", nameAr: "انفجار الحجم", nameEn: "Volume Surge", family: "volume", weight: 0.9,
    oneLineAr: "حجم ≥1.8× المتوسط مع إغلاق صاعد فوق المتوسط 20 (أو التوزيع عند الهبوط)", oneLineEn: "Volume ≥1.8× average with an up close above SMA20 (distribution on the mirror)" },
  { id: "stoch-cross", nameAr: "تقاطع الاستوكاستك", nameEn: "Stochastic Cross", family: "reversion", weight: 0.7,
    oneLineAr: "تقاطع %K فوق %D من منطقة التشبع البيعي داخل ترند عام صاعد", oneLineEn: "%K crossing %D up from the oversold zone inside an uptrend" },
  { id: "momentum-3m", nameAr: "زخم 3 أشهر", nameEn: "3-Month Momentum", family: "momentum", weight: 1.0,
    oneLineAr: "ريادة معدل التغير 63 جلسة ≥ +15% دون ذروة استثنائية فوق المتوسط 50", oneLineEn: "63-session ROC leadership ≥ +15% without a parabolic stretch over SMA50" },
  { id: "pullback-continue", nameAr: "تصحيح في ترند صاعد", nameEn: "Pullback Continuation", family: "trend", weight: 0.9,
    oneLineAr: "ترند صاعد مؤكد مع تصحيح منظم 3-8% تحت قمة 20 جلسة و RSI 40-60", oneLineEn: "Confirmed uptrend with an orderly 3-8% dip under the 20-session high, RSI 40-60" },
  { id: "dividend-quality", nameAr: "جودة التوزيعات", nameEn: "Dividend Quality", family: "fundamental", weight: 0.7,
    oneLineAr: "عائد توزيعات ≥4% مع ركيزة جودة موجبة وفوق المتوسط 200", oneLineEn: "Dividend yield ≥4% with a positive quality pillar and price above SMA200" },
  { id: "press-tone", nameAr: "تأكيد الصحافة", nameEn: "Press Confirmation", family: "news", weight: 0.6,
    oneLineAr: "نبرة الصحافة خلال 14 يومًا منحازة بقوة (≥+0.5 أو ≤−0.5) مع عدم تناقض فني", oneLineEn: "14-day press tone strongly one-sided (≥+0.5 or ≤−0.5) without technical contradiction" },
  { id: "ml-forecast", nameAr: "توقع تعلم الآلة", nameEn: "ML Forecast", family: "ml", weight: 0.8,
    oneLineAr: "نموذج لوجستي مدرّب على شموع السهم نفسه — احتمال صعود خلال 5 جلسات مع دقة مقاسة على عينة احتجاز حقيقية", oneLineEn: "Logistic model trained on the stock's own candles — P(up over 5 sessions) with a holdout-measured hit rate" },
  { id: "pattern-reversal", nameAr: "أنماط الانعكاس", nameEn: "Pattern Reversal", family: "reversion", weight: 0.7,
    oneLineAr: "شموع انعكاسية واضحة (ابتلاع، مطرقة، نجمة صباحية/مسائية) في سياق مناسب", oneLineEn: "Classic reversal candles (engulfing, hammer, morning/evening star) in the right context" },
  { id: "rsi-divergence", nameAr: "تباعد RSI", nameEn: "RSI Divergence", family: "reversion", weight: 0.75,
    oneLineAr: "السعر يسجل قاعًا أدنى بينما RSI يسجل قاعًا أعلى (أو العكس) — فقدان الزخم قبل الانعكاس", oneLineEn: "Price prints a lower low while RSI prints a higher low (or the bearish mirror) — momentum dying before the turn" },
  { id: "zscore-reversion", nameAr: "ارتداد الانحراف المعياري", nameEn: "Z-Score Reversion", family: "reversion", weight: 0.7,
    oneLineAr: "انحراف ≤−1.8 عن متوسط 50 جلسة (أو ≥+2 داخل ترند هابط) — ارتداد إحصائي", oneLineEn: "Z-score ≤−1.8 vs the 50-session mean (or ≥+2 inside a downtrend) — statistical snap-back" },
  { id: "insider-flow", nameAr: "إشارة المطلعين", nameEn: "Insider Flow", family: "flow", weight: 0.75,
    oneLineAr: "إفصاحات رسمية على البورصة: صافي شراء متصلين/مساهمين رئيسيين دون أي بيع خلال 90 يومًا", oneLineEn: "Official EGX filings: net insider / major-holder buying with zero sells over 90 days" },
  { id: "whale-watch", nameAr: "رادار الحيتان", nameEn: "Whale Watch", family: "flow", weight: 0.85,
    oneLineAr: "صافي تدفق المؤسسات الأجنبية لثلاث جلسات متتالية — اصطفاف الأموال الذكية مع الاتجاه", oneLineEn: "Foreign institutions net-buying (or selling) over 3 sessions — smart money aligned with the tape" },
];

const BY_ID = new Map(STRATEGY_REGISTRY.map((s) => [s.id, s]));

export function strategyById(id: string) {
  return BY_ID.get(id) ?? null;
}

// ── shared series helpers (last-value reads are inherently no-lookahead
//    when the caller slices candles to the evaluation bar in backtests) ──

function lastOf(series: (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) return v;
  }
  return null;
}

/** Sessions since the last sign change of (a − b), capped at `max`.
 *  Used for golden-cross freshness — reads only past bars. */
function sessionsSinceCross(a: (number | null)[], b: (number | null)[], max = 250): number | null {
  for (let i = a.length - 1; i > 0; i--) {
    const cur = a[i] !== null && b[i] !== null ? (a[i] as number) - (b[i] as number) : null;
    const prev = a[i - 1] !== null && b[i - 1] !== null ? (a[i - 1] as number) - (b[i - 1] as number) : null;
    if (cur !== null && prev !== null && Math.sign(cur) !== Math.sign(prev)) {
      return a.length - 1 - i + 1;
    }
    if (a.length - 1 - i > max) return null;
  }
  return null;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ── the 12 strategies ──

type Eval = Omit<StrategyVerdict, "id" | "nameAr" | "nameEn" | "family">;

function mk(id: string, e: Eval): StrategyVerdict {
  const meta = BY_ID.get(id);
  if (!meta) throw new Error(`unknown strategy id ${id}`);
  return {
    id,
    nameAr: meta.nameAr,
    nameEn: meta.nameEn,
    family: meta.family,
    fired: e.fired,
    direction: e.fired ? e.direction : null,
    score: e.fired ? clamp01(e.score) : 0,
    evidence: e.fired ? e.evidence : [],
  };
}

/** Evaluate ALL 12 strategies on one candle series. `pts` must be the
 *  candles up to and including the evaluation session (backtests slice). */
export function evaluateStrategies(pts: ChartPointLite[], ctx: StrategyCtx): StrategyVerdict[] {
  const out: StrategyVerdict[] = [];
  if (pts.length < 60) {
    // not enough history — every strategy is simply not applicable
    return STRATEGY_REGISTRY.map((s) => mk(s.id, { fired: false, direction: null, score: 0, evidence: [] }));
  }

  const closes = pts.map((p) => p.close);
  const price = closes[closes.length - 1];
  const prev = closes.length > 1 ? closes[closes.length - 2] : price;
  const dayChg = price - prev;

  const sma5 = lastOf(smaSeries(closes, 5));
  const sma20 = lastOf(smaSeries(closes, 20));
  const sma50 = lastOf(smaSeries(closes, 50));
  const sma100 = lastOf(smaSeries(closes, 100));
  const sma200 = lastOf(smaSeries(closes, 200));
  const sma50s = smaSeries(closes, 50);
  const sma200s = smaSeries(closes, 200);

  const rsi = lastOf(rsiSeries(closes, 14));
  const macd = macdSeries(closes);
  const macdHist = lastOf(macd.hist);
  const macdHistPrev = macd.hist.length > 1 ? macd.hist[macd.hist.length - 2] : null;
  const macdHist2 = macd.hist.length > 2 ? macd.hist[macd.hist.length - 3] : null;
  const macdHist3 = macd.hist.length > 3 ? macd.hist[macd.hist.length - 4] : null;

  const highs = pts.map((p) => p.high ?? null);
  const lows = pts.map((p) => p.low ?? null);
  const stoch = stochasticSeries(highs, lows, closes, 14, 3, 3);
  const stochK = lastOf(stoch.k);
  const stochKPrev = stoch.k.length > 1 ? stoch.k[stoch.k.length - 2] : null;
  const stochD = lastOf(stoch.d);
  const stochDPrev = stoch.d.length > 1 ? stoch.d[stoch.d.length - 2] : null;

  const bb = bollingerSeries(closes, 20, 2);
  const bbLower = lastOf(bb.lo);
  const bbLowerPrev = bb.lo.length > 1 ? bb.lo[bb.lo.length - 2] : null;

  const roc63 = lastOf(rocSeries(closes, 63));

  // volume confirmation (last session vs mean of the PREVIOUS 20 — same
  // convention as strategy.ts, no self-inclusion)
  const vols = pts.slice(-21, -1).map((p) => p.volume ?? 0);
  const lastVol = pts[pts.length - 1].volume ?? 0;
  const avgVol = vols.length === 20 && vols.every((v) => v >= 0) ? vols.reduce((a, b) => a + b, 0) / 20 : null;
  const volRatio20 = avgVol !== null && avgVol > 0 ? lastVol / avgVol : null;

  // donchian + pullback geometry
  const hi60 = Math.max(...closes.slice(-60));
  const lo60 = Math.min(...closes.slice(-60));
  const hi20 = Math.max(...closes.slice(-20));
  const belowHigh20Pct = hi20 > 0 ? ((hi20 - price) / hi20) * 100 : null;
  const pos60 = hi60 > lo60 ? ((price - lo60) / (hi60 - lo60)) * 100 : null;

  const atr = atrPctAt(pts, 14);

  // ── 1. trend-rider ──
  {
    let fired = false;
    let direction: "long" | "avoid" | null = null;
    let score = 0;
    const ev: string[] = [];
    if (sma50 !== null && sma200 !== null) {
      const longOk = price > sma50 && price > sma200 && sma50 > sma200 && macdHist !== null && macdHist > 0;
      const bearOk = price < sma50 && price < sma200 && sma50 < sma200 && macdHist !== null && macdHist < 0;
      if (longOk || bearOk) {
        fired = true;
        direction = longOk ? "long" : "avoid";
        score = 0.6;
        ev.push(longOk ? "trend: price > SMA50 > SMA200, MACD hist > 0" : "trend: price < SMA50 < SMA200, MACD hist < 0");
        if (rsi !== null) {
          if (direction === "long" && rsi >= 50 && rsi <= 65) {
            score += 0.2;
            ev.push(`RSI14 ${rsi.toFixed(1)} in thrust zone`);
          } else if (direction === "long" && rsi > 70) {
            score -= 0.2;
            ev.push(`RSI14 ${rsi.toFixed(1)} stretched`);
          } else if (direction === "avoid" && rsi < 40) {
            score += 0.2;
            ev.push(`RSI14 ${rsi.toFixed(1)} weak`);
          } else {
            ev.push(`RSI14 ${rsi.toFixed(1)}`);
          }
        }
        if (sma20 !== null && ((direction === "long" && price > sma20) || (direction === "avoid" && price < sma20))) score += 0.1;
      }
    }
    out.push(mk("trend-rider", { fired, direction, score, evidence: ev }));
  }

  // ── 2. golden-cross ──
  {
    let fired = false;
    let direction: "long" | "avoid" | null = null;
    let score = 0;
    const ev: string[] = [];
    if (sma50 !== null && sma200 !== null) {
      const golden = sma50 > sma200 && price > sma50;
      const death = sma50 < sma200 && price < sma50;
      if (golden || death) {
        fired = true;
        direction = golden ? "long" : "avoid";
        score = 0.55;
        ev.push(golden ? "SMA50 > SMA200 (golden), price > SMA50" : "SMA50 < SMA200 (death), price < SMA50");
        const since = sessionsSinceCross(sma50s, sma200s);
        if (since !== null && since <= 60) {
          score += 0.3; // fresh cross — the strongest stretch of the move
          ev.push(`cross ${since} sessions ago (fresh)`);
        } else if (since !== null) {
          score += 0.1;
          ev.push(`cross ${since} sessions ago`);
        }
      }
    }
    out.push(mk("golden-cross", { fired, direction, score, evidence: ev }));
  }

  // ── 3. breakout-hunter ──
  {
    let fired = false;
    let direction: "long" | "avoid" | null = null;
    let score = 0;
    const ev: string[] = [];
    const nearHigh = hi60 > 0 && (price - hi60) / hi60 >= -0.02;
    const nearLow = lo60 > 0 && (price - lo60) / lo60 <= 0.02;
    // range guard: a "high" of a dead-flat line is not a breakout — require
    // at least a 3% spread between the 60-session extremes before either
    // edge means anything (flat/suspended tapes never fire)
    const rangeOk = lo60 > 0 && hi60 > 0 && (hi60 - lo60) / lo60 >= 0.03;
    if (rangeOk && (nearHigh || nearLow)) {
      fired = true;
      direction = nearHigh ? "long" : "avoid";
      score = 0.6;
      ev.push(nearHigh ? `within 2% of 60-session high ${hi60.toFixed(2)}` : `within 2% of 60-session low ${lo60.toFixed(2)}`);
      if (pos60 !== null) {
        if (direction === "long" && pos60 >= 95) {
          score += 0.2;
          ev.push("at 60-session highs (new-high territory)");
        } else if (direction === "avoid" && pos60 <= 5) {
          score += 0.2;
          ev.push("at 60-session lows (breakdown territory)");
        } else {
          ev.push(`60-session position ${pos60.toFixed(0)}%`);
        }
      }
      if (volRatio20 !== null && volRatio20 >= 1.3) {
        score += 0.15;
        ev.push(`volume ×${volRatio20.toFixed(2)} of 20d avg`);
      }
    }
    out.push(mk("breakout-hunter", { fired, direction, score, evidence: ev }));
  }

  // ── 4. mean-reversion (Connors-style, long in uptrend / avoid in downtrend) ──
  {
    let fired = false;
    let direction: "long" | "avoid" | null = null;
    let score = 0;
    const ev: string[] = [];
    if (rsi !== null && sma200 !== null && sma5 !== null) {
      const dipLong = price > sma200 && rsi < 35 && price < sma5;
      const popAvoid = price < sma200 && rsi > 65 && price > sma5;
      if (dipLong || popAvoid) {
        fired = true;
        direction = dipLong ? "long" : "avoid";
        score = 0.6;
        if (dipLong) {
          if (rsi < 25) score = 1;
          else if (rsi < 30) score = 0.8;
          ev.push(`oversold dip RSI14 ${rsi.toFixed(1)} above SMA200`);
        } else {
          if (rsi > 75) score = 1;
          else if (rsi > 70) score = 0.8;
          ev.push(`overbought pop RSI14 ${rsi.toFixed(1)} below SMA200`);
        }
      }
    }
    out.push(mk("mean-reversion", { fired, direction, score, evidence: ev }));
  }

  // ── 5. bb-bounce ──
  {
    let fired = false;
    let direction: "long" | "avoid" | null = null;
    let score = 0;
    const ev: string[] = [];
    if (bbLower !== null && rsi !== null && sma100 !== null) {
      const pierced = price < bbLower || (bbLowerPrev !== null && prev < bbLowerPrev);
      const squeezeTop = false; // upper-band shorting stays out of scope (no shorting product)
      if (pierced && rsi < 40 && price > sma100) {
        fired = true;
        direction = "long";
        const depth = ((bbLower - price) / price) * 100;
        score = clamp01(0.55 + Math.max(0, depth) / 4); // deeper pierce → stronger snap thesis
        ev.push(`close below lower Bollinger(20,2)${depth > 0 ? ` by ${depth.toFixed(1)}%` : ""}`);
        ev.push(`RSI14 ${rsi.toFixed(1)} with price above SMA100`);
      }
      void squeezeTop;
    }
    out.push(mk("bb-bounce", { fired, direction, score, evidence: ev }));
  }

  // ── 6. macd-swing ──
  {
    let fired = false;
    let direction: "long" | "avoid" | null = null;
    let score = 0;
    const ev: string[] = [];
    if (macdHist !== null && sma50 !== null) {
      // ignition within the last 3 sessions: the sign change sits at n-2,
      // n-3 or n-4 (the first bar of the new sign is among the last 3)
      const crossedUpRecently = [macdHistPrev, macdHist2, macdHist3].some((h) => h !== null && h <= 0);
      const crossedDownRecently = [macdHistPrev, macdHist2, macdHist3].some((h) => h !== null && h >= 0);
      const ignitionUp = macdHist > 0 && crossedUpRecently;
      const ignitionDown = macdHist < 0 && crossedDownRecently;
      if (ignitionUp && price > sma50) {
        fired = true;
        direction = "long";
        score = 0.7;
        ev.push("MACD hist crossed positive within 3 sessions");
        ev.push("price above SMA50");
      } else if (ignitionDown && price < sma50) {
        fired = true;
        direction = "avoid";
        score = 0.7;
        ev.push("MACD hist crossed negative within 3 sessions");
        ev.push("price below SMA50");
      }
    }
    out.push(mk("macd-swing", { fired, direction, score, evidence: ev }));
  }

  // ── 7. volume-surge ──
  {
    let fired = false;
    let direction: "long" | "avoid" | null = null;
    let score = 0;
    const ev: string[] = [];
    if (volRatio20 !== null && sma20 !== null && volRatio20 >= 1.8) {
      const accumulation = dayChg > 0 && price > sma20;
      const distribution = dayChg < 0 && price < sma20;
      if (accumulation || distribution) {
        fired = true;
        direction = accumulation ? "long" : "avoid";
        score = clamp01(0.6 + (volRatio20 - 1.8) / 4); // 2.2× → 0.7, 3× → 0.9
        ev.push(`volume ×${volRatio20.toFixed(2)} of 20d avg`);
        ev.push(accumulation ? `up day (${((dayChg / prev) * 100).toFixed(1)}%) above SMA20` : `down day (${((dayChg / prev) * 100).toFixed(1)}%) below SMA20`);
      }
    }
    out.push(mk("volume-surge", { fired, direction, score, evidence: ev }));
  }

  // ── 8. stoch-cross ──
  {
    let fired = false;
    let direction: "long" | "avoid" | null = null;
    let score = 0;
    const ev: string[] = [];
    if (stochK !== null && stochD !== null && stochKPrev !== null && stochDPrev !== null && sma100 !== null) {
      const crossUp = stochKPrev <= stochDPrev && stochK > stochD && Math.min(stochKPrev, stochDPrev) < 25;
      const crossDown = stochKPrev >= stochDPrev && stochK < stochD && Math.max(stochKPrev, stochDPrev) > 75;
      if (crossUp && price > sma100) {
        fired = true;
        direction = "long";
        score = 0.65;
        ev.push(`stochastic %K crossed %D up from ${Math.min(stochKPrev, stochDPrev).toFixed(0)} (oversold)`);
        ev.push("price above SMA100");
      } else if (crossDown && price < sma100) {
        fired = true;
        direction = "avoid";
        score = 0.65;
        ev.push(`stochastic %K crossed %D down from ${Math.max(stochKPrev, stochDPrev).toFixed(0)} (overbought)`);
        ev.push("price below SMA100");
      }
    }
    out.push(mk("stoch-cross", { fired, direction, score, evidence: ev }));
  }

  // ── 9. momentum-3m ──
  {
    let fired = false;
    let direction: "long" | "avoid" | null = null;
    let score = 0;
    const ev: string[] = [];
    if (roc63 !== null && sma50 !== null) {
      const stretch = (price - sma50) / sma50;
      const leader = roc63 >= 15 && price > sma50 && stretch <= 0.3;
      const laggard = roc63 <= -15 && price < sma50 && stretch >= -0.3;
      if (leader) {
        fired = true;
        direction = "long";
        score = clamp01(0.6 + Math.min(roc63 - 15, 45) / 90); // +15% → 0.6, +60% → 1.0
        ev.push(`3-month ROC ${roc63.toFixed(1)}% (leadership)`);
        ev.push(`${(stretch * 100).toFixed(1)}% over SMA50 (non-parabolic)`);
      } else if (laggard) {
        fired = true;
        direction = "avoid";
        score = clamp01(0.6 + Math.min(-roc63 - 15, 45) / 90);
        ev.push(`3-month ROC ${roc63.toFixed(1)}% (laggard)`);
        ev.push(`${(stretch * 100).toFixed(1)}% under SMA50`);
      }
    }
    out.push(mk("momentum-3m", { fired, direction, score, evidence: ev }));
  }

  // ── 10. pullback-continue ──
  {
    let fired = false;
    let direction: "long" | "avoid" | null = null;
    let score = 0;
    const ev: string[] = [];
    if (sma50 !== null && sma200 !== null && belowHigh20Pct !== null && rsi !== null) {
      const orderly = price > sma200 && sma50 > sma200 && belowHigh20Pct >= 3 && belowHigh20Pct <= 8 && rsi >= 40 && rsi <= 60;
      if (orderly) {
        fired = true;
        direction = "long";
        score = 0.75;
        ev.push(`orderly dip ${belowHigh20Pct.toFixed(1)}% below 20-session high`);
        ev.push("uptrend intact (price > SMA200, SMA50 > SMA200)");
        ev.push(`RSI14 ${rsi.toFixed(1)} (reset zone)`);
        if (rsi >= 45 && rsi <= 55) {
          score += 0.1;
          ev.push("mid-zone reset — classic continuation window");
        }
      }
    }
    out.push(mk("pullback-continue", { fired, direction, score, evidence: ev }));
  }

  // ── 11. dividend-quality (fundamental family — scanner fields) ──
  {
    let fired = false;
    let direction: "long" | "avoid" | null = null;
    let score = 0;
    const ev: string[] = [];
    if (ctx.divYield !== null && ctx.fundQuality !== null && sma200 !== null) {
      if (ctx.divYield >= 4 && ctx.fundQuality > 0 && price > sma200) {
        fired = true;
        direction = "long";
        score = clamp01(0.6 + Math.min(ctx.divYield - 4, 8) / 16); // 4% → 0.6, 12% → 1.0
        ev.push(`dividend yield ${ctx.divYield.toFixed(1)}%`);
        ev.push(`quality pillar ${ctx.fundQuality.toFixed(2)} positive`);
        ev.push("price above SMA200 (trend-safe income)");
      }
    }
    out.push(mk("dividend-quality", { fired, direction, score, evidence: ev }));
  }

  // ── 12. press-tone (news family — 14-day press lexicon) ──
  {
    let fired = false;
    let direction: "long" | "avoid" | null = null;
    let score = 0;
    const ev: string[] = [];
    if (ctx.newsScore !== null && Math.abs(ctx.newsScore) >= 0.5) {
      const bull = ctx.newsScore >= 0.5 && ctx.techScore > -0.3; // press bull + technical not contradicting
      const bear = ctx.newsScore <= -0.5 && ctx.techScore < 0.3;
      if (bull || bear) {
        fired = true;
        direction = bull ? "long" : "avoid";
        score = clamp01(Math.abs(ctx.newsScore));
        ev.push(`press tone ${ctx.newsScore.toFixed(2)} (14-day lexicon)`);
        ev.push(`technical score ${ctx.techScore.toFixed(2)} not contradicting`);
      }
    }
    out.push(mk("press-tone", { fired, direction, score, evidence: ev }));
  }

  // ── 13. ml-forecast (T44 quant layer — the per-ticker model vote) ──
  {
    let fired = false;
    let direction: "long" | "avoid" | null = null;
    let score = 0;
    const ev: string[] = [];
    const ml = ctx.ml;
    // the model must have PROVEN itself on its holdout tail before its vote
    // counts: a coin-flip learner (hitRate < 0.52) carries no information and
    // stays silent — honesty over decoration
    if (ml && ml.hitRate !== null && ml.hitRate >= 0.52) {
      const strong = ml.hitRate >= 0.58; // validated learner scores full strength
      const mult = strong ? 1 : 0.7; // barely-above-coin learner caps at 0.7×
      if (ml.probUp >= 0.6) {
        fired = true;
        direction = "long";
        score = clamp01((0.55 + (ml.probUp - 0.6) * 1.1) * mult);
        ev.push(`model P(up, 5 sessions) ${(ml.probUp * 100).toFixed(0)}%`);
        ev.push(`holdout hit rate ${(ml.hitRate * 100).toFixed(0)}% over ${ml.valRows} bars (${ml.trainedRows} training rows)`);
      } else if (ml.probUp <= 0.4) {
        fired = true;
        direction = "avoid";
        score = clamp01((0.55 + (0.4 - ml.probUp) * 1.1) * mult);
        ev.push(`model P(up, 5 sessions) ${(ml.probUp * 100).toFixed(0)}%`);
        ev.push(`holdout hit rate ${(ml.hitRate * 100).toFixed(0)}% over ${ml.valRows} bars (${ml.trainedRows} training rows)`);
      }
    }
    out.push(mk("ml-forecast", { fired, direction, score, evidence: ev }));
  }

  // ── 14. pattern-reversal (engulfing / hammer / morning-evening star) ──
  {
    let fired = false;
    let direction: "long" | "avoid" | null = null;
    let score = 0;
    const ev: string[] = [];
    const n = pts.length;
    if (n >= 5) {
      const c1 = closes[n - 1];
      const c2 = closes[n - 2];
      const c3 = closes[n - 3];
      const c4 = closes[n - 4];
      const h1 = pts[n - 1].high ?? c1;
      const l1 = pts[n - 1].low ?? c1;
      const h2 = pts[n - 2].high ?? c2;
      const l2 = pts[n - 2].low ?? c2;
      const range1 = h1 - l1;
      const posInBar = range1 > 0 ? (c1 - l1) / range1 : 0.5; // close's place in the bar
      const dayPct = (v: number, base: number) => (base > 0 ? ((v - base) / base) * 100 : 0);

      // bullish set (needs dip context: RSI ≤ 45 — room to bounce)
      const bullCtx = rsi !== null && rsi <= 45;
      const bullEngulf = c1 > c2 && h1 > h2 && l1 < l2 && dayPct(c1, c2) > 0; // outside bar up
      const hammer = range1 > 0 && posInBar >= 0.7 && range1 / c1 >= 0.02 && c2 < closes[n - 3]; // long lower wick after a down day
      const morningStar =
        dayPct(c3, c4) <= -1.5 && Math.abs(dayPct(c2, c3)) <= 0.7 && dayPct(c1, c2) >= 1.2 && c1 >= (c4 + c3) / 2;
      if (bullCtx && (bullEngulf || hammer || morningStar)) {
        fired = true;
        direction = "long";
        score = morningStar ? 0.8 : 0.65;
        ev.push(
          morningStar
            ? "morning star: -1.5% day, inside bar, +1.2% recovery day"
            : bullEngulf
              ? `bullish outside bar (engulfing) +${dayPct(c1, c2).toFixed(1)}%`
              : `hammer: close in top ${(posInBar * 100).toFixed(0)}% of a ${(range1 / c1 * 100).toFixed(1)}%-range bar`
        );
        if (rsi !== null) ev.push(`RSI14 ${rsi.toFixed(1)} (dip context)`);
      }

      // bearish set (needs stretch context: RSI ≥ 55)
      const bearCtx = rsi !== null && rsi >= 55;
      const bearEngulf = c1 < c2 && h1 > h2 && l1 < l2 && dayPct(c1, c2) < 0; // outside bar down
      const shootingStar = range1 > 0 && posInBar <= 0.3 && range1 / c1 >= 0.02 && c2 > closes[n - 3]; // long upper wick after an up day
      const eveningStar =
        dayPct(c3, c4) >= 1.5 && Math.abs(dayPct(c2, c3)) <= 0.7 && dayPct(c1, c2) <= -1.2 && c1 <= (c4 + c3) / 2;
      if (!fired && bearCtx && (bearEngulf || shootingStar || eveningStar)) {
        fired = true;
        direction = "avoid";
        score = eveningStar ? 0.8 : 0.65;
        ev.push(
          eveningStar
            ? "evening star: +1.5% day, inside bar, -1.2% reversal day"
            : bearEngulf
              ? `bearish outside bar (engulfing) ${dayPct(c1, c2).toFixed(1)}%`
              : `shooting star: close in bottom ${(100 - posInBar * 100).toFixed(0)}% of a ${(range1 / c1 * 100).toFixed(1)}%-range bar`
        );
        if (rsi !== null) ev.push(`RSI14 ${rsi.toFixed(1)} (stretched context)`);
      }
    }
    out.push(mk("pattern-reversal", { fired, direction, score, evidence: ev }));
  }

  // ── 15. rsi-divergence (swing divergence over the last ~35 sessions) ──
  {
    let fired = false;
    let direction: "long" | "avoid" | null = null;
    let score = 0;
    const ev: string[] = [];
    const W = Math.min(35, closes.length - 60);
    if (W >= 20 && rsi !== null) {
      // RSI series over the window (the full series is recomputed on the
      // sliced window — deterministic, no lookahead)
      const win = closes.slice(-W);
      const rsiWin = rsiSeries(win, 14).map((v) => (v === null || v === undefined ? null : v));
      const rsiAt = (i: number): number | null => (i >= 0 && i < rsiWin.length ? (rsiWin[i] as number | null) : null);

      // split the window in half: an OLDER extreme vs a NEWER extreme
      const half = Math.floor(W / 2);
      const oldWin = win.slice(0, half);
      const newWin = win.slice(half);
      if (oldWin.length >= 8 && newWin.length >= 8) {
        // bullish: price lower low in the newer half while RSI higher low
        const oldMinIdx = oldWin.indexOf(Math.min(...oldWin));
        const newMinIdx = newWin.indexOf(Math.min(...newWin));
        const oldRsi = rsiAt(oldMinIdx);
        const newRsi = rsiAt(half + newMinIdx);
        const priceLL = newWin[newMinIdx] < oldWin[oldMinIdx];
        if (
          priceLL && oldRsi !== null && newRsi !== null && newRsi >= oldRsi + 3 && rsi <= 55
        ) {
          fired = true;
          direction = "long";
          score = clamp01(0.6 + Math.min(newRsi - oldRsi, 15) / 30);
          ev.push(`bullish divergence: price lower low, RSI ${(newRsi - oldRsi).toFixed(0)} points higher`);
        }
        // bearish: price higher high in the newer half while RSI lower high
        if (!fired) {
          const oldMaxIdx = oldWin.indexOf(Math.max(...oldWin));
          const newMaxIdx = newWin.indexOf(Math.max(...newWin));
          const oldRsiH = rsiAt(oldMaxIdx);
          const newRsiH = rsiAt(half + newMaxIdx);
          const priceHH = newWin[newMaxIdx] > oldWin[oldMaxIdx];
          if (
            priceHH && oldRsiH !== null && newRsiH !== null && newRsiH <= oldRsiH - 3 && rsi >= 45
          ) {
            fired = true;
            direction = "avoid";
            score = clamp01(0.6 + Math.min(oldRsiH - newRsiH, 15) / 30);
            ev.push(`bearish divergence: price higher high, RSI ${(oldRsiH - newRsiH).toFixed(0)} points lower`);
          }
        }
      }
    }
    out.push(mk("rsi-divergence", { fired, direction, score, evidence: ev }));
  }

  // ── 16. zscore-reversion (50-session z-score stretch) ──
  {
    let fired = false;
    let direction: "long" | "avoid" | null = null;
    let score = 0;
    const ev: string[] = [];
    if (sma50 !== null && closes.length >= 60) {
      const win = closes.slice(-50);
      const mean = win.reduce((a, b) => a + b, 0) / win.length;
      const varr = win.reduce((a, b) => a + (b - mean) * (b - mean), 0) / win.length;
      const sd = Math.sqrt(varr);
      if (sd > 0 && mean > 0) {
        const z = (price - mean) / sd;
        // deep discount vs the 50-session mean — statistical snap-back long
        if (z <= -1.8 && sma200 !== null && price > sma200 * 0.95) {
          fired = true;
          direction = "long";
          score = clamp01(0.55 + Math.min(Math.abs(z) - 1.8, 1.2) / 1.2 * 0.45);
          ev.push(`z-score ${z.toFixed(2)} vs the 50-session mean (σ ${(sd / price * 100).toFixed(1)}% of price)`);
          ev.push("long-term trend not broken (within 5% of SMA200)");
        } else if (z >= 2 && sma200 !== null && price < sma200) {
          // statistical pop INSIDE a downtrend — the dead-cat distribution
          fired = true;
          direction = "avoid";
          score = clamp01(0.55 + Math.min(z - 2, 1.2) / 1.2 * 0.45);
          ev.push(`z-score ${z.toFixed(2)} vs the 50-session mean while below SMA200`);
        }
      }
    }
    out.push(mk("zscore-reversion", { fired, direction, score, evidence: ev }));
  }

  // ── 17. insider-flow (official EGX filings — data-gated) ──
  {
    let fired = false;
    let direction: "long" | "avoid" | null = null;
    let score = 0;
    const ev: string[] = [];
    const ins = ctx.insider;
    if (ins && (ins.buys > 0 || ins.sells > 0 || ins.treasuryBuys > 0)) {
      const netBuyers = ins.buys + ins.treasuryBuys * 0.5; // treasury buys count half (company, not persons)
      const netSellers = ins.sells + ins.treasurySells * 0.5;
      if (netBuyers >= 2 && ins.sells === 0) {
        fired = true;
        direction = "long";
        score = clamp01(0.65 + Math.min(netBuyers - 2, 3) / 3 * 0.2);
        ev.push(
          `${ins.buys} insider/major-holder buy filings${ins.treasuryBuys ? ` + ${ins.treasuryBuys} treasury purchase(s)` : ""}, 0 sells (90 days)`
        );
        if (ins.lastDate) ev.push(`latest filing ${ins.lastDate}`);
      } else if (netSellers >= 3 && ins.buys === 0) {
        fired = true;
        direction = "avoid";
        score = clamp01(0.6 + Math.min(netSellers - 3, 4) / 4 * 0.25);
        ev.push(`${ins.sells} insider/major-holder sell filings, 0 buys (90 days)`);
        if (ins.lastDate) ev.push(`latest filing ${ins.lastDate}`);
      }
    }
    out.push(mk("insider-flow", { fired, direction, score, evidence: ev }));
  }

  // ── 18. whale-watch (foreign-institution flow regime — data-gated) ──
  {
    let fired = false;
    let direction: "long" | "avoid" | null = null;
    let score = 0;
    const ev: string[] = [];
    const w = ctx.whale;
    // threshold: ±100 EGP mn of net foreign-institution flow over 3 sessions
    // is a meaningful institutional footprint on the EGX tape (typical total
    // daily institutional turnover is hundreds of millions of pounds)
    if (w && w.forInstNet3d !== null && sma50 !== null) {
      if (w.forInstNet3d >= 100 && price > sma50) {
        fired = true;
        direction = "long";
        score = clamp01(0.6 + Math.min(w.forInstNet3d - 100, 500) / 500 * 0.25);
        ev.push(`foreign institutions net +${w.forInstNet3d.toFixed(0)} EGP mn over the last 3 sessions`);
        ev.push("candidate above SMA50 (institutions accumulate leaders)");
        if (w.instSharePct !== null) ev.push(`institutions ${w.instSharePct.toFixed(0)}% of turnover`);
      } else if (w.forInstNet3d <= -100 && price < sma50) {
        fired = true;
        direction = "avoid";
        score = clamp01(0.6 + Math.min(-w.forInstNet3d - 100, 500) / 500 * 0.25);
        ev.push(`foreign institutions net ${w.forInstNet3d.toFixed(0)} EGP mn over the last 3 sessions`);
        ev.push("candidate below SMA50 (distribution hits laggards hardest)");
        if (w.instSharePct !== null) ev.push(`institutions ${w.instSharePct.toFixed(0)}% of turnover`);
      }
    }
    out.push(mk("whale-watch", { fired, direction, score, evidence: ev }));
  }

  return out;
}

/** Aggregate the 18 verdicts into the served consensus read.
 *  consensus = Σ(weight × score × sign) / Σ(weight of counted strategies)
 *  Counted set: the 15 candle strategies always (a silent one is a deliberate
 *  no-trigger vote) + the five data-gated strategies (dividend-quality,
 *  press-tone, ml-forecast, insider-flow, whale-watch) only when their data
 *  existed (they cannot vote on absent data, and their silence must not
 *  inflate the agreement denominator).
 *  The ATR guard mirrors the old charter: >6% volatility cuts the consensus
 *  to 70% (EGX ±10% circuit breakers); >9% cuts to 35%. */
export function ensembleRead(verdicts: StrategyVerdict[], atrPct: number | null): EnsembleRead {
  let sumW = 0;
  let net = 0;
  let longVotes = 0;
  let avoidVotes = 0;
  const firedList: StrategyVerdict[] = [];
  for (const v of verdicts) {
    const meta = BY_ID.get(v.id);
    if (!meta) continue;
    // data-gated strategies join the counted set only when they fire —
    // their vote is otherwise neutral silence, not a no-trigger vote
    const isDataGated = DATA_GATED.has(v.id);
    if (isDataGated && !v.fired) continue;
    sumW += meta.weight;
    if (v.fired && v.direction === "long") {
      net += meta.weight * v.score;
      longVotes++;
      firedList.push(v);
    } else if (v.fired && v.direction === "avoid") {
      net -= meta.weight * v.score;
      avoidVotes++;
      firedList.push(v);
    }
  }

  let consensus = sumW > 0 ? net / sumW : 0;
  if (atrPct !== null && atrPct > 9) consensus *= 0.35;
  else if (atrPct !== null && atrPct > 6) consensus *= 0.7;
  consensus = Math.max(-1, Math.min(1, consensus));

  const denom = sumW > 0 ? longVotes + avoidVotes + countNeutralSilent(verdicts) : 0;
  const evidence: string[] = [];
  for (const v of [...firedList].sort((a, b) => b.score - a.score)) {
    evidence.push(...v.evidence.map((e) => `${v.id}: ${e}`));
    if (evidence.length >= 12) break;
  }

  return {
    consensus: Number(consensus.toFixed(3)),
    longVotes,
    avoidVotes,
    applicable: Math.max(1, Math.round(denom)),
    agreement: denom > 0 ? Number((longVotes / denom).toFixed(2)) : 0,
    verdicts: [...firedList.sort((a, b) => b.score - a.score), ...verdicts.filter((v) => !v.fired)],
    evidence,
  };
}

function countNeutralSilent(verdicts: StrategyVerdict[]): number {
  // candle strategies that did not fire still "voted" (conditions unmet =
  // a deliberate no-trigger vote) — count them so agreement is honest.
  let n = 0;
  for (const v of verdicts) {
    if (DATA_GATED.has(v.id)) continue; // data-gated, counted only when they fire
    if (!v.fired) n++;
  }
  return n;
}

/** The five data-gated strategies: their silence means "no data", not "no
 *  trigger" — they join the consensus denominator only when they fire. */
const DATA_GATED = new Set(["dividend-quality", "press-tone", "ml-forecast", "insider-flow", "whale-watch"]);

/** One-call convenience: evaluate + aggregate. */
export function evaluateEnsemble(
  pts: ChartPointLite[],
  ctx: StrategyCtx,
  atrPct: number | null
): EnsembleRead {
  const verdicts = evaluateStrategies(pts, ctx);
  return ensembleRead(verdicts, atrPct);
}

export const ENSEMBLE_SIZE = STRATEGY_REGISTRY.length;
