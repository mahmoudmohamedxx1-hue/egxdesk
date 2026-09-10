import { NextResponse } from "next/server";
import { vapidPublicKey } from "@/lib/push";

/** GET /api/push/key — the VAPID public key clients need to subscribe
 *  (PushManager.subscribe applicationServerKey). The private half never
 *  leaves the server. */

export async function GET() {
  const publicKey = vapidPublicKey();
  if (!publicKey) {
    return NextResponse.json({ error: "push not configured" }, { status: 503 });
  }
  return NextResponse.json(
    { publicKey },
    { headers: { "Cache-Control": "no-store" } }
  );
}
