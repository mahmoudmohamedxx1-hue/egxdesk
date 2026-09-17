/** AI Signals pipeline (Task 20) — the "public but totally free" AI feature.
 *
 *  Architecture (shared compute): ONE LLM synthesis call per refresh cycle
 *  turns the deterministic strategy evidence (src/lib/strategy.ts over the
 *  hourly signals scan + fresh 1Y candles) into a validated signal set that
 *  is PERSISTED in SQLite and served to EVERY user from cache. N users cost
 *  1 call — that is what keeps this section unlimited and free, while the
 *  personal agent keeps its per-user 60/h fair-use limit.
 *
 *  Honesty by design:
 *   - the system prompt IS the back-tested charter (STRATEGY_CHARTER); the
 *     walk-forward backtest (scripts/backtest-signals.ts → src/data/
 *     backtest.json) validated exactly those rules, and its stats ship with
 *     every response;
 *   - entry/stop/target are computed by the charter's ATR math locally — the
 *     LLM explains and weights, it never invents numbers;
 *   - picks are validated against the candidate set and clamped before they
 *     reach a single user. */

import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { scanSignals, reblendNews, type SignalRow } from "@/lib/signals-scan";
import { fetchIndices, fetchUniverse } from "@/lib/market";
import { fetchStockChart } from "@/lib/history";
import {
  STRATEGY_CHARTER,
  STRATEGY_REV,
  strategyFeaturesAt,
  riskLevels,
  tradePlan,
  planFromLegacy,
  type StrategyFeatures,
  type TradePlan,
} from "@/lib/strategy";
import {
  evaluateEnsemble,
  strategyById,
  STRATEGY_REGISTRY,
  type EnsembleRead,
} from "@/lib/strategies";
import { getTrackRecord, type TrackRecord } from "@/lib/signal-track";
import backtestJson from "@/data/backtest.json";

// ── tuning ──

const COOLDOWN_MS = 45 * 60_000; // one shared refresh per 45 minutes
const MAX_PICKS = 6;
const KEEP_SETS = 20; // rows retained for freshness (T43: + a 60-day daily spine)
const PRUNE_SCAN = 400; // rows considered when building the retention set
const RETRY_BACKOFF_MS = [12_000, 25_000];
const RETRY_BUDGET_MS = 70_000;
const CAND_BULL = 12;
const CAND_BEAR = 8;
const CAND_MOVERS = 5;

// ── z-ai SDK singleton ──

type Zai = Awaited<ReturnType<typeof ZAI.create>>;
let zaiPromise: Promise<Zai> | null = null;
function getZai(): Promise<Zai> {
  if (!zaiPromise) zaiPromise = ZAI.create();
  return zaiPromise;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isThrottleError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("429") || /too many requests/i.test(msg);
}

// ── types (the served payload) ──

export type AiPick = {
  ticker: string;
  nameAr: string;
  nameEn: string;
  sectorAr: string;
  stance: "long" | "avoid";
  conviction: number; // 1-5
  charterScore: number | null; // the ensemble consensus (deterministic)
  strategies: string[]; // ids of the fired strategies supporting the stance
  longVotes: number; // ensemble votes
  avoidVotes: number;
  applicable: number; // counted strategies
  agreement: number; // fraction of counted strategies supporting the stance
  close: number;
  entry: number | null; // charter ATR math (authoritative)
  stop: number | null;
  target: number | null; // === plan.t2 (1.5R) — the level the old fields carried
  rr: number | null;
  // T43 — the full executable plan: limit-order zone + scale-out ladder.
  // Null for avoids and for pre-T43 sets whose entry is null.
  plan: { zoneLo: number; zoneHi: number; t1: number; t2: number; t3: number; riskPct: number } | null;
  horizonSessions: number;
  riskLevel: "low" | "medium" | "high";
  earningsRisk: string | null; // ISO date if next earnings falls inside the horizon
  evidence: string[];
  thesisAr: string;
  thesisEn: string;
};

export type AiBias = {
  direction: "bullish" | "bearish" | "neutral";
  conviction: number; // 1-5
  summaryAr: string;
  summaryEn: string;
};

export type AiSetPayload = {
  generatedAt: string;
  marketBias: AiBias;
  picks: AiPick[];
  notesAr: string | null;
  scanned: number;
};

export type AiSignalsResponse = {
  ok: true;
  status: "ready" | "stale" | "warming";
  set: (AiSetPayload & { model: string; strategyRev: string; llmMs: number }) | null;
  backtest: typeof backtestJson;
  // T43 — every PUBLISHED pick since persistence began, replayed against
  // the candles that followed it. The proof layer: dates, numbers, outcomes.
  trackRecord: TrackRecord | null;
  meta: {
    cooldownMinutes: number;
    sharedCompute: true;
    strategyRev: string;
    backtestRev: string;
    backtestStale: boolean;
    charter: string;
  };
};

// ── JSON extraction (single-object reply, fences tolerated) ──

function* topLevelJsonObjects(s: string): Generator<string> {
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf("{", i);
    if (start === -1) return;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let closed = false;
    for (let j = start; j < s.length; j++) {
      const c = s[j];
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        if (inStr) esc = true;
        continue;
      }
      if (c === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          yield s.slice(start, j + 1);
          i = j + 1;
          closed = true;
          break;
        }
      }
    }
    if (!closed) return;
  }
}

function extractJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let s = raw.trim().replace(/<think>[\s\S]*?<\/think>/gi, "");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  for (const span of topLevelJsonObjects(s)) {
    try {
      const p = JSON.parse(span);
      if (p && typeof p === "object") return p as Record<string, unknown>;
    } catch {
      /* try the next span */
    }
  }
  return null;
}

// ── the evidence pack ──

type Candidate = {
  row: SignalRow;
  f: StrategyFeatures | null;
  ens: EnsembleRead | null;
  risk: { entry: number; stop: number; target: number; rr: number } | null;
  plan: TradePlan | null; // T43 — the ladder plan (longs only make use of it)
};

