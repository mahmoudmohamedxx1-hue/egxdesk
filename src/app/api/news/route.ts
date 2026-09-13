import { NextRequest, NextResponse } from "next/server";
import { fetchNews, sessionMeta, fetchUniverse } from "@/lib/market";
import { ensureNewsArchive, syncLiveNews, queryNews, archiveOldest } from "@/lib/news-archive";
import { scoreSentiment, tickersInText } from "@/lib/sentiment";
import { AR_ALIASES } from "@/lib/ar-search";

export const dynamic = "force-dynamic";

/** GET /api/news?page=1&limit=40 — the FULL real news archive, newest →
 *  oldest: ~2,000 articles backfilled from the publishers' WordPress APIs
 *  plus the live RSS edge. `hasMore` drives the "load older" pager.
 *  T26: each item carries a rule-based sentiment chip (bilingual finance
 *  lexicon on title+snippet — labeled as linguistic analysis, not AI) and
 *  the EGX tickers it plausibly mentions (matched against the live
 *  universe, clickable in the UI). */
export async function GET(req: NextRequest) {
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1) || 1);
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 40) || 40, 1), 100);
  try {
    const live = await fetchNews(); // RSS, 5-min cache
    await syncLiveNews(live); // keep the newest edge fresh
    // deep backfill (first call per process) — bounded wait, keeps filling in background
    await Promise.race([ensureNewsArchive(), new Promise((r) => setTimeout(r, 10_000))]);
    const [{ total, items }, oldest] = await Promise.all([queryNews(page, limit), archiveOldest()]);
    // T26 sentiment + ticker attribution (universe is 60s-cached server-side)
    let universe: { ticker: string; name: string }[] = [];
    try {
      universe = (await fetchUniverse()).map((s) => ({ ticker: s.ticker, name: s.name }));
    } catch {
      /* chips simply omit tickers on a universe hiccup */
    }
    const enriched = items.map((n: { title: string; snippet?: string | null }) => {
      const { sentiment } = scoreSentiment(n.title, (n as { snippet?: string | null }).snippet ?? null);
      const tickers = universe.length
        ? tickersInText(`${n.title} ${(n as { snippet?: string | null }).snippet ?? ""}`, universe, AR_ALIASES)
        : [];
      return { ...n, sentiment, tickers };
    });
    return NextResponse.json({
      session: sessionMeta(),
      total,
      page,
      limit,
      hasMore: page * limit < total,
      coverageFrom: oldest,
      shown: enriched.length,
      items: enriched,
    });
  } catch {
    return NextResponse.json({ error: "news feeds unavailable" }, { status: 502 });
  }
}
