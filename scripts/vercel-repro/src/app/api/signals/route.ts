import { NextResponse } from "next/server";
import { scanSignals, reblendNews } from "@/lib/signals-scan";
import { fetchUniverse } from "@/lib/market";

/** GET /api/signals — the cross-market COMPOSITE scan, ranked best-to-worst
 *  by 45% technical + 30% fundamental + 25% news. Technical fields are
 *  computed from daily candles (scan cached ~1h, pre-warmed at boot);
 *  fundamental fields from the TradingView scanner snapshot with sector
 *  medians; the news pillar from a rule-based lexicon over the last 14
 *  days of the archived Egyptian press — re-blended at SERVE TIME with a
 *  fresh press pass (≤10 min stale) so news never lags the scan cache;
 *  the quote block (close/change/volume) is merged FRESH from the universe
 *  snapshot so the tab never shows an hour-old price. */

export async function GET() {
  try {
    const [scan, universe] = await Promise.all([scanSignals(), fetchUniverse()]);
    // serve-time news re-blend — the press pillar stays minute-level even
    // while technicals/fundamentals ride the hourly scan cache
    const reblended = await reblendNews(scan.rows, universe);
    const fresh = new Map(universe.map((s) => [s.ticker, s] as const));
    const rows = reblended.map((r) => {
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
        pb: f.pb,
        roe: f.roe,
        volRatio: f.avgVolume && f.avgVolume > 0 ? Number((f.volume / f.avgVolume).toFixed(2)) : null,
      };
    });
    return NextResponse.json(
      {
        asOf: scan.asOf,
        scanned: scan.scanned,
        failed: scan.failed,
        rows,
        source: "Yahoo Finance 1Y daily candles + TradingView universe (delayed ~15 min) + Alborsaanews/Amwal Alghad press archive",
        note: "Composite rating = 45% technical (13 indicators: SMA/EMA/RSI/Stoch/MACD/CCI/Momentum/Williams%R/BBPower) + 30% fundamental (P/E & P/B vs sector medians, ROE, net margin, debt/equity, dividend yield & payout) + 25% news (rule-based lexicon over 14 days of press, recency-weighted). Missing pillars renormalize honestly. Statistical description of price action, reported financials and press tone, not investment advice.",
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
