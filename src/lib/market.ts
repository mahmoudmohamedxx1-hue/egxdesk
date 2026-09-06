/** Server-side live data layer — all figures come from public, reachable
 *  sources (no mock data anywhere):
 *    - stock quotes & fundamentals: TradingView public screener API (EGX universe, ~15 min delayed)
 *    - index quotes (EGX30 / EGX70 EWI / EGX100 EWI): TradingView global scanner
 *    - news: Alborsaanews & Amwal Alghad RSS feeds
 *  Everything is cached in memory with a TTL so the app never hammers upstreams.
 */

import { XMLParser } from "fast-xml-parser";
import { marketStatus } from "./market-status";

// ──────────────────────────────────────────────────────────── types ───

export type Stock = {
  ticker: string;
  name: string;
  sector: string; // TradingView sector key (English)
  industry: string | null;
  close: number;
  changePct: number;
  changeAbs: number;
  volume: number;
  /** session value ≈ volume × last price */
  valueTraded: number;
  marketCap: number | null;
  perfW: number | null;
  perf1M: number | null;
  perf3M: number | null;
  perf6M: number | null;
  perfYTD: number | null;
  perfY: number | null;
  perf3Y: number | null;
  perf5Y: number | null;
  pe: number | null;
  eps: number | null;
  divYield: number | null;
  high52: number | null;
  low52: number | null;
  high1M: number | null;
  low1M: number | null;
  avgVolume: number | null; // 10-day average
  avgTurnover30: number | null;
  floatShares: number | null;
  revenueTTM: number | null;
  netMarginTTM: number | null;
  beta: number | null;
  updateMode: string | null;
  // extended fundamentals (TradingView scanner)
  pb: number | null; // price / book (FQ)
  debtToEquity: number | null; // ratio
  roe: number | null; // %
  netIncomeTTM: number | null; // EGP
  payoutRatio: number | null; // 0..1
  grossMarginTTM: number | null; // %
  revenueGrowthQ: number | null; // %
  netDebt: number | null; // EGP
  employees: number | null;
  nextEarnings: number | null; // epoch seconds
};

export type IndexQuote = {
  code: "EGX30" | "EGX70" | "EGX100";
  name: string;
  close: number;
  changePct: number;
  changeAbs: number;
  perf1M: number | null;
  perf6M: number | null;
  perfYTD: number | null;
  perfY: number | null;
  volume: number;
};

export type NewsItem = {
  id: string;
  title: string;
  link: string;
  publishedAt: string; // ISO
  snippet: string | null;
  source: string;
  categories: string[];
};

export type SectorRow = {
  code: string;
  nameEn: string;
  nameAr: string;
  count: number;
  up: number;
  down: number;
  flat: number;
  avgChangePct: number | null; // equal-weighted
  capWeightedChangePct: number | null;
  marketCap: number;
  valueTraded: number;
  pe: number | null; // median
  pb: number | null; // median
  roe: number | null; // median
  divYield: number | null; // median
  biggestMover: { ticker: string; changePct: number } | null;
  topGainer: { ticker: string; changePct: number } | null;
  topLoser: { ticker: string; changePct: number } | null;
  turnoverLeader: { ticker: string; valueTraded: number } | null;
};

// ─────────────────────────────────────────────────────── constants ───

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const STOCK_COLUMNS = [
  "name", "description", "close", "change", "change_abs", "volume",
  "market_cap_basic", "sector", "industry",
  "Perf.W", "Perf.1M", "Perf.3M", "Perf.6M", "Perf.YTD", "Perf.Y", "Perf.3Y", "Perf.5Y",
  "price_earnings_ttm", "earnings_per_share_basic_ttm", "dividend_yield_recent",
  "price_52_week_high", "price_52_week_low", "High.1M", "Low.1M",
  "average_volume_10d_calc", "average_turnover_30d_calc", "float_shares_outstanding",
  "total_revenue_ttm", "net_margin_ttm", "beta_1_year", "update_mode",
  // extended fundamentals (verified populated for EGX on the TV scanner)
  "price_book_fq", "debt_to_equity", "return_on_equity", "net_income_ttm",
  "dividend_payout_ratio_ttm", "gross_margin_ttm", "revenue_growth_quarterly",
  "net_debt", "number_of_employees", "earnings_release_date",
];

const INDEX_TICKERS: { symbol: string; code: IndexQuote["code"] }[] = [
  { symbol: "EGX:EGX30", code: "EGX30" },
  { symbol: "EGX:EGX70EWI", code: "EGX70" },
  { symbol: "EGX:EGX100EWI", code: "EGX100" },
];

const NEWS_FEEDS: { url: string; source: string }[] = [
  { url: "https://www.alborsaanews.com/feed", source: "جريدة البورصة" },
  { url: "https://www.amwalalghad.com/feed", source: "أموال الغد" },
];

