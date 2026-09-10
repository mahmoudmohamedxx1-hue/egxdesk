import { NextResponse } from "next/server";
import { evaluateDevices } from "@/lib/push";
import { makeRateLimiter } from "@/lib/rate-limit";

/** POST /api/push/run — force one evaluation pass NOW (the background loop
 *  also runs every 5 minutes). Useful right after enabling notifications and
 *  for smoke-testing; it is idempotent per alert (each notifies once).
 *  Rate-limited (Task 19 hardening): every pass fetches live quotes for all
 *  devices, so this unauthenticated endpoint must not be spammable. */

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
  const summary = await evaluateDevices();
  return NextResponse.json({ ok: true, ...summary }, { headers: { "Cache-Control": "no-store" } });
}