async function buildCandidates(scan: Awaited<ReturnType<typeof scanSignals>>): Promise<Candidate[]> {
  const bulls = scan.rows.slice(0, CAND_BULL);
  const bears = scan.rows.slice(-CAND_BEAR).reverse();
  const movers = [...scan.rows]
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, CAND_MOVERS);
  const seen = new Set<string>();
  const rows: SignalRow[] = [];
  for (const r of [...bulls, ...bears, ...movers]) {
    if (!seen.has(r.ticker)) {
      seen.add(r.ticker);
      rows.push(r);
    }
  }

  const out: Candidate[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      let f: StrategyFeatures | null = null;
      let ens: EnsembleRead | null = null;
      try {
        const chart = await fetchStockChart(row.ticker, "1Y");
        f = strategyFeaturesAt(row.ticker, chart.points);
        // T42 — the 12-strategy ensemble vote on the same candles: the scan
        // row already carries divYield / quality pillar / press score / the
        // 13-indicator technical score, so the ctx is fully real
        ens = evaluateEnsemble(
          chart.points,
          {
            divYield: row.divYield,
            fundQuality: row.quality,
            newsScore: row.newsScore,
            techScore: row.score,
          },
          f ? f.atrPct : null
        );
      } catch {
        f = null; // chart hiccup — the scan row still carries the 13-indicator read
        ens = row.ensemble
          ? {
              ...row.ensemble,
              verdicts: [],
              evidence: row.ensembleEvidence ?? [],
            }
          : null;
      }
      out.push({ row, f, ens, risk: f ? riskLevels(f) : null, plan: f ? tradePlan(f) : null });
      await sleep(120);
    }
  };
  await Promise.all(Array.from({ length: 4 }, () => worker()));
  return out;
}

function sectorExtremes(rows: SignalRow[]): { best: string | null; worst: string | null } {
  const bySector = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const b = bySector.get(r.sectorAr) ?? { sum: 0, n: 0 };
    b.sum += r.changePct;
    b.n++;
    bySector.set(r.sectorAr, b);
  }
  const eligible = [...bySector.entries()].filter(([, v]) => v.n >= 3);
  if (eligible.length === 0) return { best: null, worst: null };
  const sorted = eligible.sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n);
  return { best: sorted[0][0], worst: sorted[sorted.length - 1][0] };
}

// ── the one LLM call ──

