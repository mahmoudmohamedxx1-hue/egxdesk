import { NextResponse } from "next/server";
import { fetchUniverse } from "@/lib/market";
import { arName, arCompanySector } from "@/lib/ar-names";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/valuation-map — خريطة التقييم والديون (the valuation & debt
 *  map): every listed company with a P/E and a debt/equity ratio placed on
 *  a 2D map — x = P/E (what you pay for earnings), y = D/E (how leveraged
 *  the balance sheet is), bubble = market cap. The four quadrants are the
 *  reading aid, cloned from the source model:
 *    low P/E + low D/E → قيمة حقيقية (real value)
 *    low P/E + high D/E → قيمة مثقلة بالديون (debt-heavy "value trap" risk)
 *    high P/E + low D/E → نمو وجودة (growth & quality on a clean balance)
 *    high P/E + high D/E → تقييم متضخم (expensive AND leveraged)
 *
 *  The DEBT-ADJUSTED MULTIPLE (P/E × (1 + D/E)) is the honest companion
 *  number the source screen ranks its list by: what you pay per unit of
 *  earnings once the balance sheet's leverage is priced in. */

const CACHE_MS = 300_000;
let cache: { at: number; body: unknown } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) return NextResponse.json(cache.body);
  try {
    const universe = await fetchUniverse();
    const rows = universe
      .filter((s) => s.pe != null && s.pe > 0 && s.debtToEquity != null && s.debtToEquity >= 0)
      .map((s) => {
        const pe = s.pe as number;
        const de = s.debtToEquity as number;
        const adjusted = pe * (1 + de);
        const sector = s.sector || "Unclassified";
        return {
          ticker: s.ticker,
          nameAr: arName(s.ticker) ?? s.name,
          nameEn: s.name,
          sector,
          sectorAr: arCompanySector(s.ticker) ?? sector,
          pe,
          de,
          marketCap: s.marketCap,
          adjusted,
          quadrant:
            pe <= 15 && de <= 1 ? "value" : pe <= 15 && de > 1 ? "leveraged" : pe > 15 && de <= 1 ? "quality" : "expensive",
        };
      });

    const med = (xs: number[]): number | null => {
      if (!xs.length) return null;
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    const medianPe = med(rows.map((r) => r.pe));
    const medianDe = med(rows.map((r) => r.de));

    // group sectors by their ARABIC label — two TradingView keys can render
    // one Arabic label, and the filter chips must never show it twice
    const bySector = new Map<string, { sector: string; sectorAr: string; count: number; medianPe: number | null; medianDe: number | null; rows: typeof rows }>();
    for (const r of rows) {
      const cur = bySector.get(r.sectorAr) ?? { sector: r.sector, sectorAr: r.sectorAr, count: 0, medianPe: null, medianDe: null, rows: [] as typeof rows };
      cur.count++;
      cur.rows.push(r);
      bySector.set(r.sectorAr, cur);
    }
    for (const [k, v] of bySector) {
      v.medianPe = med(v.rows.map((r) => r.pe));
      v.medianDe = med(v.rows.map((r) => r.de));
      delete (v as { rows?: unknown }).rows;
      bySector.set(k, v);
    }

    const counts = {
      value: rows.filter((r) => r.quadrant === "value").length,
      leveraged: rows.filter((r) => r.quadrant === "leveraged").length,
      quality: rows.filter((r) => r.quadrant === "quality").length,
      expensive: rows.filter((r) => r.quadrant === "expensive").length,
    };

    const body = {
      asOf: new Date().toISOString(),
      total: rows.length,
      medianPe,
      medianDe,
      counts,
      quadrants: {
        value: { ar: "قيمة حقيقية", en: "Real value", hintAr: "مكرر منخفض وديون آمنة", hintEn: "low multiple, safe debt" },
        leveraged: { ar: "قيمة مثقلة بالديون", en: "Debt-heavy value", hintAr: "مخاطر فخ القيمة", hintEn: "value-trap risk" },
        quality: { ar: "نمو وجودة", en: "Growth & quality", hintAr: "ميزانية حصينة", hintEn: "clean balance sheet" },
        expensive: { ar: "تقييم متضخم", en: "Expensive", hintAr: "مكرر مرتفع وديون مرتفعة", hintEn: "high multiple AND high debt" },
      },
      sectors: [...bySector.values()].sort((a, b) => b.count - a.count),
      rows: rows.sort((a, b) => a.adjusted - b.adjusted),
    };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: "valuation map unavailable", detail: String((e as Error)?.message ?? e).slice(0, 120) }, { status: 502 });
  }
}
