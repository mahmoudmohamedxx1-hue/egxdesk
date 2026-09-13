import { NextResponse } from "next/server";
import { fetchUniverse, fetchIndices, type Stock } from "@/lib/market";
import { fetchRates } from "@/lib/rates";
import { fetchEconomy } from "@/lib/economy";
import { indexHistory } from "@/lib/flows";

export const dynamic = "force-dynamic";

/** GET /api/funds — the funds & fixed-income view payload (T26):
 *  1. EGX30 ETF card: verified price snapshot (dated + sourced — no free
 *     live feed serves the fund's tape) + the LIVE underlying index stats
 *     and daily history we already serve.
 *  2. Listed closed-end funds: filtered from the live TradingView universe
 *     (real quotes, ~15-min delayed).
 *  3. The saver's table: live CBE policy/interbank rates, gold 21k gram,
 *     USD/EGP, and real EGX 30 YTD/1Y performance.
 *  No auth, no mock data — anything not live is explicitly labeled. */

// Verified snapshot (Investing.com quote captured by our 2026-09-13 research
// pass; displayed with its date + source, never as a live price).
const ETF_SNAPSHOT = { price: 64.2, date: "2026-09-12", source: "Investing.com" };

// Factual reference entries for Egypt's open-ended fund landscape. NOT
// priced here — names/managers only, honestly labeled (see fundsNoLiveNav).
const FUND_FAMILIES = [
  { nameEn: "Azimut Egypt (money market & cash funds)", nameAr: "أزيوت مصر (صناديق نقدية)" },
  { nameEn: "CI Capital Asset Management", nameAr: "سي كابيتال لإدارة الأصول" },
  { nameEn: "Naeem Brokerage / Naeem Funds", nameAr: "نعيم للسمسرة / صناديق نعيم" },
  { nameEn: "Beltone Asset Management", nameAr: "بلتون لإدارة الأصول" },
  { nameEn: "Al Ahly Pharos", nameAr: "البنك الأهلي فاروس" },
];

export async function GET() {
  try {
    const [stocks, indices, rates, econ] = await Promise.all([
      fetchUniverse().catch(() => [] as Stock[]),
      fetchIndices().catch(() => [] as ReturnType<typeof fetchIndices> extends Promise<(infer T)[]> ? T[] : never),
      fetchRates().catch(() => null),
      fetchEconomy().catch(() => null),
    ]);

    // EGX30 live stats + real daily history for the sparkline
    const egx30 = indices.find((i) => i.code === "EGX30") ?? null;
    let history: { date: string; close: number }[] = [];
    try {
      history = await indexHistory(180, "egx30");
    } catch {
      history = [];
    }

    // listed closed-end funds: real fund-named instruments in the live universe
    const listedFunds = stocks
      .filter((s) => /fund/i.test(s.name))
      .map((s) => ({
        ticker: s.ticker,
        name: s.name,
        close: s.close,
        changePct: s.changePct,
        volume: s.volume,
        valueTraded: s.valueTraded,
      }));

    const policy = rates?.rows.find((r) => r.key === "policy") ?? null;
    const interbank = rates?.rows.find((r) => r.key === "interbank") ?? null;

    return NextResponse.json({
      etf: {
        snapshot: ETF_SNAPSHOT,
        underlying: egx30
          ? {
              code: egx30.code,
              nameAr: egx30.nameAr,
              nameEn: egx30.name,
              close: egx30.close,
              changePct: egx30.changePct,
              perfYTD: egx30.perfYTD,
              perf1Y: egx30.perfY,
              perf6M: egx30.perf6M,
              perf1M: egx30.perf1M,
            }
          : null,
        history: history.map((h) => ({ date: h.date, close: h.close })),
      },
      listedFunds,
      families: FUND_FAMILIES,
      saver: {
        policy: policy ? { value: policy.value, reference: policy.reference } : null,
        interbank: interbank ? { value: interbank.value, reference: interbank.reference } : null,
        gold21: econ?.gold?.egpPerGram21 ?? null,
        usd: econ?.fx?.find((f) => f.code === "USD")?.egpPer ?? null,
        egx30Ytd: egx30?.perfYTD ?? null,
        egx301Y: egx30?.perfY ?? null,
      },
      sourceNotes: {
        etf: "Verified snapshot — no free live feed serves the EGX30 ETF tape; the underlying index IS live with us",
        funds: "TradingView live universe (~15-min delayed)",
        saver: "CBE rates, live gold/FX, real index performance",
      },
    });
  } catch {
    return NextResponse.json({ error: "funds view unavailable" }, { status: 502 });
  }
}
