/** Server-side GCC market layer (T27 — P1-6 gap): Saudi (Tadawul), Dubai
 *  (DFM) and Abu Dhabi (ADX) basics from the same free feeds the EGX side
 *  uses. No API key, no auth.
 *
 *  - Indices: TradingView global scanner (TADAWUL:TASI, TADAWUL:MT30,
 *    DFM:DFMGI) + Yahoo chart meta for the ADX general index (FADGI.FGI —
 *    quote only: no free source serves its history)
 *  - Movers: TradingView "ksa" and "uae" market scanners (the UAE market
 *    covers both ADX: and DFM: listings), ranked by traded value
 *  - Index history for charts: Yahoo (^TASI.SR has full daily bars,
 *    DFMGI.AE about a year, FADGI.FGI a single stub — each labeled honestly)
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// ─────────────────────────────────────────────────────────── caching ───

type Entry = { data: unknown; at: number };
const cache = new Map<string, Entry>();
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
      return data;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p as Promise<T>;
}

// ─────────────────────────────────────────────────────────── indices ───

export type GccIndex = {
  code: "TASI" | "MT30" | "DFMGI" | "ADI";
  nameAr: string;
  nameEn: string;
  market: "sa" | "ae";
  close: number;
  changePct: number | null;
  changeAbs: number | null;
  perfYTD: number | null;
  perf1M: number | null;
  perfY: number | null;
  currency: string;
  /** true when only the live quote exists (no free history for the chart) */
  quoteOnly?: boolean;
};

const GCC_INDEX_META: Record<GccIndex["code"], { nameAr: string; nameEn: string; market: "sa" | "ae"; currency: string }> = {
  TASI: { nameAr: "تاسي — المؤشر العام لسوق السعودية", nameEn: "Tadawul All Shares Index (TASI)", market: "sa", currency: "SAR" },
  MT30: { nameAr: "إم تي ٣٠ — موسي تداول", nameEn: "MSCI Tadawul 30 Index", market: "sa", currency: "SAR" },
  DFMGI: { nameAr: "المؤشر العام لسوق دبي المالي", nameEn: "DFM General Index", market: "ae", currency: "AED" },
  ADI: { nameAr: "المؤشر العام لبورصة أبوظبي", nameEn: "FTSE ADX General Index", market: "ae", currency: "AED" },
};

export async function fetchGccIndices(): Promise<GccIndex[]> {
  return cached("gcc:indices", 60_000, async () => {
    const out: GccIndex[] = [];
    // TradingView global scanner carries TASI / MT30 / DFMGI
    try {
      const res = await fetch("https://scanner.tradingview.com/global/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA, Accept: "text/plain" },
        body: JSON.stringify({
          filter: [{ left: "type", operation: "equal", right: "index" }],
          options: { lang: "en" },
          symbols: { query: { types: [] }, tickers: ["TADAWUL:TASI", "TADAWUL:MT30", "DFM:DFMGI"] },
          columns: ["name", "description", "close", "change", "change_abs", "Perf.YTD", "Perf.1M", "Perf.Y"],
          sort: { sortBy: "name", sortOrder: "asc" },
          range: [0, 10],
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) {
        const json = (await res.json()) as { data?: { s: string; d: unknown[] }[] };
        const map = new Map(json.data?.map((r) => [r.s, r.d]) ?? []);
        const pick = (sym: string, code: GccIndex["code"]) => {
          const d = map.get(sym);
          if (!d) return;
          const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
          out.push({
            code,
            ...GCC_INDEX_META[code],
            close: n(d[2]) ?? 0,
            changePct: n(d[3]),
            changeAbs: n(d[4]),
            perfYTD: n(d[5]),
            perf1M: n(d[6]),
            perfY: n(d[7]),
          });
        };
        pick("TADAWUL:TASI", "TASI");
        pick("TADAWUL:MT30", "MT30");
        pick("DFM:DFMGI", "DFMGI");
      }
    } catch {
      // scanner hiccup — fall through to the ADX quote + what we have
    }
    // ADX general index: Yahoo quote (FADGI.FGI has no history anywhere free)
    try {
      const res = await fetch(
        "https://query1.finance.yahoo.com/v8/finance/chart/FADGI.FGI?range=5d&interval=1d",
        { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10_000) },
      );
      if (res.ok) {
        const json = (await res.json()) as {
          chart?: { result?: { meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number } }[] };
        };
        const meta = json.chart?.result?.[0]?.meta;
        const close = meta?.regularMarketPrice ?? null;
        const prev = meta?.chartPreviousClose ?? meta?.previousClose ?? null;
        if (close != null && close > 0) {
          out.push({
            code: "ADI",
            ...GCC_INDEX_META.ADI,
            close,
            changePct: prev != null && prev > 0 ? ((close - prev) / prev) * 100 : null,
            changeAbs: prev != null ? close - prev : null,
            perfYTD: null,
            perf1M: null,
            perfY: null,
            quoteOnly: true,
          });
        }
      }
    } catch {
      // ADX quote unavailable this cycle
    }
    return out;
  });
}

// ─────────────────────────────────────────────────────────── movers ───

export type GccMover = {
  ticker: string; // plain, e.g. 2222 / IHC
  exchange: "TADAWUL" | "ADX" | "DFM";
  name: string;
  sector: string | null;
  close: number;
  changePct: number | null;
  volume: number | null;
  valueTraded: number | null; // close × volume (scanner value col is null)
  marketCap: number | null;
  currency: "SAR" | "AED";
};

