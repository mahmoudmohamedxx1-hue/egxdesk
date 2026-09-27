import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SB_SESSION_COOKIE, decodeSbSession, sbInvalidateUserCache, sbLogout, sbSessionCookieOptions } from "@/lib/supabase-auth";

/** POST /api/auth/supabase/logout — revokes the Supabase session server-side
 *  (best-effort) and clears the cookie. Idempotent: logging out while
 *  already signed out is a 200, not an error. The identity cache entry for
 *  the revoked token dies HERE — a stale /me must never outlive its own
 *  logout (the next /me re-verifies live and gets 401 → signed out). */

export const runtime = "nodejs";

export async function POST(req: Request) {
  const jar = await cookies();
  const raw = jar.get(SB_SESSION_COOKIE)?.value;
  const tokens = decodeSbSession(raw);
  if (tokens) {
    sbInvalidateUserCache(tokens.at);
    await sbLogout(tokens.at).catch(() => {});
  }
  const res = NextResponse.json({ ok: true, signedIn: false }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SB_SESSION_COOKIE, "", { ...sbSessionCookieOptions(req), maxAge: 0 });
  return res;
}
