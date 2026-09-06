import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveDataset } from "@/lib/auth";

/** GET /api/sectors — sector cards with per-sector aggregates. */
export async function GET() {
  const { user, dataset } = await resolveDataset();

  const sectors = await db.sector.findMany({
    where: { dataset },
    orderBy: { order: "asc" },
    include: { companies: true },
  });

  const cards = sectors
    .filter((s) => s.companies.length > 0)
    .map((s) => {
      const cos = s.companies;
      const up = cos.filter((c) => c.changePct > 0).length;
      const down = cos.filter((c) => c.changePct < 0).length;
      const flat = cos.length - up - down;
      const metric = (key: string) => {
        const vals = cos
          .map((c: any) => c[key] as number | null)
          .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        if (!vals.length) return null;
        const sorted = [...vals].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
      };
      const biggestMover = [...cos].sort(
        (a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)
      )[0];
      return {
        code: s.code,
        nameAr: s.nameAr,
        nameEn: s.nameEn,
        count: cos.length,
        up,
        down,
        flat,
        pe: metric("pe"),
        pb: metric("pb"),
        roe: metric("roe"),
        roa: metric("roa"),
        debtToEquity: metric("debtToEquity"),
        divYield: metric("divYield"),
        netProfit: metric("netProfit"),
        eps: metric("eps"),
        totalAssets: metric("totalAssets"),
        marketCap: cos.reduce((acc: number, c: any) => acc + (c.marketCap ?? 0), 0),
        biggestMover: biggestMover
          ? { ticker: biggestMover.ticker, changePct: biggestMover.changePct }
          : null,
      };
    });

  return NextResponse.json({
    authed: !!user,
    dataset,
    total: cards.length,
    sectors: cards,
  });
}
