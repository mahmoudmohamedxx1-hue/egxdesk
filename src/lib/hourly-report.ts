/** Market Desk Reports pipeline (Task 22) — the hourly "what could surge
 *  next" briefing plus the definitive end-of-day report.
 *
 *  Architecture (shared compute, same free-public economics as AI Signals):
 *  while the EGX session is open the desk produces ONE report per Cairo
 *  trading hour; shortly after the close it produces the final EOD report
 *  for the session. Each report is ONE LLM synthesis call over:
 *
 *    1. the deterministic technical scan (scanSignals — 13 indicators),
 *    2. the strategy charter's computed features + ATR risk levels,
 *    3. fresh quotes from the live universe snapshot, and
 *    4. a handful of LIVE WEB SEARCHES for catalysts and Egypt macro news
 *       (the user-facing requirement: reasons grounded in high-end knowledge,
 *       web search and site data — every catalyst carries its source).
 *
 *  The report is PERSISTED in SQLite and served to EVERY visitor from cache,
 *  so N readers cost the same 1 call + 2-3 searches. Validation is strict:
 *  tickers must come from the candidate set, surge potential is capped by the
 *  charter score, entry/stop/target come only from the local ATR math, and
 *  catalysts without a real source are dropped. */

import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { scanSignals, type SignalRow } from "@/lib/signals-scan";
import { fetchUniverse, fetchIndices } from "@/lib/market";
import { fetchStockChart } from "@/lib/history";
import { marketStatus } from "@/lib/market-status";
import { getLatestAiSignals } from "@/lib/ai-signals";
import {
  strategyFeaturesAt,
  riskLevels,
  type StrategyFeatures,
} from "@/lib/strategy";

// ── tuning ──

const KEEP_REPORTS = 80; // rows retained (≈ a day of hourlies + past EODs)
const MAX_MOVERS = 6;
const RETRY_BACKOFF_MS = [12_000, 25_000];
const RETRY_BUDGET_MS = 70_000;
const CAND_BULL = 10;
const CAND_MOVERS = 6;
const CAND_VOLUME = 5;
const FAIL_BACKOFF_MS = 4 * 60_000; // after a failed generation, wait before retrying
export const REPORT_REV = "egx-desk-report-v1";

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

export type ReportCatalyst = {
  text: string;
  /** Arabic rendering of the same catalyst (falls back to `text`) */
  textAr?: string;
  source: string;
  url?: string;
  date?: string;
};

export type ReportMover = {
  ticker: string;
  nameAr: string;
  nameEn: string;
  sectorAr: string;
  close: number;
  changePct: number;
  surgePotential: "high" | "medium" | "low";
  conviction: number; // 1-5
  charterScore: number | null;
  entry: number | null; // charter ATR math (authoritative)
  stop: number | null;
  target: number | null;
  rr: number | null;
  horizonSessions: number;
  reasonsAr: string[];
  reasonsEn: string[];
  catalysts: ReportCatalyst[];
  riskAr: string;
  riskEn: string;
};

export type ReportPayload = {
  generatedAt: string;
  session: string; // YYYY-MM-DD trading session
  kind: "hourly" | "eod";
  hourLabel: string; // "11:00" for hourly, "" for eod
  marketBias: {
    direction: "bullish" | "bearish" | "neutral";
    conviction: number;
    summaryAr: string;
    summaryEn: string;
  };
  movers: ReportMover[];
  webNotesAr: string | null;
  webNotesEn: string | null;
  scanned: number;
  sources: string[];
};

export type ReportRow = ReportPayload & { id: string; model: string; llmMs: number; webSearches: number };

export type ReportsResponse = {
  ok: true;
  status: "ready" | "warming";
  latest: ReportRow | null;
  history: { id: string; kind: "hourly" | "eod"; session: string; hourLabel: string; createdAt: string; movers: number }[];
  meta: {
    sharedCompute: true;
    cadenceMinutes: 60;
    reportRev: string;
    charter: string;
  };
};

