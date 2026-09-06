import { NextRequest, NextResponse } from "next/server";
import { fetchUniverse, fetchNews, relatedNews, sectorAr, sectorCode, companyRow, sessionMeta, type Stock } from "@/lib/market";
import { ensureNewsArchive, relatedNewsArchive } from "@/lib/news-archive";

function median(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** GET /api/company/[ticker] — live company page payload:
 *  quote, real fundamentals, performance horizons, sector medians,
 *  same-sector peers and related news. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await ctx.params;
    const t = decodeURIComponent(ticker).toUpperCase();

    // warm the news archive in the background (related-news tab reads from it)
    ensureNewsArchive().catch(() => {});

    const [stocks, news] = await Promise.all([fetchUniverse(), fetchNews()]);
    const company = stocks.find((s) => s.ticker === t);
    if (!company) {
      return NextResponse.json({ error: "no such company" }, { status: 404 });
    }

    const peers = stocks
      .filter((s) => s.sector === company.sector && s.ticker !== company.ticker)
      .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
      .slice(0, 10)
      .map(companyRow);

    const peerPool = stocks.filter((s) => s.sector === company.sector);
    const sectorAgg = {
      count: peerPool.length,
      nameAr: sectorAr(company.sector),
      nameEn: company.sector || "Unclassified",
      pe: median(peerPool.map((s) => s.pe).filter((v): v is number => v !== null)),
      eps: median(peerPool.map((s) => s.eps).filter((v): v is number => v !== null)),
      divYield: median(peerPool.map((s) => s.divYield).filter((v): v is number => v !== null)),
      beta: median(peerPool.map((s) => s.beta).filter((v): v is number => v !== null)),
      avgChangePct: peerPool.length ? peerPool.reduce((a, s) => a + s.changePct, 0) / peerPool.length : null,
    };

    const c: Stock = company;
    const archived = await relatedNewsArchive(t, c.name, 6).catch(() => []);
    return NextResponse.json({
      session: sessionMeta(),
      company: {
        ...companyRow(c),
        industry: c.industry,
        netMarginTTM: c.netMarginTTM,
        revenueTTM: c.revenueTTM,
        floatShares: c.floatShares,
        avgTurnover30: c.avgTurnover30,
        high1M: c.high1M,
        low1M: c.low1M,
        beta: c.beta,
        updateMode: c.updateMode,
        sectorCode: sectorCode(c.sector),
      },
      sectorAgg,
      peers,
      news: archived.length > 0 ? archived : relatedNews(c, news, 6),
    });
  } catch {
    return NextResponse.json({ error: "market data unavailable" }, { status: 502 });
  }
}