async function createChat(
  zai: Zai,
  messages: { role: "user" | "assistant"; content: string }[],
  retry: { budgetLeft: number }
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const completion = await zai.chat.completions.create({
        messages,
        thinking: { type: "enabled" }, // synthesis moment — genuine reasoning
      });
      return completion.choices[0]?.message?.content ?? "";
    } catch (err) {
      const wait = RETRY_BACKOFF_MS[attempt];
      if (isThrottleError(err) && wait !== undefined && retry.budgetLeft >= wait) {
        retry.budgetLeft -= wait;
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
}

const OUTPUT_SCHEMA = `{
  "marketBias": { "direction": "bullish" | "bearish" | "neutral", "conviction": 1-5, "summaryAr": "...", "summaryEn": "..." },
  "picks": [
    {
      "ticker": "COMI", "stance": "long" | "avoid", "conviction": 1-5,
      "horizonSessions": 10,
      "evidence": ["the exact evidence lines from the pack that drove this call"],
      "thesisAr": "2-4 sentences, Egyptian-friendly MSA, concrete numbers",
      "thesisEn": "2-4 sentences, concrete numbers"
    }
  ],
  "notesAr": "one short note for users (regime/caveat), or null"
}

LANGUAGE PURITY (machine-checked before serving): thesisAr/summaryAr/notesAr must be PURE Arabic — Latin script is allowed ONLY for tickers and technical acronyms (RSI, MACD, SMA, ATR, P/E, P/B, ROE, EPS, EGP, EGX); never English words like "combination" or "volume". thesisEn/summaryEn must be pure English — never Arabic script.`;

// ── T41: language-purity gate (the signals-side twin of the agent's T38
// anti-fabrication gate). The LLM occasionally leaks a plain English word
// into an Arabic thesis (live case: "هذه combination عالية المخاطر"). Arabic
// fields may keep tickers + technical acronyms only; English fields may not
// carry Arabic script. Violations trigger ONE repair round; a repair that
// still fails (or alters numbers) falls back to the deterministic evidence
// lines — never served dirty.

const LATIN_OK = new Set([
  "RSI", "SMA", "SMA20", "SMA50", "SMA200", "MACD", "ATR", "ATR14", "P/E", "PE",
  "P/B", "PB", "ROE", "EPS", "EGP", "EGX", "EGX30", "EGX70", "EGX100", "VWAP",
  "BETA", "CAGR", "YOY", "YTD", "TTM", "FY", "9M", "6M", "3M", "1M", "1Y", "QOQ",
  "R:R", "NAV", "IPO", "ETF", "CPI", "USD", "EUR",
]);

export function strayLatinInArabic(s: string): string[] {
  const words = s.match(/[A-Za-z][A-Za-z0-9./&:-]*/g) ?? [];
  return words.filter((raw) => {
    // trailing punctuation rides along with the word regex ("EGX30.", "x.") —
    // strip it before matching the allowlist or nothing would ever pass
    const w = raw.replace(/[.:,;]+$/, "");
    if (!w) return false;
    const up = w.toUpperCase();
    if (LATIN_OK.has(up)) return false;
    if (LATIN_OK.has(up.replace(/\d+$/, ""))) return false; // SMA20-style
    if (/^[A-Z]{2,5}$/.test(w)) return false; // ticker-like (COMI, HRHO…)
    if (/^[A-Z][A-Z.]*\.[A-Z.]+$/.test(w)) return false; // dotted Latin brand (A.T.LEASE)
    if (/^\d+[a-z]$/i.test(w)) return false; // 1.84x multiplier notation
    if (/^[A-Z]$/i.test(w)) return false; // single stray letter (rare, harmless)
    return true;
  });
}

export function strayArabicInEnglish(s: string): boolean {
  return /[\u0600-\u06ff]/.test(s);
}

/** T41 — deterministic Arabic rendering of the strategy evidence codes (the
 *  English originals live in strategy.ts / strategies.ts). Used whenever a
 *  thesis falls back to its evidence lines, so the Arabic slot never receives
 *  English text. T42 — also renders the ENSEMBLE codes ("strategy-id: …")
 *  using each strategy's Arabic name. */
export function evidenceAr(codes: string[]): string {
  const parts: string[] = [];
  for (const c of codes) {
    let m: RegExpExecArray | null;
    // ensemble codes first: "<strategy-id>: <inner>"
    const ens = /^(\w+-(?:rider|cross|hunter|reversion|bounce|swing|surge|3m|continue|quality|tone)):\s*(.+)$/.exec(c);
    if (ens && strategyById(ens[1])) {
      parts.push(`${strategyById(ens[1])!.nameAr}: ${innerEvidenceAr(ens[2])}`);
      continue;
    }
    if ((m = /^close vs SMA50: (above|below)$/.exec(c))) parts.push(m[1] === "above" ? "السعر فوق المتوسط 50" : "السعر تحت المتوسط 50");
    else if ((m = /^close vs SMA200: (above|below)$/.exec(c))) parts.push(m[1] === "above" ? "فوق المتوسط 200" : "تحت المتوسط 200");
    else if ((m = /^SMA50 ([><]) SMA200$/.exec(c))) parts.push(m[1] === ">" ? "المتوسط 50 فوق المتوسط 200" : "المتوسط 50 تحت المتوسط 200");
    else if ((m = /^RSI14 ([\d.]+)$/.exec(c))) parts.push(`مؤشر RSI عند ${m[1]}`);
    else if (/^MACD hist positive$/.test(c)) parts.push("ماكد موجب");
    else if (/^MACD hist negative$/.test(c)) parts.push("ماكد سالب");
    else if ((m = /^volume ×([\d.]+) of 20d avg$/.exec(c))) parts.push(`الحجم ×${m[1]} من متوسط 20 جلسة`);
    else if ((m = /^52w position ([\d.]+)%$/.exec(c))) parts.push(`الموضع ${m[1]}% من مدى 52 أسبوع`);
    else if ((m = /^([\d.]+)% below 20d high$/.exec(c))) parts.push(`أقل من قمة 20 جلسة بنسبة ${m[1]}%`);
    else if ((m = /^ATR14 ([\d.]+)% of price$/.exec(c))) parts.push(`ATR14 عند ${m[1]}% من السعر`);
    else parts.push(c); // unknown code stays verbatim (honest)
  }
  return parts.join(" · ");
}

/** T42 — Arabic rendering of one ensemble evidence line's inner text (the
 *  part after "strategy-id:"). Phrase table, longest-match first; anything
 *  unmatched keeps only its Arabic-safe tokens (numbers/acronyms) so the
 *  purity gate can never fire on a fallback. */
function innerEvidenceAr(inner: string): string {
  let s = inner;
  const phrases: [RegExp, string][] = [
    [/price > SMA50 > SMA200, MACD hist > 0/g, "السعر فوق المتوسط 50 فوق 200 وماكد موجب"],
    [/price < SMA50 < SMA200, MACD hist < 0/g, "السعر تحت المتوسط 50 تحت 200 وماكد سالب"],
    [/SMA50 > SMA200 \(golden\), price > SMA50/g, "المتوسط 50 فوق 200 (تقاطع ذهبي) والسعر فوق المتوسط 50"],
    [/SMA50 < SMA200 \(death\), price < SMA50/g, "المتوسط 50 تحت 200 (تقاطع سالب) والسعر تحت المتوسط 50"],
    [/RSI14 ([\d.]+) in thrust zone/g, "مؤشر RSI عند $1 في منطقة الاندفاع"],
    [/RSI14 ([\d.]+) stretched/g, "مؤشر RSI عند $1 في تمدد مفرط"],
    [/RSI14 ([\d.]+) weak/g, "مؤشر RSI عند $1 ضعيف"],
    [/RSI14 ([\d.]+)/g, "مؤشر RSI عند $1"],
    [/cross (\d+) sessions ago \(fresh\)/g, "التقاطع قبل $1 جلسة (حديث)"],
    [/cross (\d+) sessions ago/g, "التقاطع قبل $1 جلسة"],
    [/within 2% of 60-session high ([\d.]+)/g, "على بعد 2% من قمة 60 جلسة عند $1"],
    [/within 2% of 60-session low ([\d.]+)/g, "على بعد 2% من قاع 60 جلسة عند $1"],
    [/at 60-session highs \(new-high territory\)/g, "عند قمم 60 جلسة (أرضية قمم جديدة)"],
    [/at 60-session lows \(breakdown territory\)/g, "عند قيعان 60 جلسة (منطقة انهيار)"],
    [/60-session position ([\d.]+)%/g, "الموضع $1% من مدى 60 جلسة"],
    [/volume ×([\d.]+) of 20d avg/g, "الحجم ×$1 من متوسط 20 جلسة"],
    [/oversold dip RSI14 ([\d.]+) above SMA200/g, "ترهّل بيعي بمؤشر RSI عند $1 والسعر فوق المتوسط 200"],
    [/overbought pop RSI14 ([\d.]+) below SMA200/g, "تشبع شرائي بمؤشر RSI عند $1 والسعر تحت المتوسط 200"],
    [/close below lower Bollinger\(20,2\) by ([\d.]+)%/g, "إغلاق دون الحد السفلي لبولينجر (20،2) بنسبة $1%"],
    [/close below lower Bollinger\(20,2\)/g, "إغلاق دون الحد السفلي لبولينجر (20،2)"],
    [/RSI14 ([\d.]+) with price above SMA100/g, "مؤشر RSI عند $1 والسعر فوق المتوسط 100"],
    [/MACD hist crossed positive within 3 sessions/g, "هيستوغرام ماكد تحول موجبًا خلال 3 جلسات"],
    [/MACD hist crossed negative within 3 sessions/g, "هيستوغرام ماكد تحول سالبًا خلال 3 جلسات"],
    [/price above SMA50/g, "السعر فوق المتوسط 50"],
    [/price below SMA50/g, "السعر تحت المتوسط 50"],
    [/up day \(([\d.-]+)%\) above SMA20/g, "جلسة صاعدة ($1%) فوق المتوسط 20"],
    [/down day \(([\d.-]+)%\) below SMA20/g, "جلسة هابطة ($1%) تحت المتوسط 20"],
    [/stochastic %K crossed %D up from ([\d.]+) \(oversold\)/g, "تقاطع الاستوكاستك صاعدًا من $1 (تشبع بيعي)"],
    [/stochastic %K crossed %D down from ([\d.]+) \(overbought\)/g, "تقاطع الاستوكاستك هابطًا من $1 (تشبع شرائي)"],
    [/price above SMA100/g, "السعر فوق المتوسط 100"],
    [/price below SMA100/g, "السعر تحت المتوسط 100"],
    [/3-month ROC ([\d.-]+)% \(leadership\)/g, "معدل التغير 3 أشهر $1% (ريادة)"],
    [/3-month ROC ([\d.-]+)% \(laggard\)/g, "معدل التغير 3 أشهر $1% (تأخر)"],
    [/([\d.-]+)% over SMA50 \(non-parabolic\)/g, "أعلى من المتوسط 50 بنسبة $1% (دون ذروة)"],
    [/([\d.-]+)% under SMA50/g, "أدنى من المتوسط 50 بنسبة $1%"],
    [/orderly dip ([\d.]+)% below 20-session high/g, "تصحيح منظم $1% تحت قمة 20 جلسة"],
    [/uptrend intact \(price > SMA200, SMA50 > SMA200\)/g, "الترند الصاعد سليم (السعر فوق المتوسط 200 والمتوسط 50 فوق 200)"],
    [/RSI14 ([\d.]+) \(reset zone\)/g, "مؤشر RSI عند $1 (منطقة إعادة ضبط)"],
    [/mid-zone reset — classic continuation window/g, "إعادة ضبط وسطى — نافذة استكمال كلاسيكية"],
    [/dividend yield ([\d.]+)%/g, "عائد توزيعات $1%"],
    [/quality pillar ([\d.-]+) positive/g, "ركيزة الجودة $1 موجبة"],
    [/price above SMA200 \(trend-safe income\)/g, "السعر فوق المتوسط 200 (دخل آمن ترندًا)"],
    [/press tone ([\d.-]+) \(14-day lexicon\)/g, "نبرة الصحافة $1 (معجم 14 يومًا)"],
    [/technical score ([\d.-]+) not contradicting/g, "الدرجة الفنية $1 دون تناقض"],
    [/trend: /g, ""],
  ];
  for (const [re, ar] of phrases) s = s.replace(re, ar);
  // anything still Latin beyond allowed acronyms/numbers/tickers is dropped —
  // a fallback must never carry stray English into an Arabic slot
  const tokens = s.split(/\s+/).filter((t) => t.length > 0);
  const kept = tokens.filter((t) => {
    const bare = t.replace(/[.:,;()]+$/g, "").replace(/^[():,;]+/g, "");
    if (!bare) return false;
    if (/[\u0600-\u06ff]/.test(bare)) return true; // Arabic passes
    if (/^[×%→←\-–—/]+$/.test(t)) return true; // symbols
    if (/^\d+(?:[.,]\d+)*%?$/.test(bare)) return true; // numbers
    const up = bare.toUpperCase();
    if (["RSI", "SMA", "MACD", "ATR", "ROC", "SMA50", "SMA100", "SMA200", "SMA20", "ATR14", "RSI14"].includes(up)) return true;
    if (/^[A-Z]{2,5}$/.test(bare)) return true; // ticker-like
    return false;
  });
  return kept.join(" ").trim() || "راجع عناصر الأدلة";
}

/** Multiset of numeric tokens — used to prove a repaired rewrite kept every
 *  number the original carried (a rewrite that drops or invents numbers is
 *  rejected). */
function numberBag(s: string): number[] {
  return (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).sort((a, b) => a - b);
}

export function numbersPreserved(original: string, rewritten: string): boolean {
  const a = numberBag(original);
  const b = numberBag(rewritten);
  if (a.length !== b.length) return false;
  return a.every((v, i) => Math.abs(v - b[i]) <= Math.max(0.011, Math.abs(v) * 0.001));
}

async function generateSet(): Promise<{ payload: AiSetPayload; llmMs: number }> {
  const t0 = Date.now();
  const [scan, indices, universe] = await Promise.all([scanSignals(), fetchIndices(), fetchUniverse()]);
  if (!scan.rows.length) throw new Error("signals scan unavailable");
  // fresh news pillar before picking candidates — the pack quotes press tone
  // alongside technicals/fundamentals (re-blend is pure math, ≤10-min news)
  const freshRows = await reblendNews(scan.rows, universe);
  const freshScan = { ...scan, rows: freshRows };

  const candidates = await buildCandidates(freshScan);
  const byTicker = new Map(candidates.map((c) => [c.row.ticker, c]));

  // T41 — breadth for the LLM's market context comes from the FULL universe
  // (the same 296-name figure the homepage narrative shows), not the scanned
  // subset: the model quotes these in its bias summary, and two different
  // breadths across views read as an inconsistency even when both are honest.
  const up = universe.filter((r) => r.changePct > 0).length;
  const down = universe.filter((r) => r.changePct < 0).length;
  const { best, worst } = sectorExtremes(freshScan.rows);
  const movers = [...freshScan.rows]
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 5)
    .map((r) => ({ ticker: r.ticker, nameAr: r.nameAr, changePct: r.changePct }));

  // T42 — strategy regime across the candidate pack: how many candidates each
  // of the 12 strategies is long/avoid on (the ensemble's market read)
  const strategyRegime = STRATEGY_REGISTRY.map((s) => {
    let longs = 0;
    let avoids = 0;
    for (const c of candidates) {
      const v = c.ens?.verdicts.find((x) => x.id === s.id);
      if (v?.fired && v.direction === "long") longs++;
      else if (v?.fired && v.direction === "avoid") avoids++;
    }
    return { id: s.id, name: s.nameEn, family: s.family, longs, avoids };
  });

  const marketContext = {
    scanAsOf: scan.asOf,
    indices: indices.map((i) => ({ code: i.code, close: i.close, changePct: i.changePct })),
    breadth: { up, down, flat: universe.length - up - down, scanned: universe.length },
    bestSector: best,
    worstSector: worst,
    topMovers: movers,
    strategyRegime,
    ensembleSize: STRATEGY_REGISTRY.length,
    backtestEvidence: backtestJson.stats,
    backtestMethod: backtestJson.method,
  };

  const pack = candidates.map(({ row, f, ens, risk, plan }) => ({
    ticker: row.ticker,
    nameAr: row.nameAr,
    nameEn: row.name,
    sectorAr: row.sectorAr,
    close: row.close,
    dayChangePct: row.changePct,
    valueTradedEgpMn: Math.round(row.valueTraded / 1e6),
    liquidity: row.valueTraded >= 5e6 ? "ok" : "thin",
    technicalRating: row.rating,
    indicatorScore: row.score,
    fundamentals: {
      fundScore: row.fundScore,
      rating: row.fundRating,
      coverage: row.fundCoverage,
      valuation: row.valuation,
      quality: row.quality,
      income: row.income,
      pe: row.pe,
      pb: row.pb,
      roe: row.roe,
      netMargin: row.netMarginTTM,
      debtToEquity: row.debtToEquity,
      divYield: row.divYield,
      reasons: (row.fundReasons ?? []).slice(0, 4),
    },
    news: {
      score: row.newsScore, // null = no attributed press in 14 days
      rating: row.newsRating,
      articles: row.newsCount,
      bull: row.newsBull,
      bear: row.newsBear,
      reasons: (row.newsReasons ?? []).slice(0, 2),
    },
    perf: { m1: row.perf1M, m6: row.perf6M, ytd: row.perfYTD, y1: row.perfY },
    nextEarnings: row.nextEarnings,
    strategies: ens
      ? {
          consensus: ens.consensus,
          agreement: ens.agreement,
          longVotes: ens.longVotes,
          avoidVotes: ens.avoidVotes,
          applicable: ens.applicable,
          fired: ens.verdicts
            .filter((v) => v.fired)
            .map((v) => ({ id: v.id, name: v.nameEn, dir: v.direction, score: v.score, evidence: v.evidence })),
        }
      : null,
    strategy: f
      ? {
          trend: f.trend,
          momentum: f.momentum,
          volumeC: f.volumeC,
          position52: f.position52,
          pullback: f.pullback,
          atrPct: f.atrPct,
          charterScore: f.score,
          evidence: f.evidence,
        }
      : null,
    charterRisk: risk, // precomputed entry/stop/target (ATR math) — cite, don't change
    tradePlan: plan // T43 — the limit-order zone + T1/T2/T3 ladder, same ATR spine
      ? { zoneLo: plan.zoneLo, zoneHi: plan.zoneHi, t1: plan.t1, t2: plan.t2, t3: plan.t3, riskPct: plan.riskPct }
      : null,
  }));

  const userMsg = [
    "MARKET CONTEXT (live, ~15-min delayed):",
    JSON.stringify(marketContext),
    "",
    "CANDIDATES (12-strategy ensemble verdicts per candidate; charterRisk is the precomputed ATR level set):",
    JSON.stringify(pack),
    "",
    "Apply the charter to this evidence. Choose 3-6 picks (you may include 'avoid' stances when the ensemble consensus is net bearish; you may return fewer picks or none qualifying).",
    "Reply with EXACTLY ONE JSON object, no fences, no commentary, matching this schema:",
    OUTPUT_SCHEMA,
  ].join("\n");

  const zai = await getZai();
  const retry = { budgetLeft: RETRY_BUDGET_MS };
  const raw = await createChat(
    zai,
    [
      { role: "assistant", content: STRATEGY_CHARTER },
      { role: "user", content: userMsg },
    ],
    retry
  );
  const llmMs = Date.now() - t0;

  const parsed = extractJson(raw);
  if (!parsed) throw new Error("ai-signals: unparseable LLM reply");

  // ── validation + assembly (charter math is authoritative) ──
  const biasRaw = (parsed.marketBias ?? {}) as Record<string, unknown>;
  const dir = biasRaw.direction === "bullish" || biasRaw.direction === "bearish" ? biasRaw.direction : "neutral";
  const biasConv = Math.min(5, Math.max(1, Math.round(Number(biasRaw.conviction) || 2)));
  const bias: AiBias = {
    direction: dir,
    conviction: biasConv,
    summaryAr:
      typeof biasRaw.summaryAr === "string" && biasRaw.summaryAr.trim()
        ? biasRaw.summaryAr.trim().slice(0, 600)
        : `الاتساع: ${up} صاعد مقابل ${down} هابط من ${universe.length} سهم.`,
    summaryEn:
      typeof biasRaw.summaryEn === "string" && biasRaw.summaryEn.trim()
        ? biasRaw.summaryEn.trim().slice(0, 600)
        : `Breadth: ${up} up vs ${down} down of ${universe.length} scanned.`,
  };

  const picksRaw = Array.isArray(parsed.picks) ? parsed.picks : [];
  const picks: AiPick[] = [];
  const fallbackArByTicker = new Map<string, string>(); // deterministic pure-Arabic fallbacks (T41/T42)
  for (const p of picksRaw) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const ticker = typeof o.ticker === "string" ? o.ticker.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
    const cand = byTicker.get(ticker);
    if (!cand) continue; // unknown ticker — never serve it
    const f = cand.f;
    const ens = cand.ens;
    // T42 — the charter score is now the ENSEMBLE CONSENSUS (the weighted
    // vote of the 12 strategies). With 12 counted strategies and family
    // weights, a single full-strength vote moves the consensus only ~0.09 —
    // the 0.35 long gate therefore mathematically requires SEVERAL
    // independent strategies to agree. A long can never be single-strategy.
    const charterScore = ens ? ens.consensus : f ? f.score : cand.row.score;
    const stance: "long" | "avoid" = o.stance === "avoid" ? "avoid" : "long";
    // charter discipline: no longs the ensemble scores weakly; avoids need a
    // net-bearish consensus (a positive consensus never serves an avoid)
    if (stance === "long" && charterScore < 0.35) continue;
    if (stance === "avoid" && charterScore > 0) continue;
    // conviction cap: a long cannot be max-conviction against the market bias
    let conviction = Math.min(5, Math.max(1, Math.round(Number(o.conviction) || 2)));
    if (stance === "long" && bias.direction === "neutral" && conviction > 4) conviction = 4;
    if (stance === "long" && bias.direction === "bearish" && conviction > 3) conviction = 3;
    if (stance === "avoid" && bias.direction === "bullish" && conviction > 3) conviction = 3;
    // T42 — conviction is ALSO capped by ensemble agreement (the charter:
    // 5 = broad multi-strategy agreement). agreement = the fraction of
    // counted strategies voting for this pick's stance.
    const applicable = Math.max(1, ens?.applicable ?? 0);
    const agreeVotes = stance === "long" ? (ens?.longVotes ?? 0) : (ens?.avoidVotes ?? 0);
    const agreement = ens ? Number((agreeVotes / applicable).toFixed(2)) : 0;
    const agreeCap = Math.max(1, Math.ceil(agreement * 5)); // 0.4→2, 0.6→3, 0.8→4, 1.0→5
    if (agreement > 0 && conviction > agreeCap) conviction = agreeCap;
    // the strategy ids supporting this stance (deterministic — never LLM-chosen)
    const supportIds = ens ? ens.verdicts.filter((v) => v.fired && v.direction === stance).map((v) => v.id) : [];

    const horizon = Math.min(20, Math.max(5, Math.round(Number(o.horizonSessions) || 10)));
    const atrPct = f ? f.atrPct : null;
    const riskLevel: "low" | "medium" | "high" = atrPct === null ? "medium" : atrPct < 3 ? "low" : atrPct < 5 ? "medium" : "high";
    const earningsRisk =
      cand.row.nextEarnings && horizon
        ? (() => {
            const d = new Date(`${cand.row.nextEarnings}T00:00:00Z`).getTime();
            // only FUTURE earnings inside the horizon count (upstream
            // nextEarnings epochs are sometimes stale — in the past)
            return Number.isFinite(d) && d > Date.now() && d - Date.now() < horizon * 1.6 * 24 * 3600_000
              ? cand.row.nextEarnings
              : null;
          })()
        : null;

    const evidence = Array.isArray(o.evidence)
      ? o.evidence.filter((e): e is string => typeof e === "string" && e.trim().length > 0).slice(0, 8)
      : [];
    // T42 — the deterministic fallback now leads with the ENSEMBLE evidence
    // ("strategy-id: code" lines from all fired strategies) — richer than the
    // old single-strategy feature codes, same numbers.
    const fallbackEvidence =
      ens && ens.evidence.length ? ens.evidence.slice(0, 8) : f ? f.evidence.slice(0, 6) : [`indicator score ${charterScore}`];
    // T41 — a missing Arabic thesis falls back to the DETERMINISTIC evidence
    // rendered in Arabic. Same numbers, reader's language.
    const fallbackThesisAr =
      ens && ens.evidence.length
        ? evidenceAr(ens.evidence.slice(0, 8))
        : f
          ? evidenceAr(f.evidence.slice(0, 6))
          : `درجة المحرك ${charterScore.toFixed(2)} — راجع عناصر الأدلة.`;
    fallbackArByTicker.set(ticker, fallbackThesisAr);
    const thesisAr =
      typeof o.thesisAr === "string" && o.thesisAr.trim() ? o.thesisAr.trim().slice(0, 900) : fallbackThesisAr;
    const thesisEn =
      typeof o.thesisEn === "string" && o.thesisEn.trim() ? o.thesisEn.trim().slice(0, 900) : fallbackEvidence.join(" · ");

    picks.push({
      ticker,
      nameAr: cand.row.nameAr,
      nameEn: cand.row.name,
      sectorAr: cand.row.sectorAr,
      stance,
      conviction,
      charterScore,
      strategies: supportIds,
      longVotes: ens?.longVotes ?? 0,
      avoidVotes: ens?.avoidVotes ?? 0,
      applicable: ens?.applicable ?? 0,
      agreement,
      close: f ? f.close : cand.row.close,
      entry: stance === "long" ? cand.plan?.entry ?? cand.risk?.entry ?? null : null,
      stop: stance === "long" ? cand.plan?.stop ?? cand.risk?.stop ?? null : null,
      target: stance === "long" ? cand.plan?.target ?? cand.risk?.target ?? null : null,
      rr: stance === "long" ? cand.plan?.rr ?? cand.risk?.rr ?? null : null,
      // T43 — the executable plan rides along for longs (zone + ladder);
      // avoids never carry levels by charter.
      plan:
        stance === "long" && cand.plan
          ? {
              zoneLo: cand.plan.zoneLo,
              zoneHi: cand.plan.zoneHi,
              t1: cand.plan.t1,
              t2: cand.plan.t2,
              t3: cand.plan.t3,
              riskPct: cand.plan.riskPct,
            }
          : null,
      horizonSessions: horizon,
      riskLevel,
      earningsRisk,
      evidence: evidence.length ? evidence : fallbackEvidence,
      thesisAr,
      thesisEn,
    });
    if (picks.length >= MAX_PICKS) break;
  }

  const payload: AiSetPayload = {
    generatedAt: new Date().toISOString(),
    marketBias: bias,
    picks,
    notesAr:
      typeof parsed.notesAr === "string" && parsed.notesAr.trim() ? parsed.notesAr.trim().slice(0, 400) : null,
    scanned: scan.rows.length,
  };

  // ── T41 language-purity gate: repair, then verify, then honest fallback ──
  await purifyPayload(payload, zai, retry, fallbackArByTicker);
  return { payload, llmMs: Date.now() - t0 };
}

