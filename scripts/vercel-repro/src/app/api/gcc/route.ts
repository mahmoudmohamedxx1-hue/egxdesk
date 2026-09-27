import { NextRequest, NextResponse } from "next/server";
import { fetchGccIndices, fetchGccMovers, fetchGccIndexChart } from "@/lib/gcc";

export const dynamic = "force-dynamic";

/** GET /api/gcc — GCC market basics (T27 — P1-6): index quotes for Saudi
 *  (TASI / MT30), Dubai (DFMGI) and Abu Dhabi (ADI), top movers by traded
 *  value from the TradingView ksa/uae scanners, and daily history for the
 *  index chart (?index=TASI&range=6M). No auth, no mock data; every board is
 *  labeled with its currency and source. */

export async function GET(req: NextRequest) {
  const indexParam = (req.nextUrl.searchParams.get("index") ?? "").trim().toUpperCase();
  const rangeParam = (req.nextUrl.searchParams.get("range") ?? "6M").toUpperCase();

  // index chart series
  if (indexParam) {
    const range = (["1M", "3M", "6M", "1Y"] as const).includes(rangeParam as "1M" | "3M" | "6M" | "1Y") ? (rangeParam as "1M" | "3M" | "6M" | "1Y") : "6M";
    try {
      const chart = await fetchGccIndexChart(indexParam, range);
      return NextResponse.json({ index: indexParam, range, ...chart });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "gcc chart unavailable";
      return NextResponse.json({ error: msg }, { status: 404 });
    }
  }

  const [indices, movers] = await Promise.all([
    fetchGccIndices().catch(() => []),
    fetchGccMovers(12).catch(() => ({ saudi: [], uae: [] })),
  ]);
  if (indices.length === 0 && movers.saudi.length === 0 && movers.uae.length === 0) {
    return NextResponse.json({ error: "gcc feeds unavailable" }, { status: 502 });
  }
  return NextResponse.json({
    asOf: new Date().toISOString(),
    indices,
    movers,
    source: "TradingView scanners (ksa/uae markets, ~15 min delayed) + Yahoo Finance index quotes",
  });
}
