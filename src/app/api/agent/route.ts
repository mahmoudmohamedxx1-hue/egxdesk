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
import { db } from "@/lib/db";

/** POST /api/agent — the in-app EGX analyst agent (inspired by the tool-loop
 *  pattern of open-source agent frameworks like shubhamsaboo/awesome-llm-apps
 *  and the agent-skills repos): an LLM with STRICT-JSON tool calling over our
 *  own live data layer — quotes, screening, technicals, statements, dividends,
 *  news, calendar, rates, insider filings, flows, the AI signals set. The loop
 *  runs server-side (z-ai-web-dev-sdk never reaches the client), max ~10 tool
 *  calls per question, then the model writes the final markdown answer.
 *  Gateway 429s are retried with backoff; every request is metered in
 *  UsageEvent.
 *
 *  Honesty by design: tools return only real (delayed ~15-min) data; the
 *  system prompt forbids invented numbers; the response carries a fixed
 *  disclaimer that the client always renders. */

export const runtime = "nodejs";

// ── rate limiting + usage metering (per IP or device, persisted in SQLite) ──
// 60 agent questions/hour protects a personal tool from floods; since Task 19
// the counter lives in the UsageEvent table, so it survives restarts (the old
// in-memory map reset on every deploy). The upstream LLM gateway ALSO
// throttles bursts (~9-10 calls / ~90-120s window → 429) — those are retried
// with backoff below, and every request is metered for /api/usage.

const RATE_LIMIT = 60; // agent requests per hour, per IP or deviceId

const rateMap = new Map<string, number[]>();

function rateLimitedMemory(ip: string): boolean {
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

async function overLimit(ip: string, deviceId: string | null): Promise<boolean> {
  try {
    const since = new Date(Date.now() - 60 * 60_000);
    const count = await db.usageEvent.count({
      where: { createdAt: { gte: since }, OR: [{ ip }, ...(deviceId ? [{ deviceId }] : [])] },
    });
    return count >= RATE_LIMIT;
  } catch {
    return rateLimitedMemory(ip); // SQLite unreachable → in-memory fallback
  }
}

// ── platform 429 handling: a mid-loop throttle must not kill a question ──

const RETRY_BACKOFF_MS = [12_000, 25_000];
const RETRY_BUDGET_MS = 70_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isThrottleError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("429") || /too many requests/i.test(msg);
}

// ── streaming chat (Task 20: the answer streams live over SSE) ──

type DeltaFn = (text: string) => void;

/** Consume the gateway's SSE chat stream (data: lines with
 *  choices[0].delta.content chunks), accumulating the full text. */
async function consumeSse(body: ReadableStream<Uint8Array>, onDelta?: DeltaFn): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload) as {
          choices?: { delta?: { content?: unknown }; message?: { content?: unknown } }[];
        };
        const piece = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content;
        if (typeof piece === "string" && piece.length > 0) {
          out += piece;
          onDelta?.(piece);
        }
      } catch {
        /* partial line / keepalive — the next chunk completes it */
      }
    }
  }
  return out;
}

/** One LLM round with streaming + the same 429 backoff as before. Falls back
 *  gracefully if the gateway ignores stream:true (returns a plain object). */
