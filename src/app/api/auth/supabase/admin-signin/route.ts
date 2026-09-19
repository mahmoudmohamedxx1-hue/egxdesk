import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeFailureLockout } from "@/lib/rate-limit";
import { looksLikeBot, verifyChallenge } from "@/lib/auth-security";
import {
  ADMIN_TRUST_COOKIE,
  SB_SESSION_COOKIE,
  adminEmail,
  adminTrustCookieOptions,
  decodeAdminTrust,
  encodeAdminTrust,
  encodeSbSession,
  isAdminEmail,
  sbAdminPasswordlessSignIn,
  sbSessionCookieOptions,
  supabaseAuthConfigured,
} from "@/lib/supabase-auth";

/** POST /api/auth/supabase/admin-signin {email?, setupCode?, challenge} —
 *  T48: the owner's passwordless door.
 *
 *  Gates, in order, all fail-closed:
 *    1. bot UA          — scripted clients never reach Supabase at all;
 *    2. failure lockout — FAILED attempts lock this IP for an hour
 *                         (6/hour; successful owner sign-ins never count,
 *                          so the real owner is never punished for
 *                          signing in often);
 *    3. challenge token — pre-flight fetched + echoed (single-use, IP+UA bound);
 *    4. admin email     — only the one address in ADMIN_EMAIL (a probe with
 *                         any other address counts as a failure);
 *    5. trust cookie    — a valid signed 90-day device trust from the
 *                         bootstrap, OR the one-time setup code from .env
 *                         (a wrong/missing code counts as a failure — that
 *                          is exactly the brute-force signal).
 *
 *  On success the session is minted entirely server-side (generate_link →
 *  verify; no email is sent, and the account is created+confirmed if this
 *  is its very first sign-in) and the browser's trust cookie is issued,
 *  so subsequent sign-ins on this device need nothing but the button. */

export const runtime = "nodejs";

const attemptLock = makeFailureLockout(6, 60 * 60_000);
const SETUP_CODE = (process.env.ADMIN_SETUP_CODE ?? "").trim();

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(req: Request) {
  const ua = req.headers.get("user-agent");
  if (looksLikeBot(ua)) {
    return NextResponse.json({ ok: false, error: "automated clients are not allowed on the sign-in endpoints" }, { status: 403, headers: NO_STORE });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (attemptLock.locked(ip)) {
    return NextResponse.json(
      { ok: false, error: "too many failed admin sign-in attempts from this network — locked for an hour" },
      { status: 429, headers: NO_STORE },
    );
  }
  if (!supabaseAuthConfigured()) {
    return NextResponse.json({ ok: false, error: "supabase not configured" }, { status: 503, headers: NO_STORE });
  }

  let email = "";
  let setupCode = "";
  let challenge = "";
  try {
    const body = (await req.json()) as { email?: string; setupCode?: string; challenge?: string };
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    setupCode = typeof body.setupCode === "string" ? body.setupCode.trim() : "";
    challenge = typeof body.challenge === "string" ? body.challenge : "";
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400, headers: NO_STORE });
  }
  // the one-click "Owner quick sign-in" button sends no email at all — the
  // server resolves the owner's address itself, so it is never broadcast
  if (!email) email = adminEmail();
  if (!verifyChallenge(challenge, ip, ua, "admin")) {
    return NextResponse.json(
      { ok: false, error: "sign-in challenge missing or expired — reload and try again", challengeFailed: true },
      { status: 403, headers: NO_STORE },
    );
  }
  if (!isAdminEmail(email)) {
    attemptLock.record(ip);
    return NextResponse.json({ ok: false, error: "this door is for the site owner only" }, { status: 403, headers: NO_STORE });
  }

  // gate 5: device trust OR the one-time setup code
  const jar = await cookies();
  const trust = decodeAdminTrust(jar.get(ADMIN_TRUST_COOKIE)?.value);
  const codeOk = SETUP_CODE.length >= 6 && setupCode.length >= 6 && setupCode === SETUP_CODE;
  if (!trust && !codeOk) {
    attemptLock.record(ip);
    return NextResponse.json(
      {
        ok: false,
        needsBootstrap: true,
        error: "this browser is not trusted yet — sign in once with the emailed code, or enter the owner setup code",
      },
      { status: 403, headers: NO_STORE },
    );
  }

  const r = await sbAdminPasswordlessSignIn(email);
  if (!r.ok) {
    attemptLock.record(ip);
    return NextResponse.json({ ok: false, error: r.error }, { status: 502, headers: NO_STORE });
  }
  const res = NextResponse.json(
    { ok: true, user: { id: r.user.id, email: r.user.email ?? email }, isAdmin: true },
    { headers: NO_STORE },
  );
  res.cookies.set(SB_SESSION_COOKIE, encodeSbSession(r.tokens), sbSessionCookieOptions(req));
  res.cookies.set(ADMIN_TRUST_COOKIE, encodeAdminTrust(r.user.id), adminTrustCookieOptions(req));
  return res;
}
