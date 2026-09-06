import { NextRequest, NextResponse } from "next/server";
import { fetchUniverse } from "@/lib/market";
import { fetchStockChart, CHART_RANGES, type ChartRange } from "@/lib/history";
import { ensureHistory, indexHistory } from "@/lib/flows";

export const dynamic = "force-dynamic";

/** GET /api/chart?symbol=COMI&range=6M — REAL price history:
 *    - stocks (any EGX-listed ticker): daily/weekly candles from Yahoo Finance
 *    - indices (EGX30 | EGX70 | EGX100): real daily closes persisted from
 *      EGXBot session reports (Sun–Thu sessions; the series starts ~3 months
 *      back and grows every day — no free source serves multi-year EGX
 *      index history).
 *  No auth, no mock data. */

const INDEX_KEYS = { EGX30: "egx30", EGX70: "egx70", EGX100: "egx100" } as const;
type IndexCode = keyof typeof INDEX_KEYS;

const INDEX_META: Record<IndexCode, { nameAr: string; nameEn: string }> = {
  EGX30: { nameAr: "مؤشر إيجي إكس ٣٠", nameEn: "EGX 30 Price Return Index" },
  EGX70: { nameAr: "مؤشر إيجي إكس ٧٠ EWI", nameEn: "EGX 70 EWI" },
  EGX100: { nameAr: "مؤشر إيجي إكس ١٠٠ EWI", nameEn: "EGX 100 EWI" },
};

type ChartResponse = {
  symbol: string;
  name: string;
  kind: "stock" | "index";
  range: string;
  currency: string;
  points: { date: string; close: number; volume: number | null }[];
  first: number | null;
  last: number | null;
  high: number | null;
  low: number | null;
  changePct: number | null;
  asOf: string | null;
  source: string;
  warming?: boolean;
  availableRanges: string[];
};

function stats(points: { date: string; close: number; volume: number | null }[]) {
  const closes = points.map((p) => p.close);
  const first = closes[0] ?? null;
  const last = closes[closes.length - 1] ?? null;
  return {
    first,
    last,
    high: closes.length ? Math.max(...closes) : null,
    low: closes.length ? Math.min(...closes) : null,
    changePct: first && first > 0 && last !== null ? ((last - first) / first) * 100 : null,
    asOf: points.length ? points[points.length - 1].date : null,
  };
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase();
  const rangeParam = (req.nextUrl.searchParams.get("range") ?? "").toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  // ── indices: real closes persisted from EGXBot session reports ──
  if (symbol in INDEX_KEYS) {
    const code = symbol as IndexCode;
    const range = rangeParam === "1M" || rangeParam === "3M" || rangeParam === "6M" || rangeParam === "ALL" ? rangeParam : "3M";
    const days = range === "1M" ? 31 : range === "3M" ? 95 : range === "6M" ? 190 : 400;
    // warm the archive in the background; the client polls and picks up rows
    ensureHistory().catch(() => {});
    let points: { date: string; close: number }[] = [];
    try {
      points = await indexHistory(days, INDEX_KEYS[code]);
    } catch {
      points = [];
    }
    const mapped = points.map((p) => ({ date: p.date, close: p.close, volume: null as number | null }));
    const body: ChartResponse = {
      symbol: code,
      name: INDEX_META[code].nameEn,
      kind: "index",
      range,
      currency: "points",
      points: mapped,
      ...stats(mapped),
      source: "EGXBot — real daily closes (EGX sessions)",
      warming: points.length < 5,
      availableRanges: ["1M", "3M", "6M", "ALL"],
    };
    return NextResponse.json(body);
  }

  // ── stocks: Yahoo Finance candles, validated against the live universe ──
  const range: ChartRange = (CHART_RANGES as string[]).includes(rangeParam) ? (rangeParam as ChartRange) : "6M";
  try {
    const stocks = await fetchUniverse();
    const stock = stocks.find((s) => s.ticker === symbol);
    if (!stock) {
      return NextResponse.json({ error: "no such symbol" }, { status: 404 });
    }
  } catch {
    // universe fetch hiccup — still allow the chart if Yahoo has the symbol
  }
  try {
    const chart = await fetchStockChart(symbol, range);
    const body: ChartResponse = {
      symbol: chart.symbol,
      name: chart.yahooSymbol,
      kind: "stock",
      range: chart.range,
      currency: chart.currency,
      points: chart.points,
      first: chart.first,
      last: chart.last,
      high: chart.high,
      low: chart.low,
      changePct: chart.changePct,
      asOf: chart.asOf,
      source: chart.source,
      availableRanges: CHART_RANGES,
    };
    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "chart unavailable";
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}