async function createChatStream(
  zai: Zai,
  opts: { messages: { role: "user" | "assistant"; content: string }[]; thinking: "enabled" | "disabled" },
  retry: { budgetLeft: number },
  onDelta?: DeltaFn,
  onStatus?: (note: string) => void
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await zai.chat.completions.create({
        messages: opts.messages,
        thinking: { type: opts.thinking },
        stream: true,
      });
      // the SDK hands back the raw SSE body when the gateway streams
      if (res && typeof (res as { getReader?: unknown }).getReader === "function") {
        return await consumeSse(res as ReadableStream<Uint8Array>, onDelta);
      }
      // non-streaming shape — still surface the text for the live preview
      const c = res as { choices?: { message?: { content?: string } }[] };
      const text = c.choices?.[0]?.message?.content ?? "";
      if (text) onDelta?.(text);
      return text;
    } catch (err) {
      const wait = RETRY_BACKOFF_MS[attempt];
      if (isThrottleError(err) && wait !== undefined && retry.budgetLeft >= wait) {
        retry.budgetLeft -= wait;
        onStatus?.(attempt === 0 ? "provider busy — retrying" : "provider busy — retrying again");
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
}

/** Decode the escaped JSON string body of raw (stops at the closing quote or
 *  an incomplete escape at the buffer tail). */
function decodeJsonStringPrefix(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "\\") {
      const n = raw[i + 1];
      if (n === undefined) return out; // incomplete escape — wait for more
      if (n === "n") { out += "\n"; i++; continue; }
      if (n === "t") { out += "\t"; i++; continue; }
      if (n === "r") { out += "\r"; i++; continue; }
      if (n === "b") { out += "\b"; i++; continue; }
      if (n === "f") { out += "\f"; i++; continue; }
      if (n === '"') { out += '"'; i++; continue; }
      if (n === "\\") { out += "\\"; i++; continue; }
      if (n === "/") { out += "/"; i++; continue; }
      if (n === "u") {
        const hex = raw.slice(i + 2, i + 6);
        if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) return out;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 5;
        continue;
      }
      out += n;
      i++;
      continue;
    }
    if (c === '"') return out; // closing quote — the final string ends here
    out += c;
  }
  return out;
}

/** Live-preview extractor: watches the raw stream text and, once the
 *  `{"final": "` opening quote appears, streams the decoded answer body out
 *  as delta events. Tool-call rounds never contain `"final":`, so they never
 *  preview; thinking prose is skipped too. The authoritative answer is still
 *  the parsed `done` event — the preview is cosmetic and transient. */