/** One repair round for any Arabic field carrying stray Latin words (or an
 *  English field carrying Arabic script). The repair is a tiny targeted chat
 *  call that rewrites ONLY the offending strings; the rewrite must keep the
 *  exact same number multiset, else it is rejected. Fields that cannot be
 *  repaired fall back to their deterministic evidence-line thesis (clean by
 *  construction). This runs once per 45-minute shared refresh — negligible
 *  cost, and it makes the live "combination inside Arabic" class of leak
 *  structurally unservable. */
type PurityFix = { key: string; arabic: boolean; original: string };

async function purifyPayload(
  payload: AiSetPayload,
  zai: Zai,
  retry: { budgetLeft: number },
  fallbackArByTicker: Map<string, string>
): Promise<void> {
  const fixes: PurityFix[] = [];
  for (const p of payload.picks) {
    if (strayLatinInArabic(p.thesisAr ?? "").length) fixes.push({ key: `${p.ticker}.thesisAr`, arabic: true, original: p.thesisAr });
    if (strayArabicInEnglish(p.thesisEn ?? "")) fixes.push({ key: `${p.ticker}.thesisEn`, arabic: false, original: p.thesisEn });
  }
  const b = payload.marketBias;
  if (strayLatinInArabic(b.summaryAr ?? "").length) fixes.push({ key: "bias.summaryAr", arabic: true, original: b.summaryAr });
  if (strayArabicInEnglish(b.summaryEn ?? "")) fixes.push({ key: "bias.summaryEn", arabic: false, original: b.summaryEn });
  if (payload.notesAr && strayLatinInArabic(payload.notesAr).length) fixes.push({ key: "notesAr", arabic: true, original: payload.notesAr });
  if (!fixes.length) return; // clean — the common case

  console.warn(
    "[ai-signals] language-purity violations:",
    fixes.map((f) => `${f.key}(${f.arabic ? strayLatinInArabic(f.original).join(",") : "arabic"})`).join("; ")
  );

  // last resort for a pick thesis: the deterministic evidence lines, rendered
  // in the field's language (T41 — never English codes in the Arabic slot;
  // T42 — prefers the per-ticker ensemble fallback computed at validation)
  const fallbackFor = (f: PurityFix) => {
    const pick = payload.picks.find((p) => f.key.startsWith(`${p.ticker}.`));
    if (pick && f.key.endsWith("thesisAr")) pick.thesisAr = fallbackArByTicker.get(pick.ticker) ?? evidenceAr(pick.evidence.slice(0, 6));
    else if (pick && f.key.endsWith("thesisEn")) pick.thesisEn = pick.evidence.slice(0, 6).join(" · ");
    else if (f.key === "bias.summaryAr") payload.marketBias.summaryAr = "الاتساع: صاعد مقابل هابط — راجع عناصر الأدلة.";
    else if (f.key === "bias.summaryEn") payload.marketBias.summaryEn = "Breadth: up vs down — see the evidence lines.";
    else if (f.key === "notesAr") payload.notesAr = null; // drop rather than serve dirty
  };

  try {
    const list = fixes.map((f) => `- ${f.key}: ${JSON.stringify(f.original.slice(0, 400))}`).join("\n");
    const raw = await createChat(
      zai,
      [
        {
          role: "user",
          content:
            "You wrote these fields for an Egyptian stock-market signals product, but they violate the language-purity rule:\n" +
            list +
            "\n\nRewrite EACH field in its pure language (Arabic fields: pure MSA Arabic — Latin allowed ONLY for tickers/technical acronyms like RSI, MACD, SMA, ATR; English fields: pure English). KEEP EVERY NUMBER EXACTLY as it is — do not add, drop, or round any number. Keep the meaning and the same length class.\n" +
            'Reply with EXACTLY ONE JSON object: { "fixes": { "<key>": "<rewritten text>", ... } } covering every key listed above, nothing else.',
        },
      ],
      retry
    );
    const parsedFix = extractJson(raw);
    const map = (parsedFix?.fixes ?? {}) as Record<string, unknown>;
    for (const f of fixes) {
      const candidate = typeof map[f.key] === "string" ? (map[f.key] as string).trim() : "";
      const clean = candidate && (f.arabic ? strayLatinInArabic(candidate).length === 0 : !strayArabicInEnglish(candidate));
      if (clean && numbersPreserved(f.original, candidate)) {
        if (f.key === "notesAr") payload.notesAr = candidate.slice(0, 400);
        else if (f.key === "bias.summaryAr") payload.marketBias.summaryAr = candidate.slice(0, 600);
        else if (f.key === "bias.summaryEn") payload.marketBias.summaryEn = candidate.slice(0, 600);
        else {
          const pick = payload.picks.find((p) => f.key.startsWith(`${p.ticker}.`));
          if (pick && f.key.endsWith("thesisAr")) pick.thesisAr = candidate.slice(0, 900);
          else if (pick && f.key.endsWith("thesisEn")) pick.thesisEn = candidate.slice(0, 900);
        }
      } else {
        fallbackFor(f);
      }
    }
  } catch (err) {
    console.warn("[ai-signals] purity repair failed:", err instanceof Error ? err.message : err);
    for (const f of fixes) fallbackFor(f);
  }
}

