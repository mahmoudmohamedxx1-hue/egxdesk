import { NextRequest, NextResponse } from "next/server";
import { fetchNews, sessionMeta } from "@/lib/market";

/** GET /api/news — live Egyptian market news from public RSS feeds.
 *  Query: limit (default 40). */
export async function GET(req: NextRequest) {
  try {
    const limit = Math.min(Number((req.nextUrl.searchParams.get("limit") ?? 40)) || 40, 100);
    const items = await fetchNews();
    return NextResponse.json({
      session: sessionMeta(),
      total: items.length,
      shown: Math.min(items.length, limit),
      items: items.slice(0, limit),
    });
  } catch {
    return NextResponse.json({ error: "news feeds unavailable" }, { status: 502 });
  }
}
