import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveDataset } from "@/lib/auth";

/**
 * GET /api/overview — everything the landing view needs:
 * indices, investor flows, unusual-volume actives, breadth,
 * biggest movers, top market cap tiles, latest disclosures & news.
 */
export async function GET() {
  const { user, dataset } = await resolveDataset();

  const [indices, flows, companies, news] = await Promise.all([
    db.indexQuote.findMany(),
    db.investorFlow.findMany({ where: { dataset: "live" } }),
    db.company.findMany({
      where: { dataset },
      include: { sector: true },
    }),
    db.newsItem.findMany({ orderBy: { publishedAt: "desc" }, take: 6 }),
  ]);

  // breadth
  const up = companies.filter((c) => c.changePct > 0).length;
  const down = companies.filter((c) => c.changePct < 0).length;
  const flat = companies.filter((c) => c.changePct === 0).length;

  // unusual volume actives: session volume ÷ 30-day average
  const actives = [...companies]
    .filter((c) => c.avgVolume30d > 0)
    .map((c) => ({ ...c, volumeRatio: c.volume / c.avgVolume30d }))
    .sort((a, b) => b.volumeRatio - a.volumeRatio)
    .slice(0, 4);

  // biggest movers by |changePct|
  const movers = [...companies]
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 6);

  // market colors: largest market caps, tile color = session change
  const colors = [...companies]
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, 12);

  return NextResponse.json({
    authed: !!user,
    dataset,
    session: { date: "2026-09-06", updated: "15:46", kind: "أسعار إغلاق" },
    indices,
    flows,
    breadth: { total: companies.length, up, down, flat },
    actives: actives.map(toRow),
    movers: movers.map(toRow),
    colors: colors.map(toRow),
    news: news.map((n) => ({
      id: n.id,
      title: n.titleAr,
      impact: n.impactAr,
      publisher: n.publisherAr,
      category: n.categoryAr,
      publishedAt: n.publishedAt,
    })),
  });
}

function toRow(c: any) {
  return {
    ticker: c.ticker,
    nameAr: c.nameAr,
    nameEn: c.nameEn,
    sectorAr: c.sector?.nameAr ?? "",
    sectorEn: c.sector?.nameEn ?? "",
    close: c.close,
    changePct: c.changePct,
    marketCap: c.marketCap,
    valueTraded: c.valueTraded,
    pe: c.pe,
    volumeRatio: c.volumeRatio ?? null,
    volume: c.volume,
    avgVolume30d: c.avgVolume30d,
  };
}
