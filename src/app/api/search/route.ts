import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveDataset } from "@/lib/auth";

/** GET /api/search?q= — type-ahead company search (matched on text only). */
export async function GET(req: NextRequest) {
  const { dataset } = await resolveDataset();
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 1) {
    return NextResponse.json({ results: [] });
  }

  const companies = await db.company.findMany({
    where: { dataset },
    include: { sector: true },
  });

  const results = companies
    .filter(
      (c) =>
        c.ticker.toLowerCase().includes(q) ||
        c.nameAr.includes(q) ||
        c.nameEn.toLowerCase().includes(q)
    )
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, 12)
    .map((c) => ({
      ticker: c.ticker,
      nameAr: c.nameAr,
      nameEn: c.nameEn,
      sectorAr: c.sector.nameAr,
      close: c.close,
      changePct: c.changePct,
    }));

  return NextResponse.json({ results });
}
