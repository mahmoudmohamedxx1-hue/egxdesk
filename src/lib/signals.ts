/** Company "signals-lite" engine — computed only from real data we already
 *  hold (no speculation):
 *    - price streaks: consecutive up/down closes from Yahoo daily candles
 *    - next earnings date: TradingView's scheduled-release epoch
 *    - unusual volume: session volume vs 10-session average
 *    - 52-week position: distance from the extremes
 *  Plus a news-derived disclosure log (Arabic press reports of filings,
 *  dividends, AGMs — labeled as press coverage, not the official archive).
 */

import { fetchStockChart } from "@/lib/history";
import type { Stock } from "@/lib/market";

export type CompanySignals = {
  streak: { direction: "up" | "down"; count: number; since: string } | null;
  nextEarnings: string | null; // ISO date
  unusualVolume: boolean;
  volumeRatio: number | null;
  near52High: boolean;
  near52Low: boolean;
  computedFrom: string;
};

export async function computeSignals(stock: Stock): Promise<CompanySignals> {
  // streaks need daily candles — 1M is enough; cache shared with charts
  let streak: CompanySignals["streak"] = null;
  try {
    const chart = await fetchStockChart(stock.ticker, "1M");
    const pts = chart.points;
    if (pts.length >= 3) {
      const lastClose = pts[pts.length - 1].close;
      let dir: "up" | "down" | null = null;
      let count = 0;
      for (let i = pts.length - 1; i > 0; i--) {
        const diff = pts[i].close - pts[i - 1].close;
        if (diff === 0) break;
        const d = diff > 0 ? "up" : "down";
        if (dir === null) {
          dir = d;
          count = 1;
        } else if (d === dir) {
          count++;
        } else {
          break;
        }
        if (count >= 8) break;
      }
      if (dir && count >= 3) {
        streak = { direction: dir, count, since: pts[pts.length - count].date };
      }
      void lastClose;
    }
  } catch {
    // Yahoo hiccup — signals degrade gracefully, no fake streaks
  }

  const volumeRatio = stock.avgVolume && stock.avgVolume > 0 ? stock.volume / stock.avgVolume : null;

  const near52High =
    stock.high52 !== null && stock.close > 0 ? stock.close >= stock.high52 * 0.97 : false;
  const near52Low =
    stock.low52 !== null && stock.close > 0 ? stock.close <= stock.low52 * 1.03 : false;

  return {
    streak,
    nextEarnings:
      stock.nextEarnings && stock.nextEarnings > 1.7e9
        ? new Date(stock.nextEarnings * 1000).toISOString().slice(0, 10)
        : null,
    unusualVolume: volumeRatio !== null && volumeRatio >= 2,
    volumeRatio,
    near52High,
    near52Low,
    computedFrom: "Yahoo Finance daily candles + TradingView scanner",
  };
}

/** Disclosure-keyword filter for the news archive (press coverage of
 *  filings/dividends/AGMs — real articles, honestly labeled). */
export const DISCLOSURE_RE =
  /إفصاح|إفصاحات|العمومية|عمومية|توزيعات|كوبون|القوائم المالية|قوائم مالية|نتائج أعمال|أرباح|نصف سنوية|ربع سنوية|تأسيس|زيادة رأس المال|اكتتاب|تغيرات جوهرية|صفقة|بيع أصل|شراء|استحواذ|مجلس الإدارة|بند|إدراج|شطب/i;
