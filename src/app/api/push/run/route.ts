import { NextResponse } from "next/server";
import { evaluateDevices } from "@/lib/push";

/** POST /api/push/run — force one evaluation pass NOW (the background loop
 *  also runs every 5 minutes). Useful right after enabling notifications and
 *  for smoke-testing; it is idempotent per alert (each notifies once). */

export async function POST() {
  const summary = await evaluateDevices();
  return NextResponse.json(
    { ok: true, ...summary },
    { headers: { "Cache-Control": "no-store" } }
  );
}