// ── persistence + refresh orchestration (stale-while-revalidate) ──

const g = globalThis as unknown as { __egxAiSignalsInflight?: Promise<AiSetPayload | null> };

function parseRow(row: { data: string; createdAt: Date; model: string; strategyRev: string; llmMs: number }) {
  try {
    const payload = JSON.parse(row.data) as AiSetPayload;
    // serve-time guard (T21 hardening): a set persisted by an older build can
    // carry a stale PAST earningsRisk (upstream nextEarnings epochs sometimes
    // point into the past) — the charter only ever means future dates, so
    // null anything that isn't strictly ahead of now, at every read path.
    const now = Date.now();
    for (const p of payload.picks ?? []) {
      if (p.earningsRisk) {
        const d = Date.parse(`${p.earningsRisk}T00:00:00Z`);
        if (!Number.isFinite(d) || d <= now) p.earningsRisk = null;
      }
      // T42 — normalize sets persisted by the pre-ensemble build (rev
      // egx-trend-v1): the new ensemble fields default to empty/zero so the
      // UI and agent never see undefined; a fresh set fills them properly
      if (!Array.isArray(p.strategies)) p.strategies = [];
      if (typeof p.longVotes !== "number") p.longVotes = 0;
      if (typeof p.avoidVotes !== "number") p.avoidVotes = 0;
      if (typeof p.applicable !== "number") p.applicable = 0;
      if (typeof p.agreement !== "number") p.agreement = 0;
      // T43 — normalize pre-ladder sets: derive the zone + T1/T3 rungs from
      // the persisted entry/stop/target deterministically (ATR is exactly
      // recoverable: stop = entry − 2×ATR). Avoids and chart-less picks
      // (entry null) simply carry plan: null.
      if (p.plan === undefined) {
        p.plan =
          p.stance === "long" && typeof p.entry === "number" && typeof p.stop === "number" && typeof p.target === "number"
            ? planFromLegacy(p.entry, p.stop, p.target)
            : null;
      } else if (p.plan !== null) {
        // a persisted ladder with a missing field (future edits) — guard
        for (const k of ["zoneLo", "zoneHi", "t1", "t2", "t3", "riskPct"] as const) {
          if (typeof p.plan[k] !== "number" || !Number.isFinite(p.plan[k])) {
            p.plan = null;
            break;
          }
        }
      }
    }
    return { ...payload, model: row.model, strategyRev: row.strategyRev, llmMs: row.llmMs };
  } catch {
    return null;
  }
}

