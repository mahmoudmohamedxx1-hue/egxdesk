import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SB_SESSION_COOKIE, encodeSbSession, sbCurrentUser, sbSessionCookieOptions } from "@/lib/supabase-auth";

/** GET /api/auth/supabase/me — the signed-in identity for this browser.
 *  Verifies the cookie's access token against Supabase (60s cache) and
 *  refreshes transparently when it expired (Supabase ATs live 1 hour). The
 *  response carries ONLY {signedIn, user:{id,email}} — tokens stay in the
 *  HttpOnly cookie, never in the page. */

export const runtime = "nodejs";

export async function GET(req: Request) {
  const jar = await cookies();
  const raw = jar.get(SB_SESSION_COOKIE)?.value;
  if (!raw) {
    return NextResponse.json({ signedIn: false, user: null }, { headers: { "Cache-Control": "no-store" } });
  }
  const { user, refreshed } = await sbCurrentUser(raw);
  const res = NextResponse.json(
    { signedIn: user !== null, user: user ? { id: user.id, email: user.email } : null },
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
