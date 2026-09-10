import { NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { fetchUniverse, fetchIndices, companyRow, sectorRows, type Stock } from "@/lib/market";
import { scanSignals, signalForTicker, type SignalRow } from "@/lib/signals-scan";
import { fetchStatements, type StatementsData } from "@/lib/statements";
import { fetchDividends } from "@/lib/dividends";
import { fetchCalendar, type CalendarEvent } from "@/lib/events";
import { fetchRates } from "@/lib/rates";
import { queryNews, relatedNewsArchive } from "@/lib/news-archive";
import { fetchNewsEn } from "@/lib/news-en";
import { fetchFlows } from "@/lib/flows";
import { marketNarrative } from "@/lib/narrative";
import insidersRaw from "@/data/insiders.json";

/** POST /api/agent — the in-app EGX analyst agent (inspired by the tool-loop
 *  pattern of open-source agent frameworks like shubhamsaboo/awesome-llm-apps
 *  and the agent-skills repos): an LLM with STRICT-JSON tool calling over our
 *  own live data layer — quotes, screening, technicals, statements, dividends,
 *  news, calendar, rates, insider filings, flows. The loop runs server-side
 *  (z-ai-web-dev-sdk never reaches the client), max ~7 tool calls per
 *  question, then the model writes the final markdown answer.
 *
 *  Honesty by design: tools return only real (delayed ~15-min) data; the
 *  system prompt forbids invented numbers; the response carries a fixed
 *  disclaimer that the client always renders. */

export const runtime = "nodejs";

// ── rate limiting (in-memory, per IP — a personal tool, not a public API) ──

const RATE_LIMIT = 30; // requests per hour
const rateMap = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const window = 60 * 60_000;
  const arr = (rateMap.get(ip) ?? []).filter((t) => now - t < window);
  if (arr.length >= RATE_LIMIT) {
    rateMap.set(ip, arr);
    return true;
  }
  arr.push(now);
  rateMap.set(ip, arr);
  if (rateMap.size > 500) {
    // drop stale entries so the map can never grow unbounded
    for (const [k, v] of rateMap) if (v.every((t) => now - t >= window)) rateMap.delete(k);
  }
  return false;
}

// ── types ──

type ChatMsg = { role: "user" | "assistant"; content: string };

export type AgentStep = {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary?: string;
};

// ── z-ai SDK singleton ──

type Zai = Awaited<ReturnType<typeof ZAI.create>>;
let zaiPromise: Promise<Zai> | null = null;
function getZai(): Promise<Zai> {
  if (!zaiPromise) zaiPromise = ZAI.create();
  return zaiPromise;
}

// ── helpers ──

function cleanTicker(raw: unknown): string {
  return typeof raw === "string" ? raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) : "";
}

function clampLimit(raw: unknown, max: number, dflt: number): number {
  const n = typeof raw === "number" ? Math.floor(raw) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return dflt;
  return Math.min(n, max);
}

/** First balanced JSON object in the model output (handles ```json fences),
 *  with two repair passes for common LLM quirks: control characters (raw
 *  newlines) inside string literals, and replies truncated mid-string (no
 *  closing brace) — the tail is then recovered with a regex. */
function tryParse(s: string): Record<string, unknown> | null {
  try {
    const p = JSON.parse(s);
    return p && typeof p === "object" ? (p as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Escape raw \n \r \t that appear INSIDE string literals (invalid JSON that
 *  models sometimes emit); whitespace outside strings is left alone. */
function repairControlChars(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (esc) {
      out += ch;
      esc = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      out += ch;
      continue;
    }
    if (inStr && (ch === "\n" || ch === "\r" || ch === "\t")) {
      out += "\\n";
      continue;
    }
    out += ch;
  }
  return out;
}

/** Extract every balanced top-level {...} span in order (used by extractJson
 *  so reasoning prose around the reply object is ignored). */
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
    if (!closed) return; // truncated from here on — stop
  }
}

function extractJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let s = raw.trim();
  // thinking-enabled models sometimes inline chain-of-thought — strip it first
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // 1) scan every balanced object; the FIRST one that follows the reply
  //    protocol (has "tool" or "final") wins — prose or examples before it
  //    are ignored. A parsed non-protocol object is kept as a last resort so
  //    the caller can issue a format correction (original behavior).
  let firstParsed: Record<string, unknown> | null = null;
  for (const span of topLevelJsonObjects(s)) {
    const p = tryParse(span) ?? tryParse(repairControlChars(span));
    if (!p) continue;
    if (firstParsed === null) firstParsed = p;
    if ("tool" in p || "final" in p) return p;
  }
  if (firstParsed) return firstParsed;

  // 2) truncated reply (no closing brace): recover {"final": "… from the tail
  const mFinal = s.match(/"final"\s*:\s*"([\s\S]*)/);
  if (mFinal) {
    const tail = mFinal[1].replace(/"\s*\}?\s*$/, "").trim();
    if (tail.length > 0) return { final: tail };
  }

  // 3) a tool call that survived truncation: {"tool": "name"…
  const mTool = s.match(/"tool"\s*:\s*"([A-Za-z_][A-Za-z0-9_]*)"/);
  if (mTool) {
    const mArgs = s.match(/"args"\s*:\s*(\{[\s\S]*?)[}]?\s*$/);
    let args: Record<string, unknown> = {};
    if (mArgs) {
      const repaired = repairControlChars(`${mArgs[1]}}`);
      const parsed = tryParse(repaired);
      if (parsed) args = parsed;
    }
    return { tool: mTool[1], args };
  }
  return null;
}

function compactQuote(s: Stock) {
  const r = companyRow(s);
  return {
    ticker: r.ticker,
    name: r.name,
    nameAr: r.nameAr,
    sectorAr: r.sectorAr,
    close: r.close,
    changePct: r.changePct,
    changeAbs: r.changeAbs,
    volume: r.volume,
    marketCap: r.marketCap,
    pe: r.pe,
    pb: r.pb,
    divYield: r.divYield,
    eps: r.eps,
    roe: r.roe,
    high52: r.high52,
    low52: r.low52,
    perf1M: r.perf1M,
    perf6M: r.perf6M,
    perfYTD: r.perfYTD,
    perfY: r.perfY,
    nextEarnings: r.nextEarnings,
  };
}

function compactSignal(r: SignalRow) {
  return {
    ticker: r.ticker,
    nameAr: r.nameAr,
    rating: r.rating,
    score: r.score,
    buy: r.buy,
    sell: r.sell,
    rsi: r.rsi,
    macdHist: r.macdHist,
    close: r.close,
    changePct: r.changePct,
    pos52: r.pos52,
    volRatio: r.volRatio,
  };
}

// ── the tool registry (each tool returns compact real data) ──

type Tool = {
  name: string;
  desc: string;
  run: (args: Record<string, unknown>) => Promise<unknown>;
};

const TOOLS: Tool[] = [
  {
    name: "market_overview",
    desc: "Current market state: the 3 EGX indices, breadth (up/down/flat counts), biggest movers, best/worst sectors and a one-line narrative.",
    run: async () => {
      const [stocks, indices] = await Promise.all([fetchUniverse(), fetchIndices()]);
      const up = stocks.filter((s) => s.changePct > 0).length;
      const down = stocks.filter((s) => s.changePct < 0).length;
      const movers = [...stocks]
        .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
        .slice(0, 5)
        .map((s) => ({ ticker: s.ticker, nameAr: companyRow(s).nameAr, changePct: s.changePct }));
      const sectors = sectorRows(stocks).filter((s) => s.count >= 3 && s.capWeightedChangePct !== null);
      const best = [...sectors].sort((a, b) => (b.capWeightedChangePct ?? 0) - (a.capWeightedChangePct ?? 0))[0];
      const worst = [...sectors].sort((a, b) => (a.capWeightedChangePct ?? 0) - (b.capWeightedChangePct ?? 0))[0];
      const egx30 = indices.find((i) => i.code === "EGX30") ?? null;
      let flows: { egyNet: number; arabNet: number; forNet: number } | null = null;
      try {
        const snap = await Promise.race([fetchFlows(), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
        if (snap) {
          flows = {
            egyNet: snap.nationalityNet.egyptians,
            arabNet: snap.nationalityNet.arabs,
            forNet: snap.nationalityNet.foreigners,
          };
        }
      } catch {}
      const narrative = marketNarrative(
        {
          indexName: egx30?.nameAr ?? "EGX 30",
          indexChangePct: egx30?.changePct ?? null,
          up,
          down,
          total: stocks.length,
          flows,
          bestSector: best?.nameAr ?? null,
          worstSector: worst?.nameAr ?? null,
          topMover: movers[0] ? { ticker: movers[0].ticker, changePct: movers[0].changePct } : null,
        },
        "ar"
      );
      return {
        indices: indices.map((i) => ({ code: i.code, nameAr: i.nameAr, close: i.close, changePct: i.changePct })),
        breadth: { up, down, flat: stocks.length - up - down, total: stocks.length },
        movers,
        bestSector: best ? { nameAr: best.nameAr, changePct: best.capWeightedChangePct } : null,
        worstSector: worst ? { nameAr: worst.nameAr, changePct: worst.capWeightedChangePct } : null,
        flows,
        narrative,
      };
    },
  },
  {
    name: "top_movers",
    desc: "Ranked lists: kind = gainers | losers | active (by traded value). arg: { kind, limit<=15 }.",
    run: async (args) => {
      const kind = args.kind === "losers" || args.kind === "active" ? String(args.kind) : "gainers";
      const limit = clampLimit(args.limit, 15, 10);
      const stocks = await fetchUniverse();
      let list = stocks;
      if (kind === "gainers") list = [...stocks].sort((a, b) => b.changePct - a.changePct);
      else if (kind === "losers") list = [...stocks].sort((a, b) => a.changePct - b.changePct);
      else list = [...stocks].sort((a, b) => b.valueTraded - a.valueTraded);
      return list.slice(0, limit).map((s) => {
        const r = companyRow(s);
        return { ticker: r.ticker, nameAr: r.nameAr, close: r.close, changePct: r.changePct, valueTradedEgpMn: Math.round(r.valueTraded / 1e6) };
      });
    },
  },
  {
    name: "quote",
    desc: "Full live quote + fundamentals for ONE stock. arg: { ticker } (EGX ticker like COMI, HDBK, TMGH, ABUK).",
    run: async (args) => {
      const t = cleanTicker(args.ticker);
      if (!t) return { error: "ticker required" };
      const stocks = await fetchUniverse();
      const s = stocks.find((x) => x.ticker === t);
      if (!s) return { error: `unknown ticker ${t}` };
      return compactQuote(s);
    },
  },
  {
    name: "screen",
    desc: "Rank the whole universe by a metric. metrics: pe | pb | divYield | roe | marketCap | changePct | perfYTD | perfY | volume | revenueTTM | netMarginTTM. arg: { metric, direction: top|bottom, limit<=15 }.",
    run: async (args) => {
      const metric = String(args.metric ?? "marketCap");
      const direction = args.direction === "bottom" ? "bottom" : "top";
      const limit = clampLimit(args.limit, 15, 10);
      const stocks = await fetchUniverse();
      const key = (s: Stock): number | null => {
        switch (metric) {
          case "pe": return s.pe;
          case "pb": return s.pb;
          case "divYield": return s.divYield;
          case "roe": return s.roe;
          case "changePct": return s.changePct;
          case "perfYTD": return s.perfYTD;
          case "perfY": return s.perfY;
          case "volume": return s.volume;
          case "revenueTTM": return s.revenueTTM;
          case "netMarginTTM": return s.netMarginTTM;
          default: return s.marketCap;
        }
      };
      const rows = stocks
        .map((s) => ({ s, v: key(s) }))
        .filter((r) => r.v !== null && Number.isFinite(r.v))
        .sort((a, b) => (direction === "top" ? (b.v as number) - (a.v as number) : (a.v as number) - (b.v as number)))
        .slice(0, limit);
      return {
        metric,
        direction,
        rows: rows.map(({ s, v }) => {
          const r = companyRow(s);
          return { ticker: r.ticker, nameAr: r.nameAr, [metric]: v, close: r.close, changePct: r.changePct, marketCap: r.marketCap, pe: r.pe, divYield: r.divYield };
        }),
      };
    },
  },
  {
    name: "technicals",
    desc: "13-indicator technical rating (SMA/EMA/RSI/Stoch/MACD/CCI/Momentum/WilliamsR/BBPower, 1Y daily candles) for ONE stock. arg: { ticker }.",
    run: async (args) => {
      const t = cleanTicker(args.ticker);
      if (!t) return { error: "ticker required" };
      const row = await signalForTicker(t);
      if (!row) return { error: `no technical data for ${t}` };
      return compactSignal(row);
    },
  },
  {
    name: "best_signals",
    desc: "The Signals tab scan: strongest bullish (or bearish) technical ratings across ALL stocks. arg: { direction: top|bottom, limit<=10 }.",
    run: async (args) => {
      const direction = args.direction === "bottom" ? "bottom" : "top";
      const limit = clampLimit(args.limit, 10, 5);
      const scan = await scanSignals();
      const rows = direction === "top" ? scan.rows.slice(0, limit) : scan.rows.slice(-limit).reverse();
      return { asOf: scan.asOf, scanned: scan.scanned, direction, rows: rows.map(compactSignal) };
    },
  },
  {
    name: "statements",
    desc: "Financial statements history for ONE stock (annual + quarterly income statement, balance sheet and cash flow, EGP millions). arg: { ticker }.",
    run: async (args) => {
      const t = cleanTicker(args.ticker);
      if (!t) return { error: "ticker required" };
      const data = (await fetchStatements(t)) as StatementsData;
      if (!data.hasData) return { error: `no published statements for ${t}` };
      const pick = (tbl: { periods: string[]; lines: { label: string; values: (number | null)[] }[] } | null) => {
        if (!tbl) return null;
        const wanted = /revenue|net income|operating income|total assets|total equity|free cash flow|net cash/i;
        const lines = tbl.lines.filter((l) => wanted.test(l.label)).slice(0, 6)
          .map((l) => ({ label: l.label, values: l.values }));
        return { periods: tbl.periods, lines };
      };
      return {
        ticker: t,
        annual: { income: pick(data.annual.income), balance: pick(data.annual.balance), cashflow: pick(data.annual.cashflow) },
        quarterly: { income: pick(data.quarterly.income) },
        scale: "EGP millions",
      };
    },
  },
  {
    name: "dividends",
    desc: "Cash dividend history for ONE stock: ex/record/pay dates and EGP per share. arg: { ticker }.",
    run: async (args) => {
      const t = cleanTicker(args.ticker);
      if (!t) return { error: "ticker required" };
      const data = await fetchDividends(t);
      return {
        ticker: t,
        count: data.rows.length,
        rows: data.rows.slice(0, 12).map((r) => ({ exDate: r.exDate, payDate: r.payDate, amountEgp: r.amount })),
      };
    },
  },
  {
    name: "news",
    desc: "EGX news. feed = ar (Arabic archive, default) | en (English feed). Optional arg: { ticker } filters to one company; { limit<=10 }.",
    run: async (args) => {
      const feed = args.feed === "en" ? "en" : "ar";
      const limit = clampLimit(args.limit, 10, 6);
      const t = cleanTicker(args.ticker);
      if (feed === "en") {
        const data = await fetchNewsEn();
        let items = data.items;
        if (t) {
          const stocks = await fetchUniverse();
          const s = stocks.find((x) => x.ticker === t);
          if (s) {
            const needle = `${s.name} ${t}`.toLowerCase();
            items = items.filter((n) => n.title.toLowerCase().includes(t.toLowerCase()) || n.title.toLowerCase().includes(s.name.toLowerCase()));
            void needle;
          }
        }
        return { feed: "en", count: items.length, items: items.slice(0, limit).map((n) => ({ title: n.title, source: n.source, publishedAt: n.publishedAt, link: n.link })) };
      }
      if (t) {
        const stocks = await fetchUniverse();
        const s = stocks.find((x) => x.ticker === t);
        if (!s) return { error: `unknown ticker ${t}` };
        const r = companyRow(s);
        const items = await relatedNewsArchive(t, r.name, limit);
        return { feed: "ar", ticker: t, items: items.map((n) => ({ title: n.title, source: n.source, publishedAt: n.publishedAt })) };
      }
      const { items } = await queryNews(0, limit);
      return { feed: "ar", items: items.map((n) => ({ title: n.title, source: n.source, publishedAt: n.publishedAt })) };
    },
  },
  {
    name: "calendar",
    desc: "Upcoming EGX events (earnings, dividends, assemblies, rights issues) for the next N days (default 14, max 60). arg: { days }.",
    run: async (args) => {
      const days = clampLimit(args.days, 60, 14);
      const data = await fetchCalendar();
      const today = data.asOf;
      const until = new Date(`${today}T00:00:00Z`);
      until.setUTCDate(until.getUTCDate() + days);
      const untilStr = until.toISOString().slice(0, 10);
      const events = data.events
        .filter((e: CalendarEvent) => e.date >= today && e.date <= untilStr)
        .slice(0, 40)
        .map((e) => ({ date: e.date, type: e.type, ticker: e.ticker, labelAr: e.labelAr, estimated: e.estimated ?? false, amountEgp: e.amount ?? null }));
      return { from: today, to: untilStr, count: events.length, events };
    },
  },
  {
    name: "rates",
    desc: "Egypt interest rates: CBE policy rate, overnight lending, interbank + the next scheduled CBE decision date.",
    run: async () => {
      const data = await fetchRates();
      return {
        rows: data.rows.map((r) => ({ key: r.key, valuePct: r.value, meaningAr: r.meaningAr, reference: r.reference })),
        nextDecision: data.nextDecision,
      };
    },
  },
  {
    name: "insiders",
    desc: "Insider & treasury-share dealing log (official EGX filings). Optional arg: { ticker }; { limit<=10 }.",
    run: async (args) => {
      const t = cleanTicker(args.ticker);
      const limit = clampLimit(args.limit, 10, 6);
      const payload = insidersRaw as unknown as {
        asOf: string;
        summary: { totalRecords: number; buyCount: number; sellCount: number; latestSession: string };
        items: { date: string; ticker: string; companyAr: string; actionLabelAr: string; actionLabel: string; shares: number | null; link: string }[];
      };
      const items = (t ? payload.items.filter((i) => i.ticker === t) : payload.items).slice(0, limit);
      return {
        asOf: payload.asOf,
        summary: payload.summary,
        items: items.map((i) => ({ date: i.date, ticker: i.ticker, companyAr: i.companyAr, action: i.actionLabelAr || i.actionLabel, shares: i.shares, link: i.link })),
      };
    },
  },
  {
    name: "compare",
    desc: "Side-by-side key metrics for 2-4 stocks. arg: { tickers: [\"COMI\",\"HDBK\"] }.",
    run: async (args) => {
      const raw = Array.isArray(args.tickers) ? args.tickers : [];
      const tickers = raw.map(cleanTicker).filter(Boolean).slice(0, 4);
      if (tickers.length < 2) return { error: "provide 2-4 tickers" };
      const stocks = await fetchUniverse();
      const found = tickers
        .map((t) => stocks.find((s) => s.ticker === t))
        .filter((s): s is Stock => s !== undefined);
      if (found.length < 2) return { error: "not enough known tickers" };
      return found.map(compactQuote);
    },
  },
];

const TOOL_LIST = TOOLS.map((t) => `- ${t.name}: ${t.desc}`).join("\n");

// ── system prompt ──

function systemPrompt(lang: "ar" | "en"): string {
  return `You are EGX Desk Agent — a REAL large language model (GLM, by Z.ai) running server-side inside the EGX Desk web app, acting as a bilingual (Arabic-first) Egyptian Exchange (EGX) market analyst. You are not a script or a keyword bot: you reason over evidence and write your own analysis. Every market number you state comes from tools that return real delayed (~15 min) data.

TOOLS (call at most one per reply, as strict JSON):
${TOOL_LIST}

REPLY PROTOCOL — your every reply MUST be exactly ONE JSON object and nothing else (no markdown fences, no commentary):
1. To call a tool: {"tool": "<name>", "args": { ... }}
2. To give your final answer (only once you have enough real data): {"final": "<markdown answer>"}

RULES:
- Answer language: ${lang === "ar" ? "Arabic (clear Egyptian-friendly MSA)" : "English"}. If the user writes in the other language, switch to theirs.
- NEVER invent or estimate market numbers. Every figure in your final answer must come from tool results. If data is missing, say so plainly.
- EGX tickers look like COMI, HDBK, TMGH, ABUK, ETEL, SWDY, EFIH. If unsure of a ticker, use screen/top_movers or state the ambiguity.
- Call tools to fetch facts BEFORE answering market questions; 2-4 calls is usually enough; hard cap 6.
- Final answers are YOUR analysis in a natural analyst voice: start with a one-line direct answer, then the reasoning. Match length to the question — a quick quote needs 2-3 lines; a comparison, market read or strategy question deserves 150-450 words with concrete numbers and tickers. Vary the structure; never end every answer with the same closing formula. Mention the ~15-min delay only when you interpret live market moves.
- General finance and investing-concept questions (what P/E means, how a rights issue works, what drives the EGP) may be answered directly from your own knowledge — just keep concept explanations clearly separate from live EGX data, and never attach made-up numbers to specific tickers.
- Identity questions ("are you a real AI?", "what model are you?"): answer plainly and honestly — you are a real LLM (GLM, by Z.ai) with live EGX data tools. Mention that you reason and can be verified by asking anything.
- For questions outside finance or about personal financial advice, politely decline and redirect to what you can do.`;
}

// ── the agent loop ──

const MAX_TOOL_CALLS = 7;

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "rate limited — try again later" }, { status: 429 });
  }

  // validate the conversation the client sends (last 12 turns, last is user)
  let body: { messages?: unknown; lang?: unknown; debug?: unknown };
  try {
    body = (await req.json()) as { messages?: unknown; lang?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const lang = body.lang === "en" ? "en" : "ar";
  const rawMsgs = Array.isArray(body.messages) ? body.messages : [];
  const history: ChatMsg[] = rawMsgs
    .filter(
      (m): m is ChatMsg =>
        m !== null &&
        typeof m === "object" &&
        ((m as ChatMsg).role === "user" || (m as ChatMsg).role === "assistant") &&
        typeof (m as ChatMsg).content === "string" &&
        (m as ChatMsg).content.length > 0 &&
        (m as ChatMsg).content.length <= 4000
    )
    .slice(-12);
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "messages required (last must be user)" }, { status: 400 });
  }

  const zai = await getZai();
  const msgs: { role: "user" | "assistant"; content: string }[] = [
    { role: "assistant", content: systemPrompt(lang) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];
  const steps: AgentStep[] = [];
  let corrections = 0;
  const debugRaw: string[] = [];
  const debug = body.debug === true;

  for (let round = 0; round < MAX_TOOL_CALLS + 3; round++) {
    if (steps.length >= MAX_TOOL_CALLS) break;
    let raw = "";
    try {
      // reasoning depth: round 0 (fast JSON tool-picking or a quick
      // conversational reply) runs with thinking off; every later round —
      // i.e. once real tool data is on the table, the synthesis moment — runs
      // with chain-of-thought ON so the final answer is genuine reasoning,
      // not a shallow template.
      const deep = round > 0;
      const completion = await zai.chat.completions.create({
        messages: msgs,
        thinking: { type: deep ? "enabled" : "disabled" },
      });
      raw = completion.choices[0]?.message?.content ?? "";
    } catch (err) {
      return NextResponse.json(
        { error: "model unavailable", detail: err instanceof Error ? err.message : "unknown" },
        { status: 502 }
      );
    }
    if (debug) debugRaw.push(raw.slice(0, 800));

    const parsed = extractJson(raw);
    if (!parsed || (!("tool" in parsed) && !("final" in parsed))) {
      corrections++;
      if (corrections > 2) break;
      msgs.push({
        role: "user",
        content:
          'Format error. Reply with exactly ONE JSON object, no fences: {"tool": "<name>", "args": {...}} to call a tool, or {"final": "<markdown answer>"} to answer.',
      });
      continue;
    }

    if (typeof parsed.final === "string" && parsed.final.trim().length > 0) {
      return NextResponse.json(
        { answer: parsed.final.trim(), steps, model: "GLM", disclaimer: true, ...(debug ? { debugRaw } : {}) },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const toolName = typeof parsed.tool === "string" ? parsed.tool : "";
    const tool = TOOLS.find((t) => t.name === toolName);
    if (!tool) {
      msgs.push({
        role: "user",
        content: `Unknown tool "${toolName}". Available tools: ${TOOLS.map((t) => t.name).join(", ")}.`,
      });
      continue;
    }

    const args = (parsed.args && typeof parsed.args === "object" ? parsed.args : {}) as Record<string, unknown>;
    let result: unknown;
    try {
      result = await tool.run(args);
    } catch (err) {
      result = { error: err instanceof Error ? err.message : "tool failed" };
    }
    const ok = !(result && typeof result === "object" && "error" in (result as Record<string, unknown>));
    steps.push({ tool: toolName, args, ok });

    msgs.push({ role: "user", content: JSON.stringify(result).slice(0, 6000) });
  }

  // loop exhausted without a final answer — honest fallback, never invented
  const fallback =
    lang === "ar"
      ? "وصلتُ لحد الأدوات المتاحة دون إجابة كاملة. جرّب إعادة السؤال بصيغة أبسط (مثال: «ما حالة السوق الآن؟» أو «quote لسهم COMI»)."
      : "I ran out of tool budget without a complete answer. Try rephrasing (e.g. \"market overview\" or \"quote for COMI\").";
  return NextResponse.json(
    { answer: fallback, steps, model: "GLM", disclaimer: true, ...(debug ? { debugRaw } : {}) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