// ── Cairo clock helpers (the report schedule is Cairo-native) ──

function cairoHM(now: Date): { hour: number; minute: number; ymd: string } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  return {
    hour: Number(parts.hour ?? "0"),
    minute: Number(parts.minute ?? "0"),
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

// ── the desk charter (the system prompt — single source of truth) ──

export const REPORT_CHARTER = `You are the EGX Desk editorial analyst. You write the desk's intraday reports for the Egyptian Exchange (EGX): one report every trading hour while the market is open, and the definitive end-of-day report shortly after the close. Readers are Egyptian retail investors — write for them.

MISSION: identify the small number of EGX-listed stocks with the strongest EVIDENCE-BACKED potential for a large near-term price move, and explain WHY with concrete, checkable reasons.

EVIDENCE HIERARCHY (never skip a level):
1. COMPUTED EVIDENCE from the candidate pack — trend vs SMA20/50/200, momentum, volume vs 10-day average, 52-week position, charter score, liquidity, day change. Every technical claim in your reasons must match the pack numbers.
2. LIVE WEB EVIDENCE supplied in the pack — every news / catalyst / macro claim must carry its source name, and the article date when the result has one. NEVER invent a catalyst, a headline, a number or a URL. If web results are thin, say so in webNotes — do not fabricate context.
3. Your own high-end market knowledge (EGX structure, Egypt macro, sector dynamics) FRAMES and CONNECTS the evidence — it never overrides level 1 or 2.

SELECTION DISCIPLINE:
- The strongest "surge" cases combine: a fresh directional catalyst from the web evidence, unusual volume vs the 10-day average, technical alignment (price above SMA20/SMA50, golden-cross or momentum turn), a sector tailwind, and adequate liquidity (value traded).
- A candidate whose charter score is below 0.35 can NEVER be rated "high" surge potential; below 0.15 stays "low".
- 3-5 movers is ideal. Fewer is fine when evidence is thin. NEVER pad the list with weak theses — an honest short list beats a long guess.
- For every mover: 2-4 reasons, each concrete (a number from the pack or an event with source+date); one honest risk sentence on what would invalidate the move.
- entry / stop / target / rr come PRECOMPUTED from the charter's ATR math in the pack — cite them exactly, never recompute or invent levels.
- EOD reports: recap the session (indices, breadth, what actually moved) first, then the movers, then a measured next-session outlook inside the market bias summary.

CONVICTION HONESTY: if the market bias contradicts a mover, lower its conviction. If the day is quiet, say so — a quiet market is a finding, not a failure.

This is a probabilistic research briefing for education — never investment advice, and you never present it as such.`;

// ── JSON extraction (same tolerant parser family as ai-signals) ──

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

// ── shared web searches (best-effort, never fatal) ──

type WebItem = { title: string; source: string; url: string; snippet: string; date: string };

async function webSearch(zai: Zai, query: string, recencyDays: number, num: number): Promise<WebItem[]> {
  const invoke = () =>
    zai.functions.invoke("web_search", {
      query,
      num,
      recency_days: recencyDays,
    });
  try {
    let results: unknown;
    try {
      results = await invoke();
    } catch (err) {
      if (!isThrottleError(err)) throw err;
      await sleep(9_000); // one patient retry on gateway 429s
      results = await invoke();
    }
    type SearchItem = { url?: unknown; name?: unknown; snippet?: unknown; host_name?: unknown; date?: unknown };
    const items = (Array.isArray(results) ? (results as SearchItem[]) : []).slice(0, num);
    return items
      .map((r) => ({
        title: typeof r?.name === "string" ? r.name.slice(0, 200) : "",
        source: typeof r?.host_name === "string" ? r.host_name.replace(/^www\./, "").slice(0, 60) : "",
        url: typeof r?.url === "string" && /^https?:\/\//i.test(r.url) ? r.url.slice(0, 400) : "",
        snippet: typeof r?.snippet === "string" ? r.snippet.slice(0, 500) : "",
        date: typeof r?.date === "string" ? r.date.slice(0, 10) : "",
      }))
      .filter((r) => r.title || r.snippet);
  } catch {
    return []; // a failed search never kills the report
  }
}

async function gatherWebEvidence(zai: Zai): Promise<{ items: WebItem[]; searches: number }> {
  const queries: [string, number, number][] = [
    ["EGX Egyptian Exchange stock market today EGX30 movers", 2, 6],
    ["Egypt stock market news companies", 2, 6],
    ["Egypt economy news investors", 3, 5],
  ];
  const out: WebItem[] = [];
  let searches = 0;
  for (const [q, recency, num] of queries) {
    const items = await webSearch(zai, q, recency, num);
    if (items.length) searches++;
    out.push(...items);
    await sleep(400);
  }
  // dedupe by url/title
  const seen = new Set<string>();
  const dedup = out.filter((r) => {
    const key = r.url || r.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { items: dedup.slice(0, 14), searches };
}

// ── the evidence pack ──

type Candidate = {
  row: SignalRow;
  f: StrategyFeatures | null;
  risk: { entry: number; stop: number; target: number; rr: number } | null;
};

async function buildCandidates(scan: Awaited<ReturnType<typeof scanSignals>>): Promise<Candidate[]> {
  const bulls = scan.rows.slice(0, CAND_BULL);
  const movers = [...scan.rows]
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, CAND_MOVERS);
  const volume = [...scan.rows]
    .sort((a, b) => (b.volRatio ?? 0) - (a.volRatio ?? 0))
    .slice(0, CAND_VOLUME);
  const seen = new Set<string>();
  const rows: SignalRow[] = [];
  for (const r of [...bulls, ...movers, ...volume]) {
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

// ── the one LLM call ──

const OUTPUT_SCHEMA = `{
  "marketBias": { "direction": "bullish" | "bearish" | "neutral", "conviction": 1-5, "summaryAr": "2-4 sentences (EOD: session recap + next-session outlook)", "summaryEn": "same in English" },
  "movers": [
    {
      "ticker": "COMI", "surgePotential": "high" | "medium" | "low", "conviction": 1-5, "horizonSessions": 10,
      "reasonsAr": ["2-4 concrete reasons, numbers from the pack / events with source+date"],
      "reasonsEn": ["same reasons in English"],
      "catalysts": [ { "text": "short catalyst in English", "textAr": "نفس المحفّز بالعربية", "source": "reuters.com", "url": "https://...", "date": "2026-09-13" } ],
      "riskAr": "one honest sentence", "riskEn": "one honest sentence"
    }
  ],
  "webNotesAr": "1-3 sentences of Egypt macro / market context from the web evidence (with sources), or null when thin",
  "webNotesEn": "same in English, or null"
}`;

async function createChat(
  zai: Zai,
  messages: { role: "user" | "assistant"; content: string }[],
  retry: { budgetLeft: number }
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const completion = await zai.chat.completions.create({
        messages,
        thinking: { type: "enabled" }, // the desk's synthesis moment — genuine reasoning
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

async function generateReport(
  kind: "hourly" | "eod",
  session: string,
  hourLabel: string
): Promise<{ payload: ReportPayload; llmMs: number; webSearches: number }> {
  const t0 = Date.now();
  const [scan, indices, stocks, aiSet] = await Promise.all([
    scanSignals(),
    fetchIndices(),
    fetchUniverse(),
    getLatestAiSignals().catch(() => null),
  ]);
  if (!scan.rows.length) throw new Error("signals scan unavailable");

  // merge the freshest quotes onto the scan rows (the scan itself is cached
  // up to an hour; the report should speak with the newest delayed quotes)
  const fresh = new Map(stocks.map((s) => [s.ticker, s]));
  for (const r of scan.rows) {
    const s = fresh.get(r.ticker);
    if (s) {
      r.close = s.close;
      r.changePct = s.changePct;
      r.volume = s.volume;
      r.valueTraded = s.valueTraded;
    }
  }

  const candidates = await buildCandidates(scan);
  const byTicker = new Map(candidates.map((c) => [c.row.ticker, c]));

  const up = scan.rows.filter((r) => r.changePct > 0).length;
  const down = scan.rows.filter((r) => r.changePct < 0).length;

  const zai = await getZai();
  const web = await gatherWebEvidence(zai);

  const marketContext = {
    reportKind: kind === "eod" ? "END-OF-DAY FINAL REPORT (session closed — recap + tomorrow outlook)" : `INTRADAY HOURLY REPORT (${hourLabel} Cairo)`,
    session,
    scanAsOf: scan.asOf,
    indices: indices.map((i) => ({ code: i.code, close: i.close, changePct: i.changePct, ytd: i.perfYTD })),
    breadth: { up, down, flat: scan.rows.length - up - down, scanned: scan.rows.length },
    aiSignalsContext: aiSet
      ? {
          bias: aiSet.marketBias.direction,
          picks: aiSet.picks.map((p) => ({ ticker: p.ticker, stance: p.stance, conviction: p.conviction })),
          generatedAt: aiSet.generatedAt,
        }
      : null,
    webEvidence: web.items.map((w) => ({ title: w.title, source: w.source, url: w.url, date: w.date, snippet: w.snippet })),
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
    volRatio: row.volRatio, // session volume ÷ 10-day average — the surge confirmation
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
    "MARKET CONTEXT + LIVE WEB EVIDENCE:",
    JSON.stringify(marketContext),
    "",
    "CANDIDATES (charter-scored on daily candles; charterRisk is the precomputed ATR level set):",
    JSON.stringify(pack),
    "",
    kind === "eod"
      ? "Write the END-OF-DAY report: recap the session in marketBias, then the movers with the strongest next-move potential, then the outlook."
      : "Write this hour's desk report: what is moving and which candidates have the strongest evidence-backed potential for a large near-term price move.",
    "Reply with EXACTLY ONE JSON object, no fences, no commentary, matching this schema:",
    OUTPUT_SCHEMA,
  ].join("\n");

  const retry = { budgetLeft: RETRY_BUDGET_MS };
  const raw = await createChat(
    zai,
    [
      { role: "assistant", content: REPORT_CHARTER },
      { role: "user", content: userMsg },
    ],
    retry
  );
  const llmMs = Date.now() - t0;

  const parsed = extractJson(raw);
  if (!parsed) throw new Error("desk-report: unparseable LLM reply");

  // ── validation + assembly (charter math is authoritative) ──
  const biasRaw = (parsed.marketBias ?? {}) as Record<string, unknown>;
  const dir =
    biasRaw.direction === "bullish" || biasRaw.direction === "bearish" ? biasRaw.direction : "neutral";
  const biasConv = Math.min(5, Math.max(1, Math.round(Number(biasRaw.conviction) || 2)));
  const bias = {
    direction: dir as ReportPayload["marketBias"]["direction"],
    conviction: biasConv,
    summaryAr:
      typeof biasRaw.summaryAr === "string" && biasRaw.summaryAr.trim()
        ? biasRaw.summaryAr.trim().slice(0, 900)
        : `الاتساع: ${up} صاعد مقابل ${down} هابط من ${scan.rows.length} سهم.`,
    summaryEn:
      typeof biasRaw.summaryEn === "string" && biasRaw.summaryEn.trim()
        ? biasRaw.summaryEn.trim().slice(0, 900)
        : `Breadth: ${up} up vs ${down} down of ${scan.rows.length} scanned.`,
  };

  const moversRaw = Array.isArray(parsed.movers) ? parsed.movers : [];
  const movers: ReportMover[] = [];
  for (const p of moversRaw) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const ticker =
      typeof o.ticker === "string" ? o.ticker.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
    const cand = byTicker.get(ticker);
    if (!cand) continue; // unknown ticker — never serve it
    const f = cand.f;
    const charterScore = f ? f.score : cand.row.score;

    let potential: "high" | "medium" | "low" = o.surgePotential === "high" ? "high" : o.surgePotential === "low" ? "low" : "medium";
    // charter discipline: weak engine reads can never be high-potential calls
    if (charterScore < 0.15) potential = "low";
    else if (charterScore < 0.35 && potential === "high") potential = "medium";

    let conviction = Math.min(5, Math.max(1, Math.round(Number(o.conviction) || 2)));
    if (potential !== "high" && conviction > 4) conviction = 4;
    if (dir === "bearish" && conviction > 3) conviction = 3;
    if (dir === "neutral" && potential === "high" && conviction > 4) conviction = 4;

    const horizon = Math.min(20, Math.max(5, Math.round(Number(o.horizonSessions) || 10)));

    const strArr = (v: unknown, fallback: string[]): string[] =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, 400)).slice(0, 5)
        : [];
    const fallbackEvidence = f ? f.evidence.slice(0, 4) : [`indicator score ${charterScore}`, `day ${cand.row.changePct}%`];
    const reasonsAr = strArr(o.reasonsAr, []).length ? strArr(o.reasonsAr, []) : fallbackEvidence;
    const reasonsEn = strArr(o.reasonsEn, []).length ? strArr(o.reasonsEn, []) : fallbackEvidence;

    const catalysts: ReportCatalyst[] = (Array.isArray(o.catalysts) ? o.catalysts : [])
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
      .map((c) => ({
        text: typeof c.text === "string" ? c.text.trim().slice(0, 260) : "",
        textAr: typeof c.textAr === "string" && c.textAr.trim() ? c.textAr.trim().slice(0, 260) : undefined,
        source: typeof c.source === "string" ? c.source.replace(/^www\./, "").slice(0, 60) : "",
        url:
          typeof c.url === "string" && /^https?:\/\//i.test(c.url)
            ? c.url.slice(0, 400)
            : undefined,
        date: typeof c.date === "string" ? c.date.slice(0, 10) : undefined,
      }))
      .filter((c) => c.text.length > 3)
      .slice(0, 4);

    movers.push({
      ticker,
      nameAr: cand.row.nameAr,
      nameEn: cand.row.name,
      sectorAr: cand.row.sectorAr,
      close: f ? f.close : cand.row.close,
      changePct: cand.row.changePct,
      surgePotential: potential,
      conviction,
      charterScore,
      entry: cand.risk?.entry ?? null,
      stop: cand.risk?.stop ?? null,
      target: cand.risk?.target ?? null,
      rr: cand.risk?.rr ?? null,
      horizonSessions: horizon,
      reasonsAr,
      reasonsEn,
      catalysts,
      riskAr:
        typeof o.riskAr === "string" && o.riskAr.trim()
          ? o.riskAr.trim().slice(0, 300)
          : "فشل مستوى الدخول أو تغيّر خبري مضاد يُبطل الفكرة.",
      riskEn:
        typeof o.riskEn === "string" && o.riskEn.trim()
          ? o.riskEn.trim().slice(0, 300)
          : "Entry level failing or an adverse headline invalidates the idea.",
    });
    if (movers.length >= MAX_MOVERS) break;
  }

  const sources = [
    ...new Set(
      movers.flatMap((m) => m.catalysts.map((c) => c.source)).filter((s) => s.length > 2)
    ),
  ].slice(0, 8);

  const payload: ReportPayload = {
    generatedAt: new Date().toISOString(),
    session,
    kind,
    hourLabel,
    marketBias: bias,
    movers,
    webNotesAr:
      typeof parsed.webNotesAr === "string" && parsed.webNotesAr.trim()
        ? parsed.webNotesAr.trim().slice(0, 800)
        : null,
    webNotesEn:
      typeof parsed.webNotesEn === "string" && parsed.webNotesEn.trim()
        ? parsed.webNotesEn.trim().slice(0, 800)
        : null,
    scanned: scan.rows.length,
    sources,
  };
  return { payload, llmMs, webSearches: web.searches };
}

// ── persistence ──

function parseReportRow(row: {
  id: string;
  data: string;
  createdAt: Date;
  kind: string;
  session: string;
  hourLabel: string;
  model: string;
  llmMs: number;
  webSearches: number;
}): ReportRow | null {
  try {
    const payload = JSON.parse(row.data) as ReportPayload;
    return {
      ...payload,
      kind: row.kind === "eod" ? "eod" : "hourly",
      id: row.id,
      model: row.model,
      llmMs: row.llmMs,
      webSearches: row.webSearches,
    };
  } catch {
    return null;
  }
}

async function persist(
  kind: "hourly" | "eod",
  session: string,
  hourLabel: string,
  out: { payload: ReportPayload; llmMs: number; webSearches: number },
  startedAt: number
): Promise<void> {
  await db.marketReport.create({
    data: {
      kind,
      session,
      hourLabel,
      model: "GLM",
      llmMs: out.llmMs,
      webSearches: out.webSearches,
      data: JSON.stringify(out.payload),
    },
  });
  // prune: keep the newest KEEP_REPORTS rows
  const rows = await db.marketReport.findMany({
    orderBy: { createdAt: "desc" },
    take: KEEP_REPORTS,
    select: { id: true },
  });
  if (rows.length === KEEP_REPORTS) {
    await db.marketReport.deleteMany({ where: { id: { notIn: rows.map((r) => r.id) } } }).catch(() => {});
  }
  // meter the shared compute (visible in /api/usage, never a user question)
  await db.usageEvent
    .create({
      data: {
        ip: "system",
        route: "hourly-report",
        llmCalls: 1,
        toolCalls: 0,
        webSearches: out.webSearches,
        ok: true,
        ms: Date.now() - startedAt,
      },
    })
    .catch(() => {});
}

// ── scheduling: what report is due right now? ──

export type DueReport = { kind: "hourly" | "eod"; session: string; hourLabel: string } | null;

/** Pure decision: given the clock and what already exists, what should the
 *  desk publish next? null = nothing due. */
export function reportDueNow(
  exists: (kind: "hourly" | "eod", session: string, hourLabel: string) => Promise<boolean>
): Promise<DueReport> {
  const st = marketStatus();
  const { hour, minute, ymd } = cairoHM(new Date());

  if (st.open) {
    // hourly report for the current floor trading hour (10..13; the 14:00
    // stretch is short and the EOD closes the day)
    if (hour >= 10 && hour <= 13) {
      const hourLabel = `${String(hour).padStart(2, "0")}:00`;
      return exists("hourly", st.lastSession, hourLabel).then((yes) =>
        yes ? null : { kind: "hourly", session: st.lastSession, hourLabel }
      );
    }
    return Promise.resolve(null);
  }

  // market closed — the EOD report for the last session, once, after the
  // close settles (or whenever we first notice the session is complete)
  const minutesOfDay = hour * 60 + minute;
  const sessionIsToday = ymd === st.lastSession;
  const settled = !sessionIsToday || minutesOfDay >= 14 * 60 + 35;
  if (!settled) return Promise.resolve(null);
  return exists("eod", st.lastSession, "").then((yes) =>
    yes ? null : { kind: "eod", session: st.lastSession, hourLabel: "" }
  );
}

// ── generation orchestration (in-flight dedup + failure backoff) ──

const g = globalThis as unknown as {
  __egxReportInflight?: Promise<ReportRow | null>;
  __egxReportFailAt?: number;
};

async function existsReport(kind: "hourly" | "eod", session: string, hourLabel: string): Promise<boolean> {
  try {
    const row = await db.marketReport.findFirst({ where: { kind, session, hourLabel }, select: { id: true } });
    return !!row;
  } catch {
    return true; // db hiccup — do NOT spawn a generation we can't dedupe
  }
}

/** Generate the due report (if any). Safe to call from anywhere — the push
 *  loop, HTTP reads, warm-ups. Deduped in-flight; a recent failure backs off. */
export function maybeGenerateReport(): Promise<ReportRow | null> {
  if (g.__egxReportInflight) return g.__egxReportInflight;
  if (g.__egxReportFailAt && Date.now() - g.__egxReportFailAt < FAIL_BACKOFF_MS) {
    return Promise.resolve(null);
  }
  const p = (async () => {
    const due = await reportDueNow(existsReport);
    if (!due) return null;
    const startedAt = Date.now();
    try {
      const out = await generateReport(due.kind, due.session, due.hourLabel);
      await persist(due.kind, due.session, due.hourLabel, out, startedAt);
      console.log(
        `[desk-report] ${due.kind}${due.hourLabel ? " " + due.hourLabel : ""} for ${due.session}: ${out.payload.movers.length} movers, bias ${out.payload.marketBias.direction}, ${out.llmMs}ms`
      );
      const row = await db.marketReport.findFirst({
        where: { kind: due.kind, session: due.session, hourLabel: due.hourLabel },
        orderBy: { createdAt: "desc" },
      });
      return row ? parseReportRow(row) : null;
    } catch (err) {
      g.__egxReportFailAt = Date.now();
      console.warn("[desk-report] generation failed:", err instanceof Error ? err.message : err);
      await db.usageEvent
        .create({
          data: { ip: "system", route: "hourly-report", llmCalls: 1, ok: false, ms: Date.now() - startedAt },
        })
        .catch(() => {});
      return null;
    }
  })().finally(() => {
    setTimeout(() => {
      if (g.__egxReportInflight === p) g.__egxReportInflight = undefined;
    }, 1000);
  });
  g.__egxReportInflight = p;
  return p;
}

// ── read paths ──

export async function getReportById(id: string): Promise<ReportRow | null> {
  try {
    const row = await db.marketReport.findUnique({ where: { id } });
    return row ? parseReportRow(row) : null;
  } catch {
    return null;
  }
}

/** Latest + history for GET /api/reports (stale-while-revalidate: a due
 *  report regenerates in the BACKGROUND while the latest is served). */
export async function getReports(waitMs = 45_000): Promise<ReportsResponse> {
  const base = {
    meta: {
      sharedCompute: true as const,
      cadenceMinutes: 60 as const,
      reportRev: REPORT_REV,
      charter: REPORT_CHARTER,
    },
  };

  let rows: Awaited<ReturnType<typeof db.marketReport.findMany>> = [];
  try {
    rows = await db.marketReport.findMany({ orderBy: { createdAt: "desc" }, take: 40 });
  } catch {
    /* db unreachable → warming */
  }

  // kick a due generation in the background (deduped + backed-off inside)
  void maybeGenerateReport().catch(() => {});

  if (rows.length === 0) {
    // cold start: bounded wait for the first report
    const first = await Promise.race([
      maybeGenerateReport(),
      sleep(waitMs).then(() => null as ReportRow | null),
    ]);
    if (first) {
      try {
        rows = await db.marketReport.findMany({ orderBy: { createdAt: "desc" }, take: 40 });
      } catch {}
    }
  }

  const history = rows.map((r) => {
    let movers = 0;
    try {
      movers = (JSON.parse(r.data) as ReportPayload).movers?.length ?? 0;
    } catch {}
    return {
      id: r.id,
      kind: (r.kind === "eod" ? "eod" : "hourly") as "hourly" | "eod",
      session: r.session,
      hourLabel: r.hourLabel,
      createdAt: r.createdAt.toISOString(),
      movers,
    };
  });
  const latest = rows.length ? parseReportRow(rows[0]) : null;

  return { ok: true, status: latest ? "ready" : "warming", latest, history, ...base };
}

/** Read-only latest report for the AI agent's `desk_reports` tool — never
 *  triggers a generation (the agent must not spend shared budget). */
export async function getLatestReport(): Promise<ReportRow | null> {
  try {
    const row = await db.marketReport.findFirst({ orderBy: { createdAt: "desc" } });
    return row ? parseReportRow(row) : null;
  } catch {
    return null;
  }
}
