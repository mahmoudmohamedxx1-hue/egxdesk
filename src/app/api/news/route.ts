import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/news — the news feed.
 * Query: limit (default 40), offset.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit") ?? 40) || 40, 100);
  const offset = Math.max(Number(sp.get("offset") ?? 0) || 0, 0);

  const [items, total] = await Promise.all([
    db.newsItem.findMany({
      orderBy: { publishedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    db.newsItem.count(),
  ]);

  return NextResponse.json({
    total,
    shown: items.length,
    items: items.map((n) => ({
      id: n.id,
      title: n.titleAr,
      impact: n.impactAr,
      publisher: n.publisherAr,
      category: n.categoryAr,
      publishedAt: n.publishedAt,
      sourceUrl: n.sourceUrl,
    })),
  });
}
