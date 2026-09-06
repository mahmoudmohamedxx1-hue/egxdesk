import { NextResponse } from "next/server";
import { fetchUniverse, companyRow, sessionMeta } from "@/lib/market";

/** GET /api/activity — live market-activity view: session turnover leaders,
 *  unusual-volume stocks, breadth and session totals, all computed from
 *  real EGX quotes (the exchange's investor-category flows are not part of
 *  any free public feed, so this view shows what the real data supports). */
export async function GET() {
  try {
    const stocks = await fetchUniverse();

    const turnoverLeaders = [...stocks]
      .sort((a, b) => b.valueTraded - a.valueTraded)
      .slice(0, 10)
      .map(companyRow);

    const unusual = stocks
      .filter((c) => c.avgVolume && c.avgVolume > 0)
      .map((c) => ({ ...companyRow(c), volumeRatio: c.volume / c.avgVolume! }))
      .sort((a, b) => b.volumeRatio - a.volumeRatio)
      .slice(0, 8);

    const up = stocks.filter((c) => c.changePct > 0).length;
    const down = stocks.filter((c) => c.changePct < 0).length;

    return NextResponse.json({
      session: sessionMeta(),
      totals: {
        valueTraded: stocks.reduce((a, c) => a + c.valueTraded, 0),
        volume: stocks.reduce((a, c) => a + c.volume, 0),
        breadth: { total: stocks.length, up, down, flat: stocks.length - up - down },
      },
      turnoverLeaders,
      unusual,
    });
  } catch {
    return NextResponse.json({ error: "market data unavailable" }, { status: 502 });
  }
}