/** Arabic labels for the TradingView sector taxonomy (our own translation). */
export const SECTOR_AR: Record<string, string> = {
  "Finance": "البنوك والخدمات المالية",
  "Process Industries": "الصناعات التحويلية والكيماوية",
  "Non-Energy Minerals": "التعدين والمعادن",
  "Consumer Services": "الخدمات الاستهلاكية",
  "Consumer Non-Durables": "السلع الاستهلاكية (أغذية ومشروبات)",
  "Industrial Services": "الخدمات الصناعية",
  "Producer Manufacturing": "الصناعات الإنتاجية والكهربائيات",
  "Distribution Services": "خدمات التوزيع",
  "Health Technology": "الأدوية والتكنولوجيا الصحية",
  "Technology Services": "خدمات التكنولوجيا",
  "Consumer Durables": "السلع الاستهلاكية المعمرة",
  "Health Services": "الخدمات الصحية",
  "Transportation": "النقل والخدمات اللوجستية",
  "Commercial Services": "الخدمات التجارية",
  "Retail Trade": "تجارة التجزئة",
  "Utilities": "المرافق العامة",
  "Communications": "الاتصالات",
  "Energy Minerals": "البترول والغاز",
  "Electronic Technology": "التكنولوجيا الإلكترونية",
  "Miscellaneous": "أنشطة متفرقة",
  "": "غير مصنّف",
};

export function sectorAr(en: string | null | undefined): string {
  return SECTOR_AR[en ?? ""] ?? en ?? "غير مصنّف";
}

