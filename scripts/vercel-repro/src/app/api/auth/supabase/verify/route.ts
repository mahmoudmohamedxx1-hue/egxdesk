import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeFailureLockout, makeRateLimiter } from "@/lib/rate-limit";
import {
  honeypotClean,
  isDisposableEmail,
  looksLikeBot,
  normalizeEmailForLimit,
  verifyChallenge,
} from "@/lib/auth-security";
import {
  ADMIN_TRUST_COOKIE,
  SB_SESSION_COOKIE,
  adminTrustCookieOptions,
  encodeAdminTrust,
  encodeSbSession,
  isAdminEmail,
  isValidEmail,
  sbAdminPasswordlessSignIn,
  sbSessionCookieOptions,
  sbVerifyOtp,
  supabaseAuthConfigured,
} from "@/lib/supabase-auth";

/** POST /api/auth/supabase/verify {email, code, challenge, hp} — step 2,
 *  hardened in T48. Gate order (fail-closed, cheapest first):
 *
 *    UA → flood cap (30/10min) → challenge echo → honeypot → email shape →
 *    disposable blocklist → code shape → per-mailbox failure lockout
 *    (5 wrong codes / 15 min — code guessing dies here) → the owner's
 *    setup-code bootstrap (admin address only) → Supabase verify.
 *
 *  On success the HttpOnly session cookie is set; when the verified address
 *  is the site owner, the 90-day device-trust cookie is issued too — that
 *  is what makes every FUTURE sign-in passwordless (no email, no code). */

export const runtime = "nodejs";

const floodLimited = makeRateLimiter(30, 10 * 60_000);
const failLock = makeFailureLockout(5, 15 * 60_000);
const SETUP_CODE = (process.env.ADMIN_SETUP_CODE ?? "").trim();

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(req: Request) {
  const ua = req.headers.get("user-agent");
  if (looksLikeBot(ua)) {
    return NextResponse.json({ ok: false, error: "automated clients are not allowed on the sign-in endpoints" }, { status: 403, headers: NO_STORE });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (floodLimited(ip)) {
    return NextResponse.json({ ok: false, error: "too many sign-in attempts from this network — wait a few minutes" }, { status: 429, headers: NO_STORE });
  }
  if (!supabaseAuthConfigured()) {
    return NextResponse.json({ ok: false, error: "supabase not configured" }, { status: 503, headers: NO_STORE });
  }

  let email = "";
  let code = "";
  let challenge = "";
  let hp = "";
  try {
    const body = (await req.json()) as { email?: string; code?: string; challenge?: string; hp?: string };
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    code = typeof body.code === "string" ? body.code : "";
    challenge = typeof body.challenge === "string" ? body.challenge : "";
    hp = typeof body.hp === "string" ? body.hp : "";
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400, headers: NO_STORE });
  }

  if (!verifyChallenge(challenge, ip, ua, "verify")) {
    return NextResponse.json(
      { ok: false, error: "sign-in challenge missing or expired — reload the page and try again", challengeFailed: true },
      { status: 403, headers: NO_STORE },
    );
  }
  if (!honeypotClean(hp)) {
    return NextResponse.json({ ok: false, error: "sign-in request rejected" }, { status: 403, headers: NO_STORE });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ ok: false, error: "invalid email address" }, { status: 400, headers: NO_STORE });
  }
  if (isDisposableEmail(email)) {
    return NextResponse.json(
      { ok: false, error: "temporary/disposable email domains are not allowed on this site" },
      { status: 403, headers: NO_STORE },
    );
  }
  if (code.trim().length < 6 || code.trim().length > 2000) {
    return NextResponse.json({ ok: false, error: "enter the 6-digit code (or paste the email link)" }, { status: 400, headers: NO_STORE });
  }

  // the per-mailbox failure lockout — code guessing dies here
  const mailboxKey = normalizeEmailForLimit(email);
  if (failLock.locked(mailboxKey)) {
    return NextResponse.json(
      { ok: false, error: "too many wrong codes for this mailbox — wait 15 minutes and try again" },
      { status: 429, headers: NO_STORE },
    );
  }

  // owner bootstrap: the one-time setup code from .env replaces the emailed
  // code for the admin address ONLY. Brute-forcing it through this route is
  // already throttled by the flood cap + the per-mailbox failure lockout
  // (every wrong code records a failure), and the code's entropy finishes
  // the job.
  if (SETUP_CODE.length >= 6 && isAdminEmail(email) && code.trim() === SETUP_CODE) {
    const admin = await sbAdminPasswordlessSignIn(email);
    if (admin.ok) {
      const res = NextResponse.json(
        { ok: true, user: { id: admin.user.id, email: admin.user.email ?? email }, isAdmin: true },
        { headers: NO_STORE },
      );
      res.cookies.set(SB_SESSION_COOKIE, encodeSbSession(admin.tokens), sbSessionCookieOptions(req));
      res.cookies.set(ADMIN_TRUST_COOKIE, encodeAdminTrust(admin.user.id), adminTrustCookieOptions(req));
      return res;
    }
    failLock.record(mailboxKey);
    return NextResponse.json({ ok: false, error: admin.error }, { status: 502, headers: NO_STORE });
  }

  const r = await sbVerifyOtp(email, code);
  if (!r.ok) {
    if (r.invalidCode) {
      failLock.record(mailboxKey); // count the failure against the mailbox
    }
    return NextResponse.json({ ok: false, error: r.error }, { status: r.invalidCode ? 400 : 502, headers: NO_STORE });
  }
  const res = NextResponse.json(
    { ok: true, user: { id: r.user.id, email: r.user.email ?? email }, isAdmin: isAdminEmail(r.user.email ?? email) },
    { headers: NO_STORE },
  );
  res.cookies.set(SB_SESSION_COOKIE, encodeSbSession(r.tokens), sbSessionCookieOptions(req));
  // the owner just proved the mailbox — trust this device for 90 days so
  // every future sign-in is the one-click passwordless door
  if (isAdminEmail(r.user.email ?? email)) {
    res.cookies.set(ADMIN_TRUST_COOKIE, encodeAdminTrust(r.user.id), adminTrustCookieOptions(req));
  }
  return res;
}
