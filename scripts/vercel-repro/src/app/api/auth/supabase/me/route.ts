import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  ADMIN_TRUST_COOKIE,
  SB_SESSION_COOKIE,
  decodeAdminTrust,
  encodeSbSession,
  isAdminEmail,
  sbCurrentUser,
  sbSessionCookieOptions,
} from "@/lib/supabase-auth";

/** GET /api/auth/supabase/me — the signed-in identity for this browser.
 *  Verifies the cookie's access token against Supabase (60s cache) and
 *  refreshes transparently when it expired (Supabase ATs live 1 hour). The
 *  response carries ONLY {signedIn, user:{id,email}, isAdmin} — tokens stay
 *  in the HttpOnly cookie, never in the page.
 *
 *  T48 additions: `isAdmin` marks the owner's account, and `trustedAdmin`
 *  says this very browser holds the 90-day device-trust cookie — the UI
 *  uses it to offer the one-click passwordless sign-in. */

export const runtime = "nodejs";

export async function GET(req: Request) {
  const jar = await cookies();
  const trust = decodeAdminTrust(jar.get(ADMIN_TRUST_COOKIE)?.value);
  const raw = jar.get(SB_SESSION_COOKIE)?.value;
  if (!raw) {
    return NextResponse.json(
      { signedIn: false, user: null, isAdmin: false, trustedAdmin: trust !== null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const { user, refreshed } = await sbCurrentUser(raw);
  const isAdmin = user !== null && isAdminEmail(user.email);
  const res = NextResponse.json(
    {
      signedIn: user !== null,
      user: user ? { id: user.id, email: user.email } : null,
      isAdmin,
      // a trust cookie for a DIFFERENT user id than the signed-in one is not
      // "trusted" — the admin door only opens for its own device trust
      trustedAdmin: trust !== null && (user === null || trust.userId === user.id || isAdmin),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
  if (refreshed) {
    res.cookies.set(SB_SESSION_COOKIE, encodeSbSession(refreshed), sbSessionCookieOptions(req));
  } else if (!user) {
    // dead session (logged out elsewhere / revoked) — drop the cookie too
    res.cookies.set(SB_SESSION_COOKIE, "", { ...sbSessionCookieOptions(req), maxAge: 0 });
  }
  return res;
}
