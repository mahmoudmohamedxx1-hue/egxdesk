import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveDataset } from "@/lib/auth";

/**
 * GET /api/company/[ticker] — full company page payload:
 * quote, fundamentals, sector medians, price history, financial
 * periods, disclosures.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ ticker: string }> }
) {
  const { user, dataset } = await resolveDataset();
  const { ticker } = await ctx.params;
  const t = decodeURIComponent(ticker).toUpperCase();

  const company = await db.company.findFirst({
    where: { dataset, ticker: t },
    include: { sector: true },
  });
  if (!company) {
    return NextResponse.json({ error: "no such company" }, { status: 404 });
  }

  const [history, financials, disclosures, peers] = await Promise.all([
    db.pricePoint.findMany({
      where: { companyId: company.id },
      orderBy: { date: "asc" },
    }),
    db.financialPeriod.findMany({
      where: { companyId: company.id },
      orderBy: { labelOrder: "asc" },
    }),
    db.disclosure.findMany({
      where: { companyId: company.id },
      orderBy: { date: "desc" },
    }),
    db.company.findMany({
      where: { dataset, sectorId: company.sectorId },
    }),
  ]);

  // sector aggregates (median-style comparisons)
  const metric = (key: keyof typeof company) => {
    const vals = peers
      .map((p) => p[key] as number | null)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (!vals.length) return null;
    const sorted = [...vals].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  const sectorAgg = {
    pe: metric("pe"),
    pb: metric("pb"),
    divYield: metric("divYield"),
    netProfit: metric("netProfit"),
    eps: metric("eps"),
    totalAssets: metric("totalAssets"),
    roe: metric("roe"),
    roa: metric("roa"),
    debtToEquity: metric("debtToEquity"),
  };

  return NextResponse.json({
    authed: !!user,
    dataset,
    company: {
      ticker: company.ticker,
      nameAr: company.nameAr,
      nameEn: company.nameEn,
      sectorAr: company.sector.nameAr,
      sectorEn: company.sector.nameEn,
      close: company.close,
      prevClose: company.prevClose,
      changePct: company.changePct,
      week1Pct: company.week1Pct,
      month1Pct: company.month1Pct,
      volume: company.volume,
      avgVolume30d: company.avgVolume30d,
      trades: company.trades,
      valueTraded: company.valueTraded,
      marketCap: company.marketCap,
      pe: company.pe,
      pe12m: company.priceEarnings12m,
      pb: company.pb,
      eps: company.eps,
      divYield: company.divYield,
      netProfit: company.netProfit,
      totalAssets: company.totalAssets,
      roe: company.roe,
      roa: company.roa,
      debtToEquity: company.debtToEquity,
      cashConversion: company.cashConversion,
      freeFloat: company.freeFloat,
      issuedShares: company.issuedShares,
      briefAr: company.briefAr,
      briefEn: company.briefEn,
      hasFullFinancials: company.hasFullFinancials,
      inEgx30: company.inEgx30,
      inEgx70: company.inEgx70,
      inEgx100: company.inEgx100,
    },
    sectorAgg,
    history: history.map((h) => ({ date: h.date, close: h.close })),
    financials: financials.map((f) => ({
      label: f.label,
      periodType: f.periodType,
      revenue: f.revenue,
      netProfit: f.netProfit,
      totalAssets: f.totalAssets,
      equity: f.equity,
      eps: f.eps,
    })),
    disclosures: disclosures.map((d) => ({
      title: d.titleAr,
      kind: d.kind,
      date: d.date,
    })),
  });
}
