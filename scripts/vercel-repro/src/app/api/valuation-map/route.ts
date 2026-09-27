import { NextResponse } from "next/server";
import { fetchUniverse } from "@/lib/market";
import { arName, arCompanySector } from "@/lib/ar-names";
import { sectorStatsMap, marketStats, statsFor } from "@/lib/fundamentals";
import { fetchRates } from "@/lib/rates";
import {
  computeFv,
  debtZone,
  DEFAULT_FV_ASSUMPTIONS,
  DEFAULT_FV_WEIGHTS,
  type FvAssumptions,
} from "@/lib/fair-value";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/valuation-map — التقييم والديون (valuation & debt) + القيمة
 *  العادلة (fair value), one payload for the whole section:
 *
 *  MAP (as before): every listed company with a published P/E and D/E placed
 *  on the 2D map — x = P/E, y = D/E, bubble = market cap, four reading
 *  quadrants, plus the debt-adjusted multiple P/E × (1 + D/E).
 *
 *  FAIR VALUE (T64): the five-model engine from lib/fair-value runs on every
 *  stock — peer P/E, peer P/B, Graham number, Gordon DDM and justified P/B,
 *  blended with renormalized weights, coverage and verdict — so the map can
 *  color by upside and the cheap-stocks screen can rank by it. The
 *  assumptions block ships with the payload: rf anchored to the CBE policy
 *  rate (fallback 19.5% when the rates layer is unreachable), ERP 8%, beta
 *  from the scanner, growth from ROE × retention capped at 12%.
 *
 *  DEBT (improved): every row carries net debt, net debt / market cap and a
 *  five-zone debt reading (net cash · safe · moderate · elevated · high).
 *
 *  Honesty rules unchanged: no point is invented to fill a sector — rows
 *  without a published field keep it null and the models that need it drop
 *  out with their coverage reported. */

const CACHE_MS = 300_000;
let cache: { at: number; body: unknown } | null = null;

