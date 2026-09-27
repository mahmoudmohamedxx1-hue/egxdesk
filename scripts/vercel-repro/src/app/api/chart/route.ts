import { NextRequest, NextResponse } from "next/server";
import { fetchUniverse, type Stock } from "@/lib/market";
import { fetchStockChart, milestoneChart, CHART_RANGES, type ChartRange } from "@/lib/history";
import { ensureHistory, indexHistory } from "@/lib/flows";
import { sampleIfDue, intradayPoints } from "@/lib/intraday";
import { resolveTicker } from "@/lib/ticker-aliases";

export const dynamic = "force-dynamic";

/** GET /api/chart?symbol=COMI&range=6M — REAL price history:
 *    - stocks (any EGX-listed ticker): daily/weekly candles from Yahoo Finance
 *    - intraday ranges (1D / 1W): self-collected ~5-minute ticks sampled from
 *      the live TradingView universe while the session is open (T26) — no
 *      free source serves true EGX intraday candles; until the first sessions
 *      are collected the route serves daily candles with an honest label
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

type ChartPointOut = { date: string; close: number; volume: number | null; high?: number | null; low?: number | null; live?: boolean };

type ChartResponse = {
  symbol: string;
  name: string;
  kind: "stock" | "index";
  range: string;
  currency: string;
  points: ChartPointOut[];
  first: number | null;
  last: number | null;
  high: number | null;
  low: number | null;
  changePct: number | null;
  asOf: string | null;
  source: string;
  warming?: boolean;
  availableRanges: string[];
  /** T27 — milestone reconstruction marker + 52w reference levels. */
  milestones?: boolean;
  refHigh?: number | null;
  refLow?: number | null;
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
    const range =
      rangeParam === "1W" || rangeParam === "1M" || rangeParam === "3M" || rangeParam === "6M" || rangeParam === "1Y" || rangeParam === "5Y" || rangeParam === "ALL"
        ? rangeParam
        : "3M";
    // 1Y/5Y/ALL all read the full stored archive (the published record
    // reaches back to Nov 2025 and grows daily) — the chart labels the
    // first date, so the window is honest about what it holds.
    const days = range === "1W" ? 9 : range === "1M" ? 31 : range === "3M" ? 95 : range === "6M" ? 190 : 400;
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
      availableRanges: ["1M", "3M", "6M", "1Y", "ALL"],
    };
    return NextResponse.json(body);
  }

  // ── stocks: real candles/ticks, validated against the live universe ──
  // (the daily candle series is completed with the live TradingView close
  //  inside fetchStockChart when Yahoo lags the last session — Task 23 fix —
  //  so charts, technical panels and signals never end a session behind the
  //  live quote header)
  const range: ChartRange = (CHART_RANGES as string[]).includes(rangeParam) ? (rangeParam as ChartRange) : "6M";
  let stockRow: Stock | null = null;
  try {
    const universe = await fetchUniverse();
    // T38 — canonicalize legacy ISIN-shaped symbols to the Reuters ticker
    stockRow = universe.find((s) => s.ticker === resolveTicker(symbol)) ?? null;
    if (!stockRow) {
      return NextResponse.json({ error: "no such symbol" }, { status: 404 });
    }
  } catch {
    // universe fetch hiccup — still allow the chart if Yahoo has the symbol
  }

  // T26 — intraday timeframes: self-collected ticks. sampleIfDue() keeps the
  // store fresh while the session is open (lazy, debounced, one scanner call).
  if (range === "1D" || range === "1W") {
    sampleIfDue();
    try {
      const sessions = range === "1D" ? 1 : 5;
      const ticks = await intradayPoints(symbol, sessions);
      if (ticks.length >= 2) {
        const closes = ticks.map((p) => p.close);
        const first = closes[0];
        const last = closes[closes.length - 1];
        const body: ChartResponse = {
          symbol,
          name: symbol,
          kind: "stock",
          range,
          currency: "EGP",
          points: ticks.map((p) => ({ date: p.date, close: p.close, volume: p.volume })),
          first,
          last,
          high: Math.max(...closes),
          low: Math.min(...closes),
          changePct: first > 0 ? ((last - first) / first) * 100 : null,
          asOf: ticks[ticks.length - 1].date,
          source:
            "EGX Desk self-collected ticks (~5 min, delayed ~15 min, TradingView quote stream)",
          availableRanges: CHART_RANGES,
        };
        return NextResponse.json(body);
      }
    } catch (err) {
      console.error("chart: intraday read failed", err);
    }
    // no ticks yet (weekend / cold start) — serve the last five daily
    // sessions as an honest, clearly-labeled fallback; for names with no
    // Yahoo history at all, serve milestone anchors (1W/1M perf) instead
    try {
      const daily = await fetchStockChart(symbol, "1M");
      const dates = Array.from(new Set(daily.points.map((p) => p.date)));
      const keep = new Set(dates.slice(-5));
      const points = daily.points.filter((p) => keep.has(p.date));
      const closes = points.map((p) => p.close);
      const first = closes[0] ?? null;
      const last = closes[closes.length - 1] ?? null;
      const body: ChartResponse = {
        symbol: daily.symbol,
        name: daily.yahooSymbol,
        kind: "stock",
        range,
        currency: daily.currency,
        points,
        first,
        last,
        high: closes.length ? Math.max(...closes) : null,
        low: closes.length ? Math.min(...closes) : null,
        changePct: first && first > 0 && last !== null ? ((last - first) / first) * 100 : null,
        asOf: daily.asOf,
        source:
          "Intraday ticks accumulate while the market is open — showing the last five daily sessions until the first session is sampled",
        warming: true,
        availableRanges: CHART_RANGES,
      };
      return NextResponse.json(body);
    } catch {
      if (stockRow) {
        try {
          const ms = milestoneChart(symbol, "1M", stockRow);
          const body: ChartResponse = {
            symbol: ms.symbol,
            name: ms.yahooSymbol,
            kind: "stock",
            range,
            currency: ms.currency,
            points: ms.points,
            first: ms.first,
            last: ms.last,
            high: ms.high,
            low: ms.low,
            changePct: ms.changePct,
            asOf: ms.asOf,
            source: `${ms.source} — intraday ticks accumulate while the market is open`,
            warming: true,
            availableRanges: CHART_RANGES,
            milestones: true,
            refHigh: ms.refHigh ?? null,
            refLow: ms.refLow ?? null,
          };
          return NextResponse.json(body);
        } catch {
          // anchors unavailable too — 404 below
        }
      }
      return NextResponse.json({ error: "chart unavailable" }, { status: 404 });
    }
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
      ...(chart.milestones ? { milestones: true } : {}),
      refHigh: chart.refHigh ?? null,
      refLow: chart.refLow ?? null,
    };
    return NextResponse.json(body);
  } catch {
    // T27 — no Yahoo history for this name (404 / stub bar): serve a real
    // milestone chart reconstructed from the TradingView universe row's
    // verified performance anchors so every listed stock has a chart.
    if (stockRow) {
      try {
        const ms = milestoneChart(symbol, range, stockRow);
        const body: ChartResponse = {
          symbol: ms.symbol,
          name: ms.yahooSymbol,
          kind: "stock",
          range: ms.range,
          currency: ms.currency,
          points: ms.points,
          first: ms.first,
          last: ms.last,
          high: ms.high,
          low: ms.low,
          changePct: ms.changePct,
          asOf: ms.asOf,
          source: ms.source,
          availableRanges: CHART_RANGES,
          milestones: true,
          refHigh: ms.refHigh ?? null,
          refLow: ms.refLow ?? null,
        };
        return NextResponse.json(body);
      } catch {
        // anchors unavailable too (fresh listing with no perf fields) — 404
      }
    }
    return NextResponse.json({ error: "chart unavailable" }, { status: 404 });
  }
}