export function sectorCode(en: string): string {
  return (en || "unclassified").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

// ─────────────────────────────────────────────────────────── caching ───

type Entry = { data: unknown; at: number };
const cache = new Map<string, Entry>();
const stale = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const flying = inflight.get(key);
  if (flying) return flying as Promise<T>;
  const p = (async () => {
    try {
      const data = await loader();
      cache.set(key, { data, at: Date.now() });
      stale.set(key, { data, at: Date.now() });
      return data;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  try {
    return await p;
  } catch (err) {
    const s = stale.get(key);
    if (s) return s.data as T; // graceful degradation: serve last good data
    throw err;
  }
}

// ───────────────────────────────────────────────────── stock universe ───

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function fetchUniverse(): Promise<Stock[]> {
  return cached("stocks", 60_000, async () => {
    const body = {
      filter: [
        { left: "type", operation: "equal", right: "stock" },
        { left: "subtype", operation: "in_range", right: ["common"] },
      ],
      options: { lang: "en" },
      markets: ["egypt"],
      symbols: { query: { types: [] }, tickers: [] },
      columns: STOCK_COLUMNS,
      sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
      range: [0, 500],
    };
    const res = await fetch("https://scanner.tradingview.com/egypt/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA, Accept: "text/plain" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`scanner ${res.status}`);
    const json = (await res.json()) as { data?: { s: string; d: unknown[] }[] };
    const rows = json.data ?? [];
    return rows
      .map((r): Stock => {
        const d = r.d;
        const close = (n(d[2]) ?? 0) as number;
        const volume = (n(d[5]) ?? 0) as number;
        return {
          ticker: String(r.s).split(":")[1] ?? String(r.s),
          name: String(d[1] ?? d[0] ?? ""),
          sector: typeof d[7] === "string" ? d[7] : "",
          industry: typeof d[8] === "string" ? d[8] : null,
          close,
          changePct: n(d[3]) ?? 0,
          changeAbs: n(d[4]) ?? 0,
          volume,
          valueTraded: close * volume,
          marketCap: n(d[6]),
          perfW: n(d[9]),
          perf1M: n(d[10]),
          perf3M: n(d[11]),
          perf6M: n(d[12]),
          perfYTD: n(d[13]),
          perfY: n(d[14]),
          perf3Y: n(d[15]),
          perf5Y: n(d[16]),
          pe: n(d[17]),
          eps: n(d[18]),
          divYield: n(d[19]),
          high52: n(d[20]),
          low52: n(d[21]),
          high1M: n(d[22]),
          low1M: n(d[23]),
          avgVolume: n(d[24]),
          avgTurnover30: n(d[25]),
          floatShares: n(d[26]),
          revenueTTM: n(d[27]),
          netMarginTTM: n(d[28]),
          beta: n(d[29]),
          updateMode: typeof d[30] === "string" ? d[30] : null,
          pb: n(d[31]),
          debtToEquity: n(d[32]),
          roe: n(d[33]),
          netIncomeTTM: n(d[34]),
          payoutRatio: n(d[35]),
          grossMarginTTM: n(d[36]),
          revenueGrowthQ: n(d[37]),
          netDebt: n(d[38]),
          employees: n(d[39]),
          nextEarnings: n(d[40]),
        };
      })
      .filter((s) => s.ticker && s.close > 0);
  });
}

// ─────────────────────────────────────────────────────────── indices ───

export async function fetchIndices(): Promise<IndexQuote[]> {
  return cached("indices", 60_000, async () => {
    const body = {
      filter: [{ left: "type", operation: "equal", right: "index" }],
      options: { lang: "en" },
      markets: ["egypt"],
      symbols: { query: { types: [] }, tickers: INDEX_TICKERS.map((i) => i.symbol) },
      columns: ["name", "description", "close", "change", "change_abs", "Perf.YTD", "Perf.1M", "Perf.6M", "Perf.Y", "volume"],
      sort: { sortBy: "name", sortOrder: "asc" },
      range: [0, 10],
    };
    const res = await fetch("https://scanner.tradingview.com/global/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA, Accept: "text/plain" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`index scanner ${res.status}`);
    const json = (await res.json()) as { data?: { s: string; d: unknown[] }[] };
    const map = new Map(json.data?.map((r) => [r.s, r.d]) ?? []);
    return INDEX_TICKERS.map(({ symbol, code }) => {
      const d = map.get(symbol);
      if (!d) return null;
      const idx: IndexQuote = {
        code,
        name: String(d[1] ?? d[0] ?? code),
        close: n(d[2]) ?? 0,
        changePct: n(d[3]) ?? 0,
        changeAbs: n(d[4]) ?? 0,
        perfYTD: n(d[5]),
        perf1M: n(d[6]),
        perf6M: n(d[7]),
        perfY: n(d[8]),
        volume: n(d[9]) ?? 0,
      };
      return idx;
    }).filter((x): x is IndexQuote => !!x);
  });
}

// ────────────────────────────────────────────────────────────── news ───

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o["#text"] === "string") return o["#text"];
    if (typeof o["@_href"] === "string") return o["@_href"];
  }
  return "";
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#8211;|&mdash;/g, "—")
    .replace(/&#8212;/g, "—")
    .replace(/&#8216;|&#8217;|&lsquo;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hashId(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function parseFeed(xmlText: string, source: string): NewsItem[] {
  try {
    const doc = xml.parse(xmlText) as Record<string, unknown>;
    const channel = ((doc.rss as Record<string, unknown>)?.channel ?? doc.feed ?? {}) as Record<string, unknown>;
    let items = channel.item ?? channel.entry;
    if (!Array.isArray(items)) items = items ? [items] : [];
    const out: NewsItem[] = [];
    for (const raw of items as Record<string, unknown>[]) {
      const title = stripHtml(textOf(raw.title));
      const link = textOf(raw.link) || textOf(raw.guid);
      const dateStr = textOf(raw.pubDate) || textOf(raw.published) || textOf(raw["dc:date"]);
      const t = dateStr ? new Date(dateStr) : null;
      if (!title || !link || !t || Number.isNaN(t.getTime())) continue;
      const snippetFull = stripHtml(textOf(raw.description) || textOf(raw.summary));
      let cats = raw.category;
      if (!Array.isArray(cats)) cats = cats ? [cats] : [];
      const categories = (cats as unknown[])
        .map((c) => stripHtml(textOf(c)))
        .filter(Boolean)
        .slice(0, 2);
      out.push({
        id: hashId(link),
        title,
        link,
        publishedAt: t.toISOString(),
        snippet: snippetFull ? snippetFull.slice(0, 260) : null,
        source,
        categories,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function fetchNews(): Promise<NewsItem[]> {
  return cached("news", 300_000, async () => {
    const results = await Promise.allSettled(
      NEWS_FEEDS.map(async (f) => {
        const res = await fetch(f.url, {
          headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) throw new Error(`feed ${f.url} ${res.status}`);
        return parseFeed(await res.text(), f.source);
      })
    );
    const items = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    return items.slice(0, 80);
  });
}

/** News items that plausibly mention this company (ticker or leading name words). */
export function relatedNews(stock: Stock, news: NewsItem[], limit = 6): NewsItem[] {
  const tickerRe = new RegExp(`\\b${stock.ticker.replace(/[^A-Z0-9]/gi, "")}\\b`, "i");
  const words = stock.name
    .split(/[^A-Za-z]+/)
    .filter((w) => w.length > 3 && !["Egypt", "Egyptian", "Company", "S.A.E", "Holding", "Limited", "Corporation"].includes(w))
    .slice(0, 2)
    .map((w) => new RegExp(`\\b${w}\\b`, "i"));
  const hit = (s: string) => tickerRe.test(s) || (words.length > 0 && words.every((re) => re.test(s)));
  return news.filter((x) => hit(`${x.title} ${x.snippet ?? ""}`)).slice(0, limit);
}

/** Flat client-facing row for tables, lists and search results. */
export function companyRow(s: Stock) {
  return {
    ticker: s.ticker,
    name: s.name,
    sectorEn: s.sector || "Unclassified",
    sectorAr: sectorAr(s.sector),
    sectorCode: sectorCode(s.sector),
    close: s.close,
    changePct: s.changePct,
    changeAbs: s.changeAbs,
    volume: s.volume,
    valueTraded: s.valueTraded,
    marketCap: s.marketCap,
    pe: s.pe,
    eps: s.eps,
    divYield: s.divYield,
    perfW: s.perfW,
    perf1M: s.perf1M,
    perf3M: s.perf3M,
    perf6M: s.perf6M,
    perfYTD: s.perfYTD,
    perfY: s.perfY,
    perf3Y: s.perf3Y,
    perf5Y: s.perf5Y,
    high52: s.high52,
    low52: s.low52,
    avgVolume: s.avgVolume,
    volumeRatio: s.avgVolume && s.avgVolume > 0 ? s.volume / s.avgVolume : null,
    pb: s.pb,
    debtToEquity: s.debtToEquity,
    roe: s.roe,
    netIncomeTTM: s.netIncomeTTM,
    payoutRatio: s.payoutRatio,
    grossMarginTTM: s.grossMarginTTM,
    revenueGrowthQ: s.revenueGrowthQ,
    netDebt: s.netDebt,
    employees: s.employees,
    nextEarnings: s.nextEarnings,
  };
}

// ─────────────────────────────────────────────── sector aggregation ───

function median(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function sectorRows(stocks: Stock[]): SectorRow[] {
  const bySector = new Map<string, Stock[]>();
  for (const s of stocks) {
    const key = s.sector || "";
    const arr = bySector.get(key) ?? [];
    arr.push(s);
    bySector.set(key, arr);
  }
  const rows: SectorRow[] = [];
  for (const [en, cos] of bySector) {
    const up = cos.filter((c) => c.changePct > 0).length;
    const down = cos.filter((c) => c.changePct < 0).length;
    const withCap = cos.filter((c) => c.marketCap);
    const capTotal = withCap.reduce((a, c) => a + (c.marketCap ?? 0), 0);
    const capWeighted =
      capTotal > 0
        ? withCap.reduce((a, c) => a + (c.changePct * (c.marketCap ?? 0)) / capTotal, 0)
        : null;
    const sortedByMove = [...cos].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
    const gainers = cos.filter((c) => c.changePct > 0).sort((a, b) => b.changePct - a.changePct);
    const losers = cos.filter((c) => c.changePct < 0).sort((a, b) => a.changePct - b.changePct);
    const byTurnover = [...cos].sort((a, b) => b.valueTraded - a.valueTraded);
    rows.push({
      code: sectorCode(en),
      nameEn: en || "Unclassified",
      nameAr: sectorAr(en),
      count: cos.length,
      up,
      down,
      flat: cos.length - up - down,
      avgChangePct: cos.length ? cos.reduce((a, c) => a + c.changePct, 0) / cos.length : null,
      capWeightedChangePct: capWeighted,
      marketCap: capTotal,
      valueTraded: cos.reduce((a, c) => a + c.valueTraded, 0),
      pe: median(cos.map((c) => c.pe).filter((v): v is number => v !== null)),
      pb: median(cos.map((c) => c.pb).filter((v): v is number => v !== null)),
      roe: median(cos.map((c) => c.roe).filter((v): v is number => v !== null)),
      divYield: median(cos.map((c) => c.divYield).filter((v): v is number => v !== null)),
      biggestMover: sortedByMove[0]
        ? { ticker: sortedByMove[0].ticker, changePct: sortedByMove[0].changePct }
        : null,
      topGainer: gainers[0] ? { ticker: gainers[0].ticker, changePct: gainers[0].changePct } : null,
      topLoser: losers[0] ? { ticker: losers[0].ticker, changePct: losers[0].changePct } : null,
      turnoverLeader: byTurnover[0]
        ? { ticker: byTurnover[0].ticker, valueTraded: byTurnover[0].valueTraded }
        : null,
    });
  }
  rows.sort((a, b) => b.marketCap - a.marketCap || b.count - a.count);
  return rows;
}

// ─────────────────────────────────────────────────────── shared meta ───

export function sessionMeta() {
  const st = marketStatus();
  return {
    asOf: st.cairoDate,
    cairoTime: st.cairoTime,
    lastSession: st.lastSession,
    open: st.open,
    delayMinutes: 15,
    source: "TradingView",
  };
}
