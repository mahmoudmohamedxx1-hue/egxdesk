import { NextResponse } from "next/server";
import { evaluateDevices, pushWatchlistNews } from "@/lib/push";
import { makeRateLimiter } from "@/lib/rate-limit";

/** POST /api/push/run — force one evaluation pass NOW (the background loop
 *  also runs every 5 minutes). Useful right after enabling notifications and
 *  for smoke-testing; it is idempotent per alert (each notifies once).
 *  T69 — a "pass" now means the FULL push engine: personal price alerts AND
 *  the favorites pipeline (fresh news naming a favorite + significant
 *  same-session moves). Rate-limited (Task 19 hardening): every pass fetches
 *  live quotes + the news feed, so this unauthenticated endpoint must not be
 *  spammable. */

const limited = makeRateLimiter(6, 60 * 60_000); // 6 manual passes/hour per IP

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
  return NextResponse.json(
    {
      ok: true,
      ...alerts,
      favorites: { devices: favorites.devices, notified: favorites.notified },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
