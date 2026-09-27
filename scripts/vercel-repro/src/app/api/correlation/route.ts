import { NextResponse } from "next/server";
import { fetchUniverse } from "@/lib/market";
import { fetchStockChart } from "@/lib/history";

/** GET /api/correlation — مصفوفة الارتباط (T57, foudalens parity).
 *
 *  Pearson correlation of DAILY RETURNS between the most-liquid EGX stocks
 *  over the requested window (default 6 months, max ~14 symbols so the grid
 *  stays readable and the upstream fetches bounded). Every series comes
 *  from the app's real price-history layer (Yahoo Finance daily candles,
 *  the same data the charts use) — aligned by date, returns computed on the
 *  intersection, pairs with < 30 overlapping sessions report null instead
 *  of a noisy number. */

export const dynamic = "force-dynamic";

function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 30) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, dbb = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma, xb = b[i] - mb;
    num += xa * xb; da += xa * xa; dbb += xb * xb;
  }
  const den = Math.sqrt(da * dbb);
  return den > 0 ? num / den : null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const months = Math.min(12, Math.max(1, Number(url.searchParams.get("months") ?? 6) || 6));
    const range = months <= 1 ? "1M" : months <= 3 ? "3M" : months <= 6 ? "6M" : months <= 12 ? "1Y" : "6M";
    const asked = (url.searchParams.get("symbols") ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""))
      .filter(Boolean)
      .slice(0, 14);

    const stocks = await fetchUniverse();
    const symbols =
      asked.length >= 2
        ? asked
        : [...stocks]
            .filter((s) => s.valueTraded > 0)
            .sort((a, b) => b.valueTraded - a.valueTraded)
            .slice(0, 12)
            .map((s) => s.ticker);

    const series: { ticker: string; byDate: Map<string, number> }[] = [];
    for (const t of symbols) {
      try {
        const chart = await fetchStockChart(t, range as "1M" | "3M" | "6M" | "1Y");
        const daily = chart.points.filter((p) => p.close > 0 && !p.live && /^\d{4}-\d{2}-\d{2}$/.test(p.date));
        if (daily.length >= 30) series.push({ ticker: t, byDate: new Map(daily.map((p) => [p.date, p.close])) });
      } catch {
        // one dead series never kills the matrix
      }
    }

    // per-symbol daily-return sequences keyed by date, intersected pairwise below
    const retByDate: { ticker: string; m: Map<string, number> }[] = series.map((s) => {
      const dates = [...s.byDate.keys()].sort();
      const m = new Map<string, number>();
      for (let i = 1; i < dates.length; i++) {
        const prev = s.byDate.get(dates[i - 1]) as number;
        const cur = s.byDate.get(dates[i]) as number;
        if (prev > 0 && cur > 0) m.set(dates[i], cur / prev - 1);
      }
      return { ticker: s.ticker, m };
    });
    const allDates = [...new Set(series.flatMap((s) => [...s.byDate.keys()]))].sort();

    const tickers = retByDate.map((s) => s.ticker);

    const matrix: (number | null)[][] = retByDate.map((a) =>
      retByDate.map((b) => {
        if (a.ticker === b.ticker) return 1;
        const dates = [...a.m.keys()].filter((d) => b.m.has(d));
        return pearson(dates.map((d) => a.m.get(d) as number), dates.map((d) => b.m.get(d) as number));
      })
    );

    const from = allDates[0] ?? null;
    const to = allDates[allDates.length - 1] ?? null;

    return NextResponse.json(
      {
        ok: true,
        months,
        range,
        from,
        to,
        symbols: tickers,
        matrix,
        noteAr:
          "ارتباط بيرسون للعوائد اليومية محسوب من إغلاقات حقيقية (نفس بيانات الرسوم البيانية) — الخلايا الفارغة تعني أقل من ٣٠ جلسة مشتركة.",
        noteEn:
          "Pearson correlation of daily returns computed from real closes (the same data the charts use) — empty cells mean fewer than 30 overlapping sessions.",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "correlation unavailable", detail: err instanceof Error ? err.message : "unknown" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