type Row = Record<string, unknown> & { sectorAr: string };

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) return NextResponse.json(cache.body);
  try {
    const [universe, rates] = await Promise.all([
      fetchUniverse(),
      fetchRates().catch(() => null),
    ]);

    const policyRate = rates?.rows.find((r) => r.key === "policy")?.value ?? null;
    const assumptions: FvAssumptions = {
      ...DEFAULT_FV_ASSUMPTIONS,
      rf: policyRate ?? DEFAULT_FV_ASSUMPTIONS.rf,
    };

    const bySector = sectorStatsMap(universe);
    const market = marketStats(universe);

    const med = (xs: number[]): number | null => {
      if (!xs.length) return null;
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };

    const rows: Row[] = universe.map((s) => {
      const stats = statsFor(s, bySector, market);
      const pe = s.pe != null && s.pe > 0 ? s.pe : null;
      const de = s.debtToEquity != null && s.debtToEquity >= 0 ? s.debtToEquity : null;
      const close = s.close > 0 ? s.close : null;
      const bvps = close != null && s.pb != null && s.pb > 0 ? close / s.pb : null;
      const dps = close != null && s.divYield != null && s.divYield > 0 ? (s.divYield / 100) * close : null;
      const sector = s.sector || "Unclassified";

      const fv = computeFv(
        {
          price: close,
          eps: s.eps != null && s.eps > 0 ? s.eps : null,
          bvps,
          dps,
          payout: s.payoutRatio != null && s.payoutRatio >= 0 ? s.payoutRatio : null,
          roe: s.roe,
          beta: s.beta,
          gRevQ: s.revenueGrowthQ,
          sectorPe: stats.pe,
          sectorPb: stats.pb,
          pe: s.pe,
          pb: s.pb,
        },
        assumptions
      );

      return {
        ticker: s.ticker,
        nameAr: arName(s.ticker) ?? s.name,
        nameEn: s.name,
        sector,
        sectorAr: arCompanySector(s.ticker) ?? sector,
        close,
        pe,
        de,
        eps: s.eps != null && Number.isFinite(s.eps) ? s.eps : null,
        marketCap: s.marketCap,
        adjusted: pe != null && de != null ? pe * (1 + de) : null,
        quadrant: pe != null && de != null ? (pe <= 15 && de <= 1 ? "value" : pe <= 15 ? "leveraged" : de <= 1 ? "quality" : "expensive") : null,
        // extended fundamentals (all nullable — never invented)
        pb: s.pb != null && s.pb > 0 ? s.pb : null,
        roe: s.roe,
        divYield: s.divYield,
        payout: s.payoutRatio,
        dps,
        bvps,
        beta: s.beta,
        gRevQ: s.revenueGrowthQ,
        netDebt: s.netDebt,
        netIncomeTTM: s.netIncomeTTM,
        netDebtToCap: s.netDebt != null && s.marketCap != null && s.marketCap > 0 ? s.netDebt / s.marketCap : null,
        debtZone: debtZone(de, s.netDebt),
        sectorPe: stats.pe,
        sectorPb: stats.pb,
        sectorRoe: stats.roe,
        // fair value (T64)
        fv: fv.blend,
        upside: fv.upside,
        fvCoverage: fv.coverage,
        verdict: fv.verdict,
        fvR: fv.r,
        fvG: fv.g,
        models: {
          multPe: fv.models.find((m) => m.id === "multPe")?.value ?? null,
          multPb: fv.models.find((m) => m.id === "multPb")?.value ?? null,
          graham: fv.models.find((m) => m.id === "graham")?.value ?? null,
          ddm: fv.models.find((m) => m.id === "ddm")?.value ?? null,
          justifiedPb: fv.models.find((m) => m.id === "justifiedPb")?.value ?? null,
        },
      };
    });

    // map-eligible set: a published P/E and D/E (the 2D map never invents a point)
    const mapRows = rows.filter((r) => r.pe != null && r.de != null);
    const medianPe = med(mapRows.map((r) => r.pe as number));
    const medianDe = med(mapRows.map((r) => r.de as number));

    // group sectors by their ARABIC label — two TradingView keys can render
    // one Arabic label, and the filter chips must never show it twice
    const bySectorAr = new Map<string, { sector: string; sectorAr: string; count: number; medianPe: number | null; medianDe: number | null; medianPb: number | null; medianRoe: number | null }>();
    for (const r of mapRows) {
      const cur = bySectorAr.get(r.sectorAr) ?? { sector: r.sector as string, sectorAr: r.sectorAr, count: 0, medianPe: null, medianDe: null, medianPb: null, medianRoe: null };
      cur.count++;
      bySectorAr.set(r.sectorAr, cur);
    }
    const secRows = new Map<string, Row[]>();
    for (const r of mapRows) {
      const arr = secRows.get(r.sectorAr) ?? [];
      arr.push(r);
      secRows.set(r.sectorAr, arr);
    }
    for (const [k, v] of bySectorAr) {
      const rs = secRows.get(k) ?? [];
      v.medianPe = med(rs.map((r) => r.pe as number));
      v.medianDe = med(rs.map((r) => r.de as number));
      v.medianPb = med(rs.map((r) => (r.pb != null ? (r.pb as number) : NaN)).filter(Number.isFinite));
      v.medianRoe = med(rs.map((r) => (r.roe != null ? (r.roe as number) : NaN)).filter(Number.isFinite));
      bySectorAr.set(k, v);
    }

    const counts = {
      value: mapRows.filter((r) => r.quadrant === "value").length,
      leveraged: mapRows.filter((r) => r.quadrant === "leveraged").length,
      quality: mapRows.filter((r) => r.quadrant === "quality").length,
      expensive: mapRows.filter((r) => r.quadrant === "expensive").length,
    };

    const withFv = rows.filter((r) => r.fv != null);
    const fvStats = {
      withFv: withFv.length,
      cheap: withFv.filter((r) => r.verdict === "cheap").length,
      fair: withFv.filter((r) => r.verdict === "fair").length,
      rich: withFv.filter((r) => r.verdict === "rich").length,
      medianUpside: med(withFv.map((r) => r.upside as number).filter((v) => Number.isFinite(v))),
    };

    const body = {
      asOf: new Date().toISOString(),
      total: mapRows.length,
      medianPe,
      medianDe,
      counts,
      quadrants: {
        value: { ar: "قيمة حقيقية", en: "Real value", hintAr: "مكرر منخفض وديون آمنة", hintEn: "low multiple, safe debt" },
        leveraged: { ar: "قيمة مثقلة بالديون", en: "Debt-heavy value", hintAr: "مخاطر فخ القيمة", hintEn: "value-trap risk" },
        quality: { ar: "نمو وجودة", en: "Growth & quality", hintAr: "ميزانية حصينة", hintEn: "clean balance sheet" },
        expensive: { ar: "تقييم متضخم", en: "Expensive", hintAr: "مكرر مرتفع وديون مرتفعة", hintEn: "high multiple AND high debt" },
      },
      sectors: [...bySectorAr.values()].sort((a, b) => b.count - a.count),
      assumptions: {
        rf: assumptions.rf,
        rfSource: policyRate != null ? "CBE policy rate via Trading Economics" : "fallback — rates layer unreachable",
        erp: assumptions.erp,
        gCap: assumptions.gCap,
        spreadMin: assumptions.spreadMin,
        mos: assumptions.mos,
        weights: DEFAULT_FV_WEIGHTS,
        note: "r = rf + β × ERP · g = ROE × (1 − payout), capped · weights renormalize over available models",
      },
      fvStats,
      rows: rows.sort((a, b) => String(a.ticker).localeCompare(String(b.ticker))),
    };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: "valuation map unavailable", detail: String((e as Error)?.message ?? e).slice(0, 120) }, { status: 502 });
  }
}