function makeFinalPreviewer(onDelta: (s: string) => void) {
  let acc = "";
  let locked: number | null = null;
  let sent = 0;
  return (chunk: string) => {
    acc += chunk;
    if (acc.length > 300_000) return; // pathological stream — stop tracking
    if (locked === null) {
      const m = acc.match(/"\s*final\s*"\s*:\s*"/);
      if (!m || m.index === undefined) return;
      locked = m.index + m[0].length;
    }
    const decoded = decodeJsonStringPrefix(acc.slice(locked));
    if (decoded.length > sent) {
      onDelta(decoded.slice(sent));
      sent = decoded.length;
    }
  };
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
            items = items.filter((n) => n.title.toLowerCase().includes(t.toLowerCase()) || n.title.toLowerCase().includes(s.name.toLowerCase()));
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
    desc: "Side-by-side key metrics for 2-4 stocks in ONE call — pass ALL tickers together, never one per call. arg: { tickers: [\"COMI\",\"HDBK\"] }.",
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
  {
    name: "web_search",
    desc: "Search the LIVE WEB for current events and context beyond our EGX data layer — Egypt macro/economy news, IMF & ratings, CBE decisions, global markets, oil/gold, company announcements. arg: { query, num?<=8 (default 5), recency_days?<=90 }.",
    run: async (args) => {
      const query = typeof args.query === "string" ? args.query.trim().slice(0, 300) : "";
      if (!query) return { error: "query required" };
      const num = clampLimit(args.num, 8, 5);
      const recencyRaw = Number(args.recency_days);
      const recency = Number.isFinite(recencyRaw) && recencyRaw > 0 ? Math.min(Math.floor(recencyRaw), 90) : undefined;
      try {
        const zai = await getZai();
        const invoke = () =>
          zai.functions.invoke("web_search", {
            query,
            num,
            ...(recency ? { recency_days: recency } : {}),
          });
        let results: unknown;
        try {
          results = await invoke();
        } catch (err) {
          if (!isThrottleError(err)) throw err;
          await sleep(8_000); // one patient retry on gateway 429s
          results = await invoke();
        }
        type SearchItem = { url?: unknown; name?: unknown; snippet?: unknown; host_name?: unknown; date?: unknown };
        const items = (Array.isArray(results) ? (results as SearchItem[]) : [])
          .slice(0, num)
          .map((r) => ({
            title: typeof r?.name === "string" ? r.name.slice(0, 200) : "",
            source: typeof r?.host_name === "string" ? r.host_name : "",
            url: typeof r?.url === "string" ? r.url.slice(0, 400) : "",
            snippet: typeof r?.snippet === "string" ? r.snippet.slice(0, 500) : "",
            date: typeof r?.date === "string" ? r.date : "",
          }));
        if (items.length === 0) return { error: "no results — try a different query" };
        return { query, count: items.length, items };
      } catch {
        return { error: "web search unavailable" };
      }
    },
  },
  {
    name: "ai_signals",
    desc: "The AI Signals section's current shared signal set (back-tested trend strategy + GLM synthesis, refreshed ~every 45 minutes): the strategy's market read plus trade ideas with entry/stop/target and evidence. No args — read-only, may be slightly older than live quotes.",
    run: async () => {
      const { getLatestAiSignals } = await import("@/lib/ai-signals");
      const set = await getLatestAiSignals();
      if (!set) return { status: "warming — no AI signal set generated yet, try again later" };
      return {
        generatedAt: set.generatedAt,
        marketBias: set.marketBias,
        picks: set.picks.map((p) => ({
          ticker: p.ticker,
          nameAr: p.nameAr,
          stance: p.stance,
          conviction: p.conviction,
          charterScore: p.charterScore,
          close: p.close,
          entry: p.entry,
          stop: p.stop,
          target: p.target,
          horizonSessions: p.horizonSessions,
          riskLevel: p.riskLevel,
          evidence: p.evidence.slice(0, 5),
        })),
        notesAr: set.notesAr,
      };
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
- NEVER invent or estimate market numbers. Every EGX figure in your final answer must come from our data tools; every web fact must come from web_search results. If data is missing, say so plainly.
- EGX tickers look like COMI, HDBK, TMGH, ABUK, ETEL, SWDY, EFIH. If unsure of a ticker, use screen/top_movers or state the ambiguity.
- Call tools to fetch facts BEFORE answering market questions; 2-5 calls is typical; hard cap 10.
- ANSWER LENGTH — NO CAP: answer as fully as the question deserves. A quick quote can be 2-3 lines, but comparisons, market reads, strategy, macro and research questions deserve COMPLETE, well-structured essays (commonly 400-1500+ words): a direct answer first, then structured sections with headers or bullets, tables when comparing, concrete numbers, tickers and dates. Never cut an answer short to stay brief — finish every argument you start.
- WEB SEARCH: for anything beyond our live EGX data layer (Egypt macro news, IMF/World Bank/ratings agencies, CBE decisions, global markets, oil/gold/FX, company announcements, general knowledge you are unsure about), call web_search — ideally BEFORE answering, and combine it with our EGX tools for market questions. ALWAYS attribute web facts to their source by name (e.g. "وفق رويترز" / "per Reuters") and include the article date when relevant. Never present web-sourced numbers as EGX live quotes — EGX prices/valuations come ONLY from our data tools.
- Final answers are YOUR analysis in a natural analyst voice: vary the structure, never end every answer with the same closing formula. Mention the ~15-min delay only when you interpret live market moves.
- General finance and investing-concept questions (what P/E means, how a rights issue works, what drives the EGP) may be answered directly from your own knowledge or web_search — just keep concept explanations clearly separate from live EGX data.
- Identity questions ("are you a real AI?", "what model are you?"): answer plainly and honestly — you are a real LLM (GLM, by Z.ai) with live EGX data tools AND live web search. Mention that you reason and can be verified by asking anything.
- For questions entirely outside finance or about personal financial advice, politely decline and redirect to what you can do.`;
}

// ── the agent loop (Task 20: streamed over SSE) ──

const MAX_TOOL_CALLS = 10;

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";

  let body: { messages?: unknown; lang?: unknown; debug?: unknown; deviceId?: unknown };
  try {
    body = (await req.json()) as { messages?: unknown; lang?: unknown; deviceId?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const deviceId =
    typeof body.deviceId === "string" && body.deviceId.length >= 8 ? body.deviceId.slice(0, 64) : null;

  // persisted hourly limit (per IP or device) — UsageEvent survives restarts
  if (await overLimit(ip, deviceId)) {
    return NextResponse.json({ error: "rate limited — try again later" }, { status: 429 });
  }

  // validate the conversation the client sends (last 24 turns, last is user)
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
        (m as ChatMsg).content.length <= 8000
    )
    .slice(-24);
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

  // usage metering — one UsageEvent row per request, written on completion
  const t0 = Date.now();
  const usage = { llmCalls: 0, webSearches: 0 };
  const retry = { budgetLeft: RETRY_BUDGET_MS };
  const meter = (ok: boolean) => {
    void db.usageEvent
      .create({
        data: {
          ip,
          deviceId,
          route: "agent",
          llmCalls: usage.llmCalls,
          toolCalls: steps.length,
          webSearches: usage.webSearches,
          ok,
          ms: Date.now() - t0,
        },
      })
      .catch(() => {}); // metering must never break a reply
  };

  // ── SSE response: step / status / delta / done / error events ──
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          closed = true; // client disconnected — keep the loop honest
        }
      };
      const done = (answer: string) => {
        send({ type: "done", answer, steps, model: "GLM", disclaimer: true, ...(debug ? { debugRaw } : {}) });
        meter(true);
        closed = true;
        try {
          controller.close();
        } catch {}
      };
      const fail = (message: string, status: number, detail?: string) => {
        send({ type: "error", message, status, ...(detail ? { detail } : {}) });
        meter(false);
        closed = true;
        try {
          controller.close();
        } catch {}
      };

      try {
        for (let round = 0; round < MAX_TOOL_CALLS + 3; round++) {
          if (steps.length >= MAX_TOOL_CALLS) break;
          let raw = "";
          try {
            // reasoning depth: round 0 (fast JSON tool-picking or a quick
            // conversational reply) runs with thinking off; every later round —
            // i.e. once real tool data is on the table, the synthesis moment —
            // runs with chain-of-thought ON so the final answer is genuine
            // reasoning, not a shallow template.
            const deep = round > 0;
            const preview = makeFinalPreviewer((text) => send({ type: "delta", text }));
            raw = await createChatStream(
              zai,
              { messages: msgs, thinking: deep ? "enabled" : "disabled" },
              retry,
              preview,
              (note) => send({ type: "status", note })
            );
            usage.llmCalls++;
          } catch (err) {
            // gateway 429s retry with backoff inside createChatStream; if
            // throttling persists, answer honestly instead of a bare error
            const throttled = isThrottleError(err);
            return void fail(
              throttled
                ? lang === "ar"
                  ? "خدمة الذكاء الاصطناعي مشغولة مؤقتًا (ضغط على المزود) — جرّب بعد دقيقة"
                  : "The AI service is briefly busy (provider throttling) — please retry in a minute"
                : "model unavailable",
              throttled ? 503 : 502,
              err instanceof Error ? err.message : "unknown"
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
            return void done(parsed.final.trim());
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
          send({ type: "step", tool: toolName, args, ok });
          if (toolName === "web_search" && ok) usage.webSearches++;

          msgs.push({ role: "user", content: JSON.stringify(result).slice(0, 9000) });
        }

        // loop exhausted without a final answer — NEVER waste the collected
        // data: force one synthesis round from the tool results in context
        if (steps.length > 0) {
          msgs.push({
            role: "user",
            content:
              'Tool budget exhausted. Reply NOW with your final answer using ONLY the tool data collected above — do not request more tools; if a requested stock was not found, say so plainly. Format: {"final": "<markdown answer>"}',
          });
          try {
            const preview = makeFinalPreviewer((text) => send({ type: "delta", text }));
            const raw = await createChatStream(
              zai,
              { messages: msgs, thinking: "enabled" },
              retry,
              preview,
              (note) => send({ type: "status", note })
            );
            usage.llmCalls++;
            if (debug) debugRaw.push(raw.slice(0, 800));
            const parsed = extractJson(raw);
            if (parsed && typeof parsed.final === "string" && parsed.final.trim().length > 0) {
              return void done(parsed.final.trim());
            }
          } catch {
            // fall through to the honest fallback below
          }
        }

        // no tools ever ran / synthesis also failed — honest fallback, never invented
        const fallback =
          lang === "ar"
            ? "وصلتُ لحد الأدوات المتاحة دون إجابة كاملة. جرّب إعادة السؤال بصيغة أبسط (مثال: «ما حالة السوق الآن؟» أو «quote لسهم COMI»)."
            : "I ran out of tool budget without a complete answer. Try rephrasing (e.g. \"market overview\" or \"quote for COMI\").";
        return void done(fallback);
      } catch (err) {
        return void fail("agent loop error", 500, err instanceof Error ? err.message : "unknown");
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
