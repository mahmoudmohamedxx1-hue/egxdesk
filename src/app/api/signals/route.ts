import { NextResponse } from "next/server";
import { scanSignals } from "@/lib/signals-scan";
import { fetchUniverse } from "@/lib/market";

/** GET /api/signals — the cross-market technical scan, ranked best-to-worst
 *  by the 13-indicator aggregate score. Indicator fields are computed from
 *  daily candles (scan cached ~1h, pre-warmed at boot); the quote block
 *  (close/change/volume) is merged FRESH from the universe snapshot so the
 *  tab never shows an hour-old price. */

export async function GET() {
  try {
    const [scan, universe] = await Promise.all([scanSignals(), fetchUniverse()]);
    const fresh = new Map(universe.map((s) => [s.ticker, s] as const));
    const rows = scan.rows.map((r) => {
      const f = fresh.get(r.ticker);
      if (!f) return r;
      return {
        ...r,
        close: f.close,
        changePct: f.changePct,
        volume: f.volume,
        valueTraded: f.valueTraded,
        marketCap: f.marketCap,
        pe: f.pe,
        divYield: f.divYield,
        volRatio: f.avgVolume && f.avgVolume > 0 ? Number((f.volume / f.avgVolume).toFixed(2)) : null,
      };
    });
    return NextResponse.json(
      {
        asOf: scan.asOf,
        scanned: scan.scanned,
        failed: scan.failed,
        rows,
        source: "Yahoo Finance 1Y daily candles + TradingView universe (delayed ~15 min)",
        note: "13-indicator technical rating (SMA/EMA/RSI/Stoch/MACD/CCI/Momentum/Williams%R/BBPower) — statistical description of price action, not investment advice.",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: "signals unavailable", detail: err instanceof Error ? err.message : String(err) },
      { status: 503 }
    );
  }
}
