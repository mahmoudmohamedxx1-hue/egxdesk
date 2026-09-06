import { NextRequest, NextResponse } from "next/server";
import { fetchUniverse, companyRow, sessionMeta } from "@/lib/market";

/** GET /api/companies — the live market table.
 *  Query: q (search), sector (code slug). */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") ?? "").trim().toLowerCase();
    const sector = sp.get("sector") ?? "";

    const stocks = await fetchUniverse();
    let rows = stocks.map(companyRow);

    if (sector) rows = rows.filter((r) => r.sectorCode === sector);
    if (q) {
      rows = rows.filter(
        (r) =>
          r.ticker.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.sectorEn.toLowerCase().includes(q)
      );
    }
    rows = [...rows].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

    return NextResponse.json({
      session: sessionMeta(),
      total: rows.length,
      rows,
    });
  } catch {
    return NextResponse.json({ error: "market data unavailable" }, { status: 502 });
  }
}
