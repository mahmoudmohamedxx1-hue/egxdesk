import { NextResponse } from "next/server";
import { makeRateLimiter } from "@/lib/rate-limit";
import { isValidEmail, sbRequestOtp, supabaseAuthConfigured } from "@/lib/supabase-auth";

/** POST /api/auth/supabase/request {email} — step 1 of Supabase auth: asks
 *  Supabase to email the 6-digit code (magic link also accepted at verify).
 *  Rate-limited per IP (5 / 10 min) — the honest free-tier email budget is
 *  Supabase's own ~2/hour, which the error message states verbatim. */

export const runtime = "nodejs";

const limited = makeRateLimiter(5, 10 * 60_000);

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (limited(ip)) {
    return NextResponse.json(
      { ok: false, error: "too many code requests — wait a few minutes" },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!supabaseAuthConfigured()) {
    return NextResponse.json(
      { ok: false, error: "supabase not configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  let email = "";
  try {
    const body = (await req.json()) as { email?: string };
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ ok: false, error: "invalid email address" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const r = await sbRequestOtp(email);
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, error: r.error, rateLimited: r.rateLimited },
      { status: r.rateLimited ? 429 : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { ok: true, emailSent: true, email },
    { headers: { "Cache-Control": "no-store" } },
  );
}
