import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveDataset } from "@/lib/auth";

/**
 * GET /api/companies — the market table.
 * Query: q (search), sector (code), limit, offset.
 */
export async function GET(req: NextRequest) {
  const { user, dataset } = await resolveDataset();
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const sector = sp.get("sector") ?? "";
  const index = sp.get("index") ?? ""; // EGX30 | EGX70 | EGX100

  const companies = await db.company.findMany({
    where: { dataset },
    include: { sector: true },
  });

  let rows = companies;
  if (sector) rows = rows.filter((c) => c.sector.code === sector);
  if (index === "EGX30") rows = rows.filter((c) => c.inEgx30);
  if (index === "EGX70") rows = rows.filter((c) => c.inEgx70);
  if (index === "EGX100") rows = rows.filter((c) => c.inEgx100);
  if (q) {
    rows = rows.filter(
      (c) =>
        c.ticker.toLowerCase().includes(q) ||
        c.nameAr.includes(q) ||
        c.nameEn.toLowerCase().includes(q)
    );
  }
  rows = rows.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

  return NextResponse.json({
    authed: !!user,
    dataset,
    total: rows.length,
    rows: rows.map((c) => ({
      ticker: c.ticker,
      nameAr: c.nameAr,
      nameEn: c.nameEn,
      sectorAr: c.sector.nameAr,
      sectorEn: c.sector.nameEn,
      sectorCode: c.sector.code,
      close: c.close,
      changePct: c.changePct,
      valueTraded: c.valueTraded,
      pe: c.pe,
      marketCap: c.marketCap,
      volume: c.volume,
      avgVolume30d: c.avgVolume30d,
    })),
  });
}
