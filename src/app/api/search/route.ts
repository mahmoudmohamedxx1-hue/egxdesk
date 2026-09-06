import { NextRequest, NextResponse } from "next/server";
import { fetchUniverse, sectorAr } from "@/lib/market";

/** GET /api/search?q= — type-ahead live company search. */
export async function GET(req: NextRequest) {
  try {
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
    if (q.length < 1) return NextResponse.json({ results: [] });

    const stocks = await fetchUniverse();
    const results = stocks
      .filter(
        (c) =>
          c.ticker.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          (c.industry ?? "").toLowerCase().includes(q)
      )
      .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
      .slice(0, 12)
      .map((c) => ({
        ticker: c.ticker,
        name: c.name,
        sectorAr: sectorAr(c.sector),
        sectorEn: c.sector || "Unclassified",
        close: c.close,
        changePct: c.changePct,
      }));

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "search unavailable" }, { status: 502 });
  }
}
