/** The AGENT TOOL CORE — the server-side execution layer shared by
 *  /api/agent (the SSE loop) and /api/agent/tools (single executions the
 *  CLIENT-side Puter loop calls, T33). Every tool returns compact REAL
 *  (delayed ~15 min) data — never invented numbers.
 *
 *  The tool NAMES + DESCRIPTIONS live in the client-safe
 *  src/lib/agent-protocol.ts (AGENT_TOOL_SPECS); this module binds each
 *  spec to its server runner, so the two lists can never drift apart. */

import ZAI from "z-ai-web-dev-sdk";

import { fetchUniverse, fetchIndices, companyRow, sectorRows, type Stock } from "@/lib/market";
import { scanSignals, signalForTicker, reblendNews, type SignalRow } from "@/lib/signals-scan";
import { fetchStatements, type StatementsData } from "@/lib/statements";
import { fetchDividends } from "@/lib/dividends";
import { fetchCalendar, type CalendarEvent } from "@/lib/events";
import { fetchRates } from "@/lib/rates";
import { queryNews, relatedNewsArchive } from "@/lib/news-archive";
import { fetchNewsEn } from "@/lib/news-en";
import { fetchFlows } from "@/lib/flows";
import { marketNarrative } from "@/lib/narrative";
import insidersRaw from "@/data/insiders.json";
import { cleanTicker, clampLimit, AGENT_TOOL_SPECS } from "@/lib/agent-protocol";

export type AgentTool = {
  name: string;
  desc: string;
  run: (args: Record<string, unknown>) => Promise<unknown>;
};

export const isThrottleError = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("429") || /too many requests/i.test(msg);
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Zai = Awaited<ReturnType<typeof ZAI.create>>;

let zaiPromise: Promise<Zai> | null = null;

export function getZai(): Promise<Zai> {
  if (!zaiPromise) zaiPromise = ZAI.create();
  return zaiPromise;
}

// ── compaction helpers (real data, trimmed for the model context) ──

export function compactQuote(s: Stock) {
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

export function compactSignal(r: SignalRow) {
  return {
    ticker: r.ticker,
    nameAr: r.nameAr,
    // the composite three-pillar rating (T32): what the Signals tab ranks by
    composite: r.composite,
    compositeRating: r.compositeRating,
    rating: r.rating,
    score: r.score,
    fundScore: r.fundScore,
    fundRating: r.fundRating,
    newsScore: r.newsScore,
    newsCount: r.newsCount,
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

// ── the runners (one per AGENT_TOOL_SPECS entry, same order) ──

const RUNNERS: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  market_overview: async () => {
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

  top_movers: async (args) => {
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

  quote: async (args) => {
    const t = cleanTicker(args.ticker);
    if (!t) return { error: "ticker required" };
    const stocks = await fetchUniverse();
    const s = stocks.find((x) => x.ticker === t);
    if (!s) return { error: `unknown ticker ${t}` };
    return compactQuote(s);
  },

  screen: async (args) => {
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

  technicals: async (args) => {
    const t = cleanTicker(args.ticker);
    if (!t) return { error: "ticker required" };
    const row = await signalForTicker(t);
    if (!row) return { error: `no technical data for ${t}` };
    return compactSignal(row);
  },

  best_signals: async (args) => {
    const direction = args.direction === "bottom" ? "bottom" : "top";
    const limit = clampLimit(args.limit, 10, 5);
    const [scan, universe] = await Promise.all([scanSignals(), fetchUniverse()]);
    // serve-time news re-blend — the press pillar stays ≤10-min fresh even
    // while technicals/fundamentals ride the hourly scan cache
    const rows = await reblendNews(scan.rows, universe);
    const picked = direction === "top" ? rows.slice(0, limit) : rows.slice(-limit).reverse();
    return { asOf: scan.asOf, scanned: scan.scanned, direction, rows: picked.map(compactSignal) };
  },

  statements: async (args) => {
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

  dividends: async (args) => {
    const t = cleanTicker(args.ticker);
    if (!t) return { error: "ticker required" };
    const data = await fetchDividends(t);
    return {
      ticker: t,
      count: data.rows.length,
      rows: data.rows.slice(0, 12).map((r) => ({ exDate: r.exDate, payDate: r.payDate, amountEgp: r.amount })),
    };
  },

  news: async (args) => {
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

  calendar: async (args) => {
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

  rates: async () => {
    const data = await fetchRates();
    return {
      rows: data.rows.map((r) => ({ key: r.key, valuePct: r.value, meaningAr: r.meaningAr, reference: r.reference })),
      nextDecision: data.nextDecision,
    };
  },

  insiders: async (args) => {
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

  compare: async (args) => {
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

  web_search: async (args) => {
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

  ai_signals: async () => {
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

  desk_reports: async () => {
    const { getLatestReport } = await import("@/lib/hourly-report");
    const r = await getLatestReport();
    if (!r) return { status: "warming — no desk report generated yet, try again later" };
    return {
      generatedAt: r.generatedAt,
      kind: r.kind,
      hourLabel: r.hourLabel,
      session: r.session,
      marketBias: r.marketBias,
      movers: r.movers.map((m) => ({
        ticker: m.ticker,
        nameAr: m.nameAr,
        surgePotential: m.surgePotential,
        conviction: m.conviction,
        charterScore: m.charterScore,
        close: m.close,
        changePct: m.changePct,
        entry: m.entry,
        stop: m.stop,
        target: m.target,
        reasonsAr: m.reasonsAr.slice(0, 3),
        reasonsEn: m.reasonsEn.slice(0, 3),
        catalysts: m.catalysts.slice(0, 2),
      })),
      webNotesAr: r.webNotesAr,
      webNotesEn: r.webNotesEn,
    };
  },
};

/** The full tool registry — specs from agent-protocol, runs bound here. */
export const AGENT_TOOLS: AgentTool[] = AGENT_TOOL_SPECS.map((spec) => ({
  ...spec,
  run: RUNNERS[spec.name] ?? (async () => ({ error: "tool runner missing" })),
}));

/** Execute ONE agent tool by name (used by /api/agent and by
 *  /api/agent/tools for the client-side Puter loop). */
export async function runAgentTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const tool = AGENT_TOOLS.find((t) => t.name === name);
  if (!tool) {
    return {
      error: `unknown tool "${name}"`,
      available: AGENT_TOOLS.map((t) => t.name),
    };
  }
  try {
    return await tool.run(args);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "tool failed" };
  }
}
