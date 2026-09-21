import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

/** GET /api/watchlist — list the signed-in user's tickers. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "signed out" }, { status: 401 });
  }
  const items = await db.watchItem.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ tickers: items.map((i) => i.ticker) });
}

/**
 * PUT /api/watchlist — full-list sync.
 * Body: { tickers: string[] } — only the symbol is stored, nothing else.
 */
export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "signed out" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const raw = body.tickers;
  if (!Array.isArray(raw) || raw.length > 200 || raw.some((t: unknown) => typeof t !== "string" || t.length > 12)) {
    return NextResponse.json({ error: "tickers" }, { status: 400 });
  }
  const tickers = Array.from(
    new Set(raw.map((t: string) => t.trim().toUpperCase()).filter(Boolean))
  );

  await db.watchItem.deleteMany({ where: { userId: user.id } });
  if (tickers.length) {
    await db.watchItem.createMany({
      data: tickers.map((t) => ({ userId: user!.id, ticker: t })),
    });
  }
  return NextResponse.json({ tickers });
}
