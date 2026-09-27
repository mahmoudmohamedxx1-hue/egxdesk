import { NextResponse } from "next/server";
import { fetchUniverse, sectorRows, sessionMeta } from "@/lib/market";

/** GET /api/sectors — live sector cards, aggregated from real EGX quotes. */
export async function GET() {
  try {
    const stocks = await fetchUniverse();
    const sectors = sectorRows(stocks);
    return NextResponse.json({
      session: sessionMeta(),
      total: sectors.length,
      sectors,
    });
  } catch {
    return NextResponse.json({ error: "market data unavailable" }, { status: 502 });
  }
}
