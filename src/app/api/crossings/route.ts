import { NextResponse } from "next/server";
import { fetchUniverse } from "@/lib/market";
import { arName } from "@/lib/ar-names";
import { getEnrichedFeedCached, type NewsSnapshot } from "@/lib/news-sources";
import disclosuresDoc from "@/data/disclosures.json";
import snapshotDoc from "@/data/news-snapshot.json";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const snapshot = snapshotDoc as unknown as NewsSnapshot;

/** GET /api/crossings?days=4 — المستجدات → ربط النقاط (connecting the dots).
 *
 *  One company at a time, over the chosen window: how many NEWS items named
 *  it, how many FILINGS it deposited, and — when both are non-zero — the
 *  card says so and shows every piece of evidence with its source link.
 *
 *  The honesty rule cloned from the source model, verbatim in spirit:
 *  appearing in both feeds within the window does NOT establish that the
 *  news caused the filing or the move — the screen says so, permanently. */

type DisclosureItem = {
  id: string;
  title: string;
  date: string;
  link: string;
  tickers: string[];
  event: string;
  eventLabelAr: string;
  eventLabelEn: string;
};

const disclosures = disclosuresDoc as { asOf: string; count: number; items: DisclosureItem[] };

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 4) || 4, 1), 31);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

    const [feed, universe] = await Promise.all([
      getEnrichedFeedCached(
        async () => (await fetchUniverse()).map((s) => ({ ticker: s.ticker, name: s.name, volume: s.volume, avgVolume: s.avgVolume })),
        snapshot,
      ),
      fetchUniverse(),
    ]);

    // company directory (Arabic + English names for the cards)
    const byTicker = new Map(universe.map((s) => [s.ticker, s]));

    // news within the window that names a listed company
    type Ev = { kind: "news"; date: string; title: string; link: string; who: string };
    type Fe = { kind: "filing"; date: string; title: string; link: string; who: string; eventLabelAr: string; eventLabelEn: string };
    const newsByTicker = new Map<string, Ev[]>();
    for (const it of feed.items) {
      if (it.published.slice(0, 10) < cutoff) continue;
      for (const t of it.tickers) {
        const arr = newsByTicker.get(t) ?? [];
        arr.push({
          kind: "news",
          date: it.published.slice(0, 10),
          title: it.headline,
          link: it.link,
          who: it.sources[0]?.name ?? "",
        });
        newsByTicker.set(t, arr);
      }
    }
    // filings within the window
    const filingsByTicker = new Map<string, Fe[]>();
    for (const f of disclosures.items) {
      if (f.date < cutoff) continue;
      for (const t of f.tickers) {
        const arr = filingsByTicker.get(t) ?? [];
        arr.push({
          kind: "filing",
          date: f.date,
          title: f.title,
          link: f.link,
          who: "EGX",
          eventLabelAr: f.eventLabelAr,
          eventLabelEn: f.eventLabelEn,
        });
        filingsByTicker.set(t, arr);
      }
    }

    const tickers = new Set([...newsByTicker.keys(), ...filingsByTicker.keys()]);
    const companies = [...tickers]
      .map((t) => {
        const news = newsByTicker.get(t) ?? [];
        const filings = filingsByTicker.get(t) ?? [];
        const s = byTicker.get(t);
        const last = [...news, ...filings].sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? cutoff;
        return {
          ticker: t,
          nameAr: arName(t) ?? s?.name ?? t,
          nameEn: s ? s.name : t,
          newsCount: news.length,
          filingCount: filings.length,
          both: news.length > 0 && filings.length > 0,
          lastDate: last,
          news: news.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8),
          filings: filings.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8),
        };
      })
      // "both sources" first (that IS the screen's claim), then the busiest
      .sort((a, b) => Number(b.both) - Number(a.both) || b.newsCount + b.filingCount - (a.newsCount + a.filingCount) || a.ticker.localeCompare(b.ticker));

    const windowStart = [...disclosures.items, ...feed.items.map((x) => ({ date: x.published.slice(0, 10) }))]
      .map((x) => x.date)
      .filter((d) => d >= cutoff)
      .sort()
      .shift() ?? cutoff;

    return NextResponse.json({
      asOf: new Date().toISOString(),
      window: { days, start: windowStart, end: new Date().toISOString().slice(0, 10) },
      totals: {
        news: [...newsByTicker.values()].reduce((n, arr) => n + arr.length, 0),
        filings: [...filingsByTicker.values()].reduce((n, arr) => n + arr.length, 0),
        companies: companies.length,
        bothSources: companies.filter((c) => c.both).length,
      },
      companies: companies.slice(0, 80),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "crossings unavailable", detail: String((e as Error)?.message ?? e).slice(0, 120) },
      { status: 502 },
    );
  }
}
