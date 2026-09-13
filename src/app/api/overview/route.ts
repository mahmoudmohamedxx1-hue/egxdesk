import { NextResponse } from "next/server";
import { fetchUniverse, fetchIndices, fetchNews, sectorRows, companyRow, sessionMeta } from "@/lib/market";
import { sampleIfDue } from "@/lib/intraday";
import { fetchFlows, breadthHistory, persistBreadthLive } from "@/lib/flows";
import { marketStatus } from "@/lib/market-status";

/** GET /api/overview — live landing payload: indices, breadth, totals,
 *  unusual-volume actives, biggest movers, top caps, sector snapshot, news,
 *  and an investor-flows summary ("who moved the market today"). */
export async function GET() {
  try {
    sampleIfDue(); // T26 — keep the intraday tick store fresh while anyone browses
    const [stocks, indices, news] = await Promise.all([fetchUniverse(), fetchIndices(), fetchNews()]);
    const sectors = sectorRows(stocks);

    const up = stocks.filter((c) => c.changePct > 0).length;
    const down = stocks.filter((c) => c.changePct < 0).length;
    const flat = stocks.length - up - down;

    // Task 23 fix — the home breadth chart froze because BreadthDay had no
    // runtime writer. (a) once the session is closed, the live universe's
    // final up/down/flat IS the session figure: persist it (fire-and-forget,
    // source "live"; EGXBot's own writer refines it when it runs). (b) while
    // the market is open, append today's live point to the history so the
    // chart shows the session developing instead of lagging a day behind.
    const status = marketStatus();
    const breadthHistoryRows = await breadthHistory(30).catch(() => []);
    if (!status.open && up + down > 0) {
      void persistBreadthLive(status.lastSession, up, down, flat).catch(() => {});
    }
    const breadthChart =
      status.open && up + down > 0 && breadthHistoryRows[breadthHistoryRows.length - 1]?.date !== status.cairoDate
        ? [...breadthHistoryRows, { date: status.cairoDate, up, down, flat, counted: stocks.length }]
        : breadthHistoryRows;

    const actives = stocks
      .filter((c) => c.avgVolume && c.avgVolume > 0)
      .map((c) => ({ ...companyRow(c), volumeRatio: c.volume / c.avgVolume! }))
      .sort((a, b) => b.volumeRatio - a.volumeRatio)
      .slice(0, 4);

    const movers = [...stocks]
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
      .slice(0, 6)
      .map(companyRow);

    const colors = [...stocks]
      .filter((c) => c.marketCap)
      .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
      .slice(0, 12)
      .map(companyRow);

    const ranked = sectors.filter((s) => s.count >= 3 && s.capWeightedChangePct !== null);
    const best = [...ranked].sort((a, b) => (b.capWeightedChangePct ?? 0) - (a.capWeightedChangePct ?? 0)).slice(0, 3);
    const worst = [...ranked].sort((a, b) => (a.capWeightedChangePct ?? 0) - (b.capWeightedChangePct ?? 0)).slice(0, 3);

    // compact full-market sector performance for the overview chart
    const sectorPerformance = ranked
      .sort((a, b) => (b.capWeightedChangePct ?? 0) - (a.capWeightedChangePct ?? 0))
      .map((s) => ({ nameEn: s.nameEn, nameAr: s.nameAr, v: s.capWeightedChangePct as number }));

    // "behind the market move": today's investor-category net flows (real
    // Sigma table — same source as the investors view). Race-bounded so the
    // overview never blocks on it; degrades to null.
    let flowsSummary: {
      asOf: string;
      egyNet: number;
      arabNet: number;
      forNet: number;
      retailPct: number;
      instPct: number;
      turnoverTotal: number;
    } | null = null;
    try {
      const snap = await Promise.race([
        fetchFlows(),
        new Promise<null>((r) => setTimeout(() => r(null), 4000)),
      ]);
      if (snap) {
        flowsSummary = {
          asOf: snap.asOf,
          egyNet: snap.nationalityNet.egyptians,
          arabNet: snap.nationalityNet.arabs,
          forNet: snap.nationalityNet.foreigners,
          retailPct: snap.retailPct,
          instPct: snap.instPct,
          turnoverTotal: snap.turnoverTotal,
        };
      }
    } catch {
      // flows layer hiccup — section hides itself
    }

    return NextResponse.json({
      session: sessionMeta(),
      indices,
      breadth: { total: stocks.length, up, down, flat },
      breadthHistory: breadthChart,
      totals: {
        valueTraded: stocks.reduce((a, c) => a + c.valueTraded, 0),
        volume: stocks.reduce((a, c) => a + c.volume, 0),
        marketCap: stocks.reduce((a, c) => a + (c.marketCap ?? 0), 0),
      },
      actives,
      movers,
      colors,
      sectorsSnapshot: { best, worst },
      sectorPerformance,
      flowsSummary,
      news: news.slice(0, 6),
    });
  } catch {
    return NextResponse.json({ error: "market data unavailable" }, { status: 502 });
  }
}
