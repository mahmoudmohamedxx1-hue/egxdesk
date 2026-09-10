import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { APP_VERSION, BUILD_DATE } from "@/lib/version";

/** GET /api/health — liveness probe (Task 19): app version + SQLite
 *  reachability + process uptime. Market-data routes do not depend on the
 *  db (only chats / push / usage do), so ok stays true with db:"down" —
 *  that field is the detail to watch. */

export const runtime = "nodejs";

export async function GET() {
  let dbUp = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {}
  return NextResponse.json(
    {
      ok: true,
      version: APP_VERSION,
      build: BUILD_DATE,
      db: dbUp ? "up" : "down",
      uptimeSec: Math.round(process.uptime()),
      ts: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