async function refreshLocked(): Promise<AiSetPayload | null> {
  const t0 = Date.now();
  try {
    const { payload, llmMs } = await generateSet();
    await db.aiSignalSet.create({
      data: {
        model: "GLM",
        strategyRev: STRATEGY_REV,
        llmMs,
        data: JSON.stringify(payload),
        backtestRev: backtestJson.strategyRev,
      },
    });
    // prune (T43): keep the newest KEEP_SETS rows for freshness AND one
    // representative set per Cairo trading day for the last 60 days — that
    // daily spine is what lets the track record grow into a real multi-week
    // proof instead of evaporating after ~15 hours of 45-minute cycles.
    const rows = await db.aiSignalSet.findMany({
      orderBy: { createdAt: "desc" },
      take: PRUNE_SCAN,
      select: { id: true, createdAt: true },
    });
    const keep = new Set<string>(rows.slice(0, KEEP_SETS).map((r) => r.id));
    const seenDays = new Set<string>();
    const dayCutoff = Date.now() - 60 * 24 * 3600_000;
    for (const r of rows) {
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Africa/Cairo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(r.createdAt);
      if (r.createdAt.getTime() >= dayCutoff && !seenDays.has(day)) {
        seenDays.add(day);
        keep.add(r.id); // rows are desc — the first of a day is its latest set
      }
    }
    if (rows.length > keep.size) {
      await db.aiSignalSet.deleteMany({ where: { id: { notIn: [...keep] } } }).catch(() => {});
    }
    // meter the shared call (visible in /api/usage, never counts as a user question)
    await db.usageEvent
      .create({
        data: {
          ip: "system",
          route: "ai-signals",
          llmCalls: 1,
          toolCalls: 0,
          webSearches: 0,
          ok: true,
          ms: Date.now() - t0,
        },
      })
      .catch(() => {});
    return payload;
  } catch (err) {
    console.warn("[ai-signals] refresh failed:", err instanceof Error ? err.message : err);
    await db.usageEvent
      .create({ data: { ip: "system", route: "ai-signals", llmCalls: 1, ok: false, ms: Date.now() - t0 } })
      .catch(() => {});
    return null;
  }
}

