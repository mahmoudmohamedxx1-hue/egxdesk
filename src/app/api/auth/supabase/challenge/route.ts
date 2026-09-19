import { NextResponse } from "next/server";
import { issueChallenge, looksLikeBot } from "@/lib/auth-security";

/** GET /api/auth/supabase/challenge — T48 anti-bot pre-flight.
 *
 *  Every POST to the auth routes must first fetch this and echo the token
 *  back. The token is an HMAC bound to the caller's IP + User-Agent with a
 *  15-minute expiry and single-use per endpoint — a scripted client that
 *  just replays a POST (curl / python-requests / an AI agent calling raw
 *  fetch) never gets past it, because it also has to look like a real
 *  browser (the UA gate here refuses the scripted ones first). */

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ua = req.headers.get("user-agent");
  if (looksLikeBot(ua)) {
    return NextResponse.json(
      { ok: false, error: "automated clients are not allowed on the sign-in endpoints" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const { token, expiresInSeconds } = issueChallenge(ip, ua);
  return NextResponse.json(
    { ok: true, token, expiresInSeconds },
    { headers: { "Cache-Control": "no-store" } },
  );
}
