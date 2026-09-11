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
import { scanSignals, type SignalRow } from "@/lib/signals-scan";
import { fetchIndices } from "@/lib/market";
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
}`;

async function generateSet(): Promise<{ payload: AiSetPayload; llmMs: number }> {
  const t0 = Date.now();
  const [scan, indices] = await Promise.all([scanSignals(), fetchIndices()]);
  if (!scan.rows.length) throw new Error("signals scan unavailable");

  const candidates = await buildCandidates(scan);
  const byTicker = new Map(candidates.map((c) => [c.row.ticker, c]));

  const up = scan.rows.filter((r) => r.changePct > 0).length;
  const down = scan.rows.filter((r) => r.changePct < 0).length;
  const { best, worst } = sectorExtremes(scan.rows);
  const movers = [...scan.rows]
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 5)
    .map((r) => ({ ticker: r.ticker, nameAr: r.nameAr, changePct: r.changePct }));

  const marketContext = {
    scanAsOf: scan.asOf,
    indices: indices.map((i) => ({ code: i.code, close: i.close, changePct: i.changePct })),
    breadth: { up, down, flat: scan.rows.length - up - down, scanned: scan.rows.length },
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
        : `الاتساع: ${up} صاعد مقابل ${down} هابط من ${scan.rows.length} سهم.`,
    summaryEn:
      typeof biasRaw.summaryEn === "string" && biasRaw.summaryEn.trim()
        ? biasRaw.summaryEn.trim().slice(0, 600)
        : `Breadth: ${up} up vs ${down} down of ${scan.rows.length} scanned.`,
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
    const thesisAr =
      typeof o.thesisAr === "string" && o.thesisAr.trim() ? o.thesisAr.trim().slice(0, 900) : fallbackEvidence.join(" · ");
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
  return { payload, llmMs };
}

// ── persistence + refresh orchestration (stale-while-revalidate) ──

const g = globalThis as unknown as { __egxAiSignalsInflight?: Promise<AiSetPayload | null> };

function parseRow(row: { data: string; createdAt: Date; model: string; strategyRev: string; llmMs: number }) {
  try {
    const payload = JSON.parse(row.data) as AiSetPayload;
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
