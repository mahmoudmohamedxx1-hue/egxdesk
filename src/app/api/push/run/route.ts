import { NextResponse } from "next/server";
import { evaluateDevices, pushWatchlistNews, pushWatchlistMoves } from "@/lib/push";
import { makeRateLimiter } from "@/lib/rate-limit";

/** POST /api/push/run — force one evaluation pass NOW (the background loop
 *  also runs every 5 minutes; a GitHub Actions heartbeat calls this every
 *  5 minutes on hosts where the loop cannot live, e.g. Vercel serverless).
 *  Useful right after enabling notifications and for smoke-testing; it is
 *  idempotent per alert (each notifies once) and per move-band (state
 *  persists in PushDevice.movesJson).
 *  T69 — a "pass" means the FULL push engine: personal price alerts AND
 *  the favorites pipeline (fresh news naming a favorite).
 *  T70 — plus the 0.5% step-move engine (per-stock notifications for every
 *  0.5% up/down vs previous close, session-gated). Rate-limited (Task 19
 *  hardening, T70 raised 6→24/hour for the heartbeat cadence): every pass
 *  fetches live quotes + the news feed, so this unauthenticated endpoint
 *  must not be spammable. */

const limited = makeRateLimiter(24, 60 * 60_000); // 24 manual passes/hour per IP

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";
  if (limited(ip)) {
    return NextResponse.json(
      { error: "rate limited — try again later" },
      { status: 429, headers: { "Cache-Control": "no-store" } }
    );
  }
  const alerts = await evaluateDevices();
  const favorites = await pushWatchlistNews();
  const moves = await pushWatchlistMoves();
  return NextResponse.json(
    {
      ok: true,
      ...alerts,
      favorites: { devices: favorites.devices, notified: favorites.notified },
      moves: { devices: moves.devices, notified: moves.notified },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