/** Refresh if the newest set is older than the cooldown (in-flight deduped,
 *  safe to call from anywhere — HTTP requests, the push loop, warm-ups). */
export function refreshAiSignals(): Promise<AiSetPayload | null> {
  if (g.__egxAiSignalsInflight) return g.__egxAiSignalsInflight;
  const p = (async () => {
    try {
      const latest = await db.aiSignalSet.findFirst({ orderBy: { createdAt: "desc" } });
      if (latest && Date.now() - latest.createdAt.getTime() < COOLDOWN_MS) return parseRow(latest);
    } catch {
      /* db hiccup → still try to generate */
    }
    return refreshLocked();
  })().finally(() => {
    setTimeout(() => {
      if (g.__egxAiSignalsInflight === p) g.__egxAiSignalsInflight = undefined;
    }, 1000);
  });
  g.__egxAiSignalsInflight = p;
  return p;
}

/** Read-only latest set for the AI agent's `ai_signals` tool — never triggers
 *  a refresh (the agent must not spend shared budget on a question). */
export async function getLatestAiSignals(): Promise<(AiSetPayload & { model: string; strategyRev: string; llmMs: number }) | null> {
  try {
    const latest = await db.aiSignalSet.findFirst({ orderBy: { createdAt: "desc" } });
    return latest ? parseRow(latest) : null;
  } catch {
    return null;
  }
}

