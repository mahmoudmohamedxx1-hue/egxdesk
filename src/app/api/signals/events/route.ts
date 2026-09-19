import { NextResponse } from "next/server";
import { eventsSince } from "@/lib/signal-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/signals/events?since=<ISO>&limit=<n> — the LIVE signal stream
 *  (Task 44): new picks, market-bias reads, tracked outcomes (target /
 *  stop / expiry of published signals against the real tape) and the daily
 *  self-validation check. Public, free, read-only — the same shared events
 *  the AI-signals panel's live feed renders and opted-in devices receive
 *  as push notifications. `since` enables incremental polling (the client
 *  keeps a cursor); without it the newest `limit` events are served. */

export async function GET(req: Request) {
  const url = new URL(req.url);
  const since = url.searchParams.get("since");
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 40;
  try {
    const events = await eventsSince(since, limit);
    return NextResponse.json(
      {
        ok: true,
        serverTime: new Date().toISOString(),
        count: events.length,
        events,
      },
      { headers: { "Cache-Control": "no-store" } } // live stream — never cached
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "signal events unavailable", detail: err instanceof Error ? err.message : "unknown" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
