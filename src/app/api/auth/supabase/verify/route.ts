import { NextResponse } from "next/server";
import { makeRateLimiter } from "@/lib/rate-limit";
import {
  SB_SESSION_COOKIE,
  encodeSbSession,
  isValidEmail,
  sbSessionCookieOptions,
  sbVerifyOtp,
  supabaseAuthConfigured,
} from "@/lib/supabase-auth";

/** POST /api/auth/supabase/verify {email, code} — step 2: verifies the
 *  6-digit code (or a pasted magic-link URL / token_hash) against Supabase
 *  and, on success, sets the HttpOnly session cookie. The tokens NEVER
 *  reach the browser — only {id, email} does. Rate-limited 10 / 10 min. */

export const runtime = "nodejs";

const limited = makeRateLimiter(10, 10 * 60_000);

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (limited(ip)) {
    return NextResponse.json({ ok: false, error: "too many attempts — wait a few minutes" }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  if (!supabaseAuthConfigured()) {
    return NextResponse.json({ ok: false, error: "supabase not configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  let email = "";
  let code = "";
  try {
    const body = (await req.json()) as { email?: string; code?: string };
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    code = typeof body.code === "string" ? body.code : "";
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ ok: false, error: "invalid email address" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (code.trim().length < 6 || code.trim().length > 2000) {
    return NextResponse.json({ ok: false, error: "enter the 6-digit code (or paste the email link)" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const r = await sbVerifyOtp(email, code);
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: r.invalidCode ? 400 : 502, headers: { "Cache-Control": "no-store" } });
  }
  const res = NextResponse.json(
    { ok: true, user: { id: r.user.id, email: r.user.email ?? email } },
    { headers: { "Cache-Control": "no-store" } },
  );
  res.cookies.set(SB_SESSION_COOKIE, encodeSbSession(r.tokens), sbSessionCookieOptions(req));
  return res;
}
