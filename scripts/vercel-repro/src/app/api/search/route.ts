import { NextRequest, NextResponse } from "next/server";
import { fetchUniverse, sectorAr } from "@/lib/market";
import { matchArabic, normalizeAr, arabicName, AR_ALIASES, normalizeArKey } from "@/lib/ar-search";
import { arName, arCompanySector } from "@/lib/ar-names";
import { resolveTicker } from "@/lib/ticker-aliases";

/** GET /api/search?q= — type-ahead live company search.
 *  Matches ticker / English name / industry, the curated Arabic brand-alias
 *  map (normalized), the FULL official Arabic name directory (270 exchange
 *  names — T38: previously matched only for display, never for search),
 *  plus Arabic sector names. */
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
      const key = resolveTicker(m.ticker);
      if (byTicker.has(key) && !arScore.has(key)) arScore.set(key, m.score);
    }

    // T38 — space-insensitive key for tolerant Arabic matching: "أبو قير"
    // must match "أبوقير", exactly as the module's docstring always promised
    const nqKey = normalizeArKey(qRaw);

    const scored = stocks
      .map((c) => {
        const tickerL = c.ticker.toLowerCase();
        const nameL = (c.name ?? "").toLowerCase();
        const sectorArL = normalizeAr(sectorAr(c.sector));
        // T38 — the official Arabic company directory is now SEARCHABLE,
        // not just display fuel: a word from the exchange's own Arabic name
        // ("مطاحن", "الاسيوطية"…) finds the company
        const nameArKey = normalizeArKey(arName(c.ticker) ?? "");
        const aliasKey = normalizeArKey(arabicName(c.ticker) ?? "");
        let score = 0;
        if (tickerL === q) score = 120;
        else if (tickerL.includes(q)) score = 95;
        else if (nameL.startsWith(q)) score = 90;
        else if (nameL.includes(q)) score = 65;
        else if ((c.industry ?? "").toLowerCase().includes(q)) score = 40;
        else if (nq && sectorArL.includes(nq) && nq.length >= 3) score = 30;
        if (score === 0 && nqKey.length >= 2) {
          if (nameArKey.includes(nqKey)) score = 75; // official Arabic name hit
          else if (aliasKey.includes(nqKey)) score = 70; // curated alias hit
          else if (nqKey.includes(nameArKey) && nameArKey.length >= 3) score = 60;
        }
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
