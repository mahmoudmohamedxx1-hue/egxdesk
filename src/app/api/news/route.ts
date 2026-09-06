import { NextRequest, NextResponse } from "next/server";
import { fetchNews, sessionMeta } from "@/lib/market";
import { ensureNewsArchive, syncLiveNews, queryNews, archiveOldest } from "@/lib/news-archive";

export const dynamic = "force-dynamic";

/** GET /api/news?page=1&limit=40 — the FULL real news archive, newest →
 *  oldest: ~2,000 articles backfilled from the publishers' WordPress APIs
 *  plus the live RSS edge. `hasMore` drives the "load older" pager. */
export async function GET(req: NextRequest) {
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1) || 1);
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 40) || 40, 1), 100);
  try {
    const live = await fetchNews(); // RSS, 5-min cache
    await syncLiveNews(live); // keep the newest edge fresh
    // deep backfill (first call per process) — bounded wait, keeps filling in background
    await Promise.race([ensureNewsArchive(), new Promise((r) => setTimeout(r, 10_000))]);
    const [{ total, items }, oldest] = await Promise.all([queryNews(page, limit), archiveOldest()]);
    return NextResponse.json({
      session: sessionMeta(),
      total,
      page,
      limit,
      hasMore: page * limit < total,
      coverageFrom: oldest,
      shown: items.length,
      items,
    });
  } catch {
    return NextResponse.json({ error: "news feeds unavailable" }, { status: 502 });
  }
}
