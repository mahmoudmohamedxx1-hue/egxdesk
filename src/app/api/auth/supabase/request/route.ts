import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRateLimiter } from "@/lib/rate-limit";
import {
  honeypotClean,
  isDisposableEmail,
  isDwellValid,
  looksLikeBot,
  normalizeEmailForLimit,
  verifyChallenge,
} from "@/lib/auth-security";
import {
  ADMIN_TRUST_COOKIE,
  decodeAdminTrust,
  isAdminEmail,
  isValidEmail,
  sbRequestOtp,
  supabaseAuthConfigured,
} from "@/lib/supabase-auth";

/** POST /api/auth/supabase/request {email, challenge, openedAt, hp} — step 1
 *  of Supabase auth, hardened in T48 into a humans-only endpoint.
 *
 *  Gate order (fail-closed, cheapest first; only a request that will REALLY
 *  send an email ever touches the tight limits):
 *
 *    UA → flood cap (30/10min, stops raw POST storms) → challenge echo
 *    (single-use, IP+UA-bound) → honeypot → dwell time → email shape →
 *    disposable-domain blocklist → owner fast path (never spends an email)
 *    → per-mailbox (3/hour) + per-IP (5/10min) email budget → Supabase.
 *
 *  The disposable blocklist is the direct answer to "AI agents can login
 *  using temp mail" — no account is ever created for a throwaway domain. */

export const runtime = "nodejs";

const floodLimited = makeRateLimiter(30, 10 * 60_000);
const ipLimited = makeRateLimiter(5, 10 * 60_000);
const mailboxLimited = makeRateLimiter(3, 60 * 60_000);

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(req: Request) {
  const ua = req.headers.get("user-agent");
  if (looksLikeBot(ua)) {
    return NextResponse.json({ ok: false, error: "automated clients are not allowed on the sign-in endpoints" }, { status: 403, headers: NO_STORE });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (floodLimited(ip)) {
    return NextResponse.json({ ok: false, error: "too many sign-in requests from this network — wait a few minutes" }, { status: 429, headers: NO_STORE });
  }
  if (!supabaseAuthConfigured()) {
    return NextResponse.json({ ok: false, error: "supabase not configured" }, { status: 503, headers: NO_STORE });
  }

  let email = "";
  let challenge = "";
  let openedAt: number | null = null;
  let hp = "";
  try {
    const body = (await req.json()) as { email?: string; challenge?: string; openedAt?: number; hp?: string };
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    challenge = typeof body.challenge === "string" ? body.challenge : "";
    openedAt = typeof body.openedAt === "number" ? body.openedAt : null;
    hp = typeof body.hp === "string" ? body.hp : "";
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400, headers: NO_STORE });
  }

  if (!verifyChallenge(challenge, ip, ua, "request")) {
    return NextResponse.json(
      { ok: false, error: "sign-in challenge missing or expired — reload the page and try again", challengeFailed: true },
      { status: 403, headers: NO_STORE },
    );
  }
  if (!honeypotClean(hp)) {
    // a hidden field only automation fills — refuse, but say nothing detailed
    return NextResponse.json({ ok: false, error: "sign-in request rejected" }, { status: 403, headers: NO_STORE });
  }
  if (!isDwellValid(openedAt)) {
    return NextResponse.json(
      { ok: false, error: "that was too fast to be human — take a breath and try again" },
      { status: 403, headers: NO_STORE },
    );
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

  // the owner never spends an email: a trusted device skips straight to the
  // passwordless door (checked BEFORE the email budget — it sends nothing)
  if (isAdminEmail(email)) {
    const jar = await cookies();
    if (decodeAdminTrust(jar.get(ADMIN_TRUST_COOKIE)?.value)) {
      return NextResponse.json({ ok: true, adminFast: true, email }, { headers: NO_STORE });
    }
  }

  // only from here on would an email actually be sent
  if (mailboxLimited(normalizeEmailForLimit(email))) {
    return NextResponse.json(
      { ok: false, error: "too many codes for this mailbox this hour — try again later" },
      { status: 429, headers: NO_STORE },
    );
  }
  if (ipLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: "too many code requests — wait a few minutes" },
      { status: 429, headers: NO_STORE },
    );
  }

  const r = await sbRequestOtp(email);
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, error: r.error, rateLimited: r.rateLimited },
      { status: r.rateLimited ? 429 : 502, headers: NO_STORE },
    );
  }
  return NextResponse.json({ ok: true, emailSent: true, email }, { headers: NO_STORE });
}
