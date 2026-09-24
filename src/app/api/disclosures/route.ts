import { NextResponse } from "next/server";
import disclosures from "@/data/disclosures.json";

export const dynamic = "force-dynamic";

/** GET /api/disclosures — the filed-disclosures agenda behind المستجدات →
 *  الإفصاحات. Reads the archived EGX disclosure document (refreshed daily
 *  by the GitHub Action, merged by filing id so history accumulates) and
 *  serves the month strip + day counts + the filings themselves.
 *
 *  Every row links to the exchange's own bulletin page — the filing IS the
 *  source, exactly like the model this view follows. */

type Item = {
  id: string;
  title: string;
  titleEn: string | null;
  date: string;
  link: string;
  tickers: string[];
  event: string;
  eventLabelAr: string;
  eventLabelEn: string;
  meaningAr: string | null;
  meaningEn: string | null;
};

const doc = disclosures as { asOf: string; source: { nameAr: string; name: string; home: string }; count: number; items: Item[] };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const month = url.searchParams.get("month"); // "2026-09"
  const day = url.searchParams.get("day"); // "2026-09-24"
  const ticker = url.searchParams.get("ticker");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 60) || 60, 300);

  let items = doc.items;
  if (month) items = items.filter((x) => x.date.startsWith(month));
  if (day) items = items.filter((x) => x.date === day);
  if (ticker) items = items.filter((x) => x.tickers.includes(ticker));

  // month strip: every month present in the archive with its count
  const byMonth = new Map<string, number>();
  for (const x of doc.items) {
    const m = x.date.slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
  }

  // day grid for the requested (or newest) month
  const gridMonth = month ?? [...byMonth.keys()].sort().pop() ?? "";
  const byDay = new Map<string, number>();
  for (const x of doc.items) {
    if (x.date.startsWith(gridMonth)) byDay.set(x.date, (byDay.get(x.date) ?? 0) + 1);
  }

  return NextResponse.json({
    asOf: doc.asOf,
    source: doc.source,
    total: doc.count,
    months: [...byMonth.entries()].sort().map(([m, n]) => ({ month: m, count: n })),
    grid: { month: gridMonth, days: [...byDay.entries()].sort().map(([d, n]) => ({ day: d, count: n })) },
    shown: items.length,
    items: items.slice(0, limit),
    truncated: items.length > limit,
  });
}