/** Stale-while-revalidate read for GET /api/ai-signals: a fresh set is
 *  served as-is; a stale set is served while a refresh runs in the
 *  background; a cold start waits up to `waitMs` for the first generation
 *  (the push-loop warm normally makes this path rare). */
export async function getAiSignals(waitMs = 60_000): Promise<AiSignalsResponse> {
  let latest: Awaited<ReturnType<typeof db.aiSignalSet.findFirst>> = null;
  try {
    latest = await db.aiSignalSet.findFirst({ orderBy: { createdAt: "desc" } });
  } catch {
    /* db unreachable → warming */
  }

  const base = {
    backtest: backtestJson,
    // T43 — the published-picks record (replayed against real candles).
    // Computed lazily with a 10-min cache; null ONLY if the whole module
    // fails (never blocks the signal set itself).
    trackRecord: await getTrackRecord().catch(() => null),
    meta: {
      cooldownMinutes: Math.round(COOLDOWN_MS / 60_000),
      sharedCompute: true as const,
      strategyRev: STRATEGY_REV,
      backtestRev: backtestJson.strategyRev,
      backtestStale: backtestJson.strategyRev !== STRATEGY_REV,
      charter: STRATEGY_CHARTER,
    },
  };

  const fresh = latest && Date.now() - latest.createdAt.getTime() < COOLDOWN_MS;
  if (latest && fresh) {
    const set = parseRow(latest);
    if (set) return { ok: true, status: "ready", set, ...base };
  }

  // stale (or unparseable) → refresh in the background and serve what we have
  const refresh = refreshAiSignals();
  if (latest) {
    const set = parseRow(latest);
    if (set) return { ok: true, status: "stale", set, ...base };
  }

  // cold start: wait for the first generation, bounded
  const first = await Promise.race([refresh, sleep(waitMs).then(() => null as AiSetPayload | null)]);
  if (first) {
    let row: Awaited<ReturnType<typeof db.aiSignalSet.findFirst>> = null;
    try {
      row = await db.aiSignalSet.findFirst({ orderBy: { createdAt: "desc" } });
    } catch {}
    const set = row ? parseRow(row) : null;
    if (set) return { ok: true, status: "ready", set, ...base };
  }
  return { ok: true, status: "warming", set: null, ...base };
}