const GCC_SCANNERS: { market: string; exchange: "TADAWUL" | "ADX" | "DFM"; currency: "SAR" | "AED" }[] = [
  { market: "ksa", exchange: "TADAWUL", currency: "SAR" },
  { market: "uae", exchange: "ADX", currency: "AED" },
];

async function scanMovers(market: string, exchange: "TADAWUL" | "ADX" | "DFM", currency: "SAR" | "AED", limit: number): Promise<GccMover[]> {
  const res = await fetch(`https://scanner.tradingview.com/${market}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, Accept: "text/plain" },
    body: JSON.stringify({
      filter: [
        { left: "type", operation: "equal", right: "stock" },
        { left: "subtype", operation: "in_range", right: ["common", "adr"] },
      ],
      options: { lang: "en" },
      markets: [market],
      symbols: { query: { types: [] }, tickers: [] },
      columns: ["name", "description", "close", "change", "volume", "market_cap_basic", "sector"],
      sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
      range: [0, 200],
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`gcc scanner ${res.status}`);
  const json = (await res.json()) as { data?: { s: string; d: unknown[] }[] };
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const rows = (json.data ?? [])
    .map((r) => {
      const full = String(r.s);
      const ex = full.split(":")[0] ?? "";
      const close = n(r.d[2]) ?? 0;
      const volume = n(r.d[4]);
      return {
        // T38 — the Saudi scanner serves symbols like "1120TADAWUL"; strip
        // the trailing exchange suffix so the row shows the readable code
        ticker: (full.split(":")[1] ?? full).replace(/(TADAWUL|ADX|DFM)$/i, ""),
        exchange: (ex === "DFM" ? "DFM" : exchange) as GccMover["exchange"],
        name: String(r.d[1] ?? r.d[0] ?? ""),
        sector: typeof r.d[6] === "string" ? r.d[6] : null,
        close,
        changePct: n(r.d[3]),
        volume,
        valueTraded: close > 0 && volume != null ? close * volume : null,
        marketCap: n(r.d[5]),
        currency,
      } satisfies GccMover;
    })
    .filter((x) => x.ticker && x.close > 0);
  // the UAE scanner covers both ADX and DFM; the saudi one only Tadawul
  const filtered = market === "uae" ? rows : rows;
  return filtered.sort((a, b) => (b.valueTraded ?? 0) - (a.valueTraded ?? 0)).slice(0, limit);
}

export async function fetchGccMovers(limit = 12): Promise<{ saudi: GccMover[]; uae: GccMover[] }> {
  return cached("gcc:movers", 60_000, async () => {
    const [saudi, uaeAll] = await Promise.all([
      scanMovers("ksa", "TADAWUL", "SAR", limit).catch(() => [] as GccMover[]),
      scanMovers("uae", "ADX", "AED", limit * 2).catch(() => [] as GccMover[]),
    ]);
    // split the UAE scan by exchange so both boards are represented
    const adx = uaeAll.filter((x) => x.exchange === "ADX").slice(0, limit);
    const dfm = uaeAll.filter((x) => x.exchange === "DFM").slice(0, limit);
    // keep the UAE list ordered by value across both boards, capped
    const uae = [...adx, ...dfm].sort((a, b) => (b.valueTraded ?? 0) - (a.valueTraded ?? 0)).slice(0, limit);
    return { saudi, uae };
  });
}

// ─────────────────────────────────────────────── index chart history ───

export type GccIndexPoint = { date: string; close: number };

const GCC_CHART_SYMBOLS: Record<string, { yahoo: string; label: string }> = {
  TASI: { yahoo: "^TASI.SR", label: "Yahoo Finance (Tadawul daily closes)" },
  DFMGI: { yahoo: "DFMGI.AE", label: "Yahoo Finance (DFM daily closes)" },
  ADI: { yahoo: "FADGI.FGI", label: "Yahoo Finance quote only" },
};

export async function fetchGccIndexChart(code: string, range: "1M" | "3M" | "6M" | "1Y"): Promise<{ points: GccIndexPoint[]; source: string; quoteOnly: boolean }> {
  const cfg = GCC_CHART_SYMBOLS[code.toUpperCase()];
  if (!cfg) throw new Error("gcc: unknown index");
  // Yahoo range spellings: 1mo / 3mo / 6mo / 1y (NOT 1m/3m/6m/1y)
  const yahooRange = { "1M": "1mo", "3M": "3mo", "6M": "6mo", "1Y": "1y" }[range];
  return cached(`gcc:chart:${code}:${range}`, 300_000, async () => {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cfg.yahoo)}?range=${yahooRange}&interval=1d`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12_000) },
    );
    if (!res.ok) throw new Error(`gcc chart ${res.status}`);
    const json = (await res.json()) as {
      chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
    };
    const r = json.chart?.result?.[0];
    const ts = r?.timestamp ?? [];
    const closes = r?.indicators?.quote?.[0]?.close ?? [];
    const points: GccIndexPoint[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (typeof c !== "number" || !Number.isFinite(c)) continue;
      points.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: c });
    }
    if (points.length < 2) {
      // ADX has no free history — quoteOnly frames are handled by the caller
      return { points, source: "No free source publishes this index's history — quote only", quoteOnly: true };
    }
    return { points, source: cfg.label, quoteOnly: false };
  });
}
