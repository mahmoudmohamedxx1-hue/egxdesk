import { NextRequest, NextResponse } from "next/server";
import { fetchUniverse, sectorAr } from "@/lib/market";
import { matchArabic, normalizeAr, arabicName, AR_ALIASES } from "@/lib/ar-search";
import { arName, arCompanySector } from "@/lib/ar-names";

/** GET /api/search?q= — type-ahead live company search.
 *  Matches ticker / English name / industry, plus the curated Arabic
 *  brand-alias map (normalized), plus Arabic sector names. */
export async function GET(req: NextRequest) {
  try {
    const qRaw = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (qRaw.length < 1) return NextResponse.json({ results: [] });
    const q = qRaw.toLowerCase();
    const nq = normalizeAr(qRaw);

    const stocks = await fetchUniverse();
    const byTicker = new Map(stocks.map((c) => [c.ticker, c]));

    // Arabic alias matches -> tier scores
    const arMatches = matchArabic(qRaw);
    const arScore = new Map<string, number>();
    for (const m of arMatches) {
      if (byTicker.has(m.ticker) && !arScore.has(m.ticker)) arScore.set(m.ticker, m.score);
    }

    const scored = stocks
      .map((c) => {
        const tickerL = c.ticker.toLowerCase();
        const nameL = (c.name ?? "").toLowerCase();
        const sectorArL = normalizeAr(sectorAr(c.sector));
        let score = 0;
        if (tickerL === q) score = 120;
        else if (tickerL.includes(q)) score = 95;
        else if (nameL.startsWith(q)) score = 90;
        else if (nameL.includes(q)) score = 65;
        else if ((c.industry ?? "").toLowerCase().includes(q)) score = 40;
        else if (nq && sectorArL.includes(nq) && nq.length >= 3) score = 30;
        const ar = arScore.get(c.ticker) ?? 0;
        if (ar > score) score = ar;
        return { c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - (a.score) || (b.c.marketCap ?? 0) - (a.c.marketCap ?? 0))
      .slice(0, 12)
      .map(({ c }) => ({
        ticker: c.ticker,
        name: c.name,
        nameAr: arName(c.ticker) ?? arabicName(c.ticker),
        sectorAr: arCompanySector(c.ticker) ?? sectorAr(c.sector),
        sectorEn: c.sector || "Unclassified",
        close: c.close,
        changePct: c.changePct,
      }));

    return NextResponse.json({ results: scored, aliasesKnown: Object.keys(AR_ALIASES).length });
  } catch {
    return NextResponse.json({ error: "search unavailable" }, { status: 502 });
  }
}
