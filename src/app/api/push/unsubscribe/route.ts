import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** POST /api/push/unsubscribe — stop notifying this device (user turned
 *  phone notifications off, or unsubscribed from the browser). */

export async function POST(req: Request) {
  let body: { deviceId?: unknown };
  try {
    body = (await req.json()) as { deviceId?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.slice(0, 128) : "";
  if (!deviceId) {
    return NextResponse.json({ error: "deviceId required" }, { status: 400 });
  }
  // endpoint row may also be addressed directly (subscription churn)
  await db.pushDevice.deleteMany({ where: { deviceId } });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
