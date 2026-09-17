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
  type StrategyFeatures,
} from "@/lib/strategy";
import backtestJson from "@/data/backtest.json";

// ── tuning ──

const COOLDOWN_MS = 45 * 60_000; // one shared refresh per 45 minutes
const MAX_PICKS = 6;
const KEEP_SETS = 20; // rows retained for history/debugging
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
  charterScore: number | null; // the deterministic engine's score
  close: number;
  entry: number | null; // charter ATR math (authoritative)
  stop: number | null;
  target: number | null;
  rr: number | null;
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
  risk: { entry: number; stop: number; target: number; rr: number } | null;
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
      try {
        const chart = await fetchStockChart(row.ticker, "1Y");
        f = strategyFeaturesAt(row.ticker, chart.points);
      } catch {
        f = null; // chart hiccup — the scan row still carries the 13-indicator read
      }
      out.push({ row, f, risk: f ? riskLevels(f) : null });
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
 *  English originals live in strategy.ts). Used whenever a thesis falls back
 *  to its evidence lines, so the Arabic slot never receives English text. */
export function evidenceAr(codes: string[]): string {
  const parts: string[] = [];
  for (const c of codes) {
    let m: RegExpExecArray | null;
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

  const marketContext = {
    scanAsOf: scan.asOf,
    indices: indices.map((i) => ({ code: i.code, close: i.close, changePct: i.changePct })),
    breadth: { up, down, flat: universe.length - up - down, scanned: universe.length },
    bestSector: best,
    worstSector: worst,
    topMovers: movers,
    backtestEvidence: backtestJson.stats,
    backtestMethod: backtestJson.method,
  };

  const pack = candidates.map(({ row, f, risk }) => ({
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
  }));

  const userMsg = [
    "MARKET CONTEXT (live, ~15-min delayed):",
    JSON.stringify(marketContext),
    "",
    "CANDIDATES (charter-scored on daily candles; charterRisk is the precomputed ATR level set):",
    JSON.stringify(pack),
    "",
    "Apply the charter to this evidence. Choose 3-6 picks (you may include 'avoid' stances when the charter's bear rules clearly fire; you may return fewer picks or none qualifying).",
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
  for (const p of picksRaw) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const ticker = typeof o.ticker === "string" ? o.ticker.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
    const cand = byTicker.get(ticker);
    if (!cand) continue; // unknown ticker — never serve it
    const f = cand.f;
    const charterScore = f ? f.score : cand.row.score;
    const stance: "long" | "avoid" = o.stance === "avoid" ? "avoid" : "long";
    // charter discipline: no longs the engine scores weakly, no avoids on strong setups
    if (stance === "long" && charterScore < 0.35) continue;
    if (stance === "avoid" && charterScore > 0.35) continue;
    // conviction cap: a long cannot be max-conviction against the market bias
    let conviction = Math.min(5, Math.max(1, Math.round(Number(o.conviction) || 2)));
    if (stance === "long" && bias.direction === "neutral" && conviction > 4) conviction = 4;
    if (stance === "long" && bias.direction === "bearish" && conviction > 3) conviction = 3;
    if (stance === "avoid" && bias.direction === "bullish" && conviction > 3) conviction = 3;

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
    const fallbackEvidence = f ? f.evidence.slice(0, 6) : [`indicator score ${charterScore}`];
    // T41 — a missing Arabic thesis falls back to the DETERMINISTIC evidence
    // rendered in Arabic (the old fallback joined the English evidence codes
    // into the Arabic slot). Same numbers, reader's language.
    const fallbackThesisAr = f
      ? evidenceAr(f.evidence.slice(0, 6))
      : `درجة المحرك ${charterScore.toFixed(2)} — راجع عناصر الأدلة.`;
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
      close: f ? f.close : cand.row.close,
      entry: stance === "long" ? cand.risk?.entry ?? null : null,
      stop: stance === "long" ? cand.risk?.stop ?? null : null,
      target: stance === "long" ? cand.risk?.target ?? null : null,
      rr: stance === "long" ? cand.risk?.rr ?? null : null,
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
  await purifyPayload(payload, zai, retry);
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
  retry: { budgetLeft: number }
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
  // in the field's language (T41 — never English codes in the Arabic slot)
  const fallbackFor = (f: PurityFix) => {
    const pick = payload.picks.find((p) => f.key.startsWith(`${p.ticker}.`));
    if (pick && f.key.endsWith("thesisAr")) pick.thesisAr = evidenceAr(pick.evidence.slice(0, 6));
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
    // prune: keep the newest KEEP_SETS rows
    const rows = await db.aiSignalSet.findMany({ orderBy: { createdAt: "desc" }, take: KEEP_SETS, select: { id: true } });
    if (rows.length === KEEP_SETS) {
      await db.aiSignalSet.deleteMany({ where: { id: { notIn: rows.map((r) => r.id) } } }).catch(() => {});
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
