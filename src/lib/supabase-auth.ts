/** T47 — SUPABASE AUTH: the real user-identity half of the Supabase
 *  integration, running on the user's OWN project (uwqgcflnlbmcehpilcud).
 *
 *  What the user asked for: "integrate the website with supabase for AUTH".
 *  The app had NO server auth (device-local identity only, Task 20) — this
 *  module adds real verified accounts with zero new dependencies (plain
 *  fetch against the GoTrue Auth API, same style as supabase-mirror.ts).
 *
 *  Flow (all calls happen SERVER-SIDE — the secret key and the user's JWT
 *  never reach the browser; the browser only ever learns {id, email}):
 *
 *   1. POST /api/auth/supabase/request {email}
 *        → POST {SUPABASE}/auth/v1/otp {email, create_user:true}
 *        → Supabase emails a 6-digit code (or a magic link, depending on the
 *          project's email template — the verify step accepts both).
 *   2. POST /api/auth/supabase/verify {email, code | link}
 *        → POST {SUPABASE}/auth/v1/verify (type picked from the account's
 *          state; code, magic-link token_hash and raw link all supported)
 *        → on success the session tokens go into an HttpOnly cookie
 *          `egx_sb_session` (30 days) — not localStorage, not the URL.
 *   3. GET  /api/auth/supabase/me  → {signedIn, user:{id,email}|null}
 *        → verifies the cookie's access token against /auth/v1/user
 *          (60s server-side cache), transparently refreshing when expired.
 *   4. POST /api/auth/supabase/logout → revokes the Supabase session
 *        (best-effort) and clears the cookie.
 *
 *  Honest limits surfaced to the UI: Supabase's free tier sends ~2 auth
 *  emails per hour — the request route maps 429 to that message verbatim,
 *  and nothing is ever fabricated (a failed verify is a failed verify). */

const ZAI_SERVER_ONLY_GUARD = typeof window === "undefined";
if (!ZAI_SERVER_ONLY_GUARD) {
  throw new Error("supabase-auth must never run in the browser — keys would leak");
}

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
const TRUST_SECRET = process.env.AUTH_TRUST_SECRET ?? "";

const AUTH_TIMEOUT_MS = 10_000;
export const SB_SESSION_COOKIE = "egx_sb_session";
const SB_SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days, matches Supabase's default session

export type SbUser = { id: string; email: string | null };
export type SbTokens = { at: string; rt: string };
export type SbPublic = { configured: boolean };

export function supabaseAuthConfigured(): boolean {
  return SUPABASE_URL.length > 0 && ANON_KEY.length > 0;
}

// ── low-level fetch helpers ─────────────────────────────────────────────

async function authFetch(
  path: string,
  init: { method: string; key: string; body?: unknown },
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), AUTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      method: init.method,
      headers: {
        apikey: init.key,
        Authorization: `Bearer ${init.key}`,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const text = await res.text().catch(() => "{}");
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    return { ok: false, status: 0, json: { msg: err instanceof Error ? err.message : "network error" } };
  } finally {
    clearTimeout(t);
  }
}

// ── step 1: request the OTP email ───────────────────────────────────────

export async function sbRequestOtp(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string; rateLimited: boolean }> {
  if (!supabaseAuthConfigured()) return { ok: false, error: "supabase not configured", rateLimited: false };
  const r = await authFetch("/auth/v1/otp", {
    method: "POST",
    key: ANON_KEY,
    body: { email, create_user: true },
  });
  if (r.ok) return { ok: true };
  const msg = typeof r.json.msg === "string" ? r.json.msg : typeof r.json.message === "string" ? r.json.message : `HTTP ${r.status}`;
  const code = typeof r.json.code === "string" ? r.json.code : typeof r.json.error_code === "string" ? r.json.error_code : "";
  const rateLimited = r.status === 429 || code === "over_email_send_rate_limit" || code === "over_request_rate_limit";
  if (rateLimited) {
    return {
      ok: false,
      error: "Supabase email limit reached (free tier sends ~2 auth emails per hour) — try again later",
      rateLimited: true,
    };
  }
  if (r.status === 403 || r.status === 400) {
    return { ok: false, error: `Supabase rejected the request: ${msg.slice(0, 120)}`, rateLimited: false };
  }
  return { ok: false, error: `Supabase error: ${msg.slice(0, 120)}`, rateLimited: false };
}

// ── account state (admin API — secret key, server-only) ─────────────────

async function sbAdminUser(email: string): Promise<{ exists: boolean; confirmed: boolean }> {
  if (!SERVICE_KEY) return { exists: false, confirmed: false };
  let page = 1;
  for (;;) {
    const r = await authFetch(`/auth/v1/admin/users?page=${page}&per_page=200`, { method: "GET", key: SERVICE_KEY });
    if (!r.ok) return { exists: false, confirmed: false };
    const users = Array.isArray(r.json.users) ? (r.json.users as Record<string, unknown>[]) : [];
    const hit = users.find((u) => typeof u.email === "string" && u.email.toLowerCase() === email.toLowerCase());
    if (hit) {
      return { exists: true, confirmed: hit.email_confirmed_at !== null && hit.email_confirmed_at !== undefined };
    }
    const aud = typeof r.json.aud === "string" ? r.json.aud : "";
    if (users.length < 200 || (aud && users.length === 0)) return { exists: false, confirmed: false };
    if (page > 10) return { exists: false, confirmed: false }; // hard cap: 2000 users scanned
    page += 1;
  }
}

/** Count of auth users in the project (for status/tests — emails never leave the server). */
export async function sbAdminUserCount(): Promise<number | null> {
  if (!SERVICE_KEY) return null;
  const r = await authFetch("/auth/v1/admin/users?page=1&per_page=1", { method: "GET", key: SERVICE_KEY });
  if (!r.ok) return null;
  return typeof r.json.total === "number" ? (r.json.total as number) : null;
}

// ── step 2: verify the code / link → session tokens ─────────────────────

type VerifyOutcome =
  | { ok: true; tokens: SbTokens; user: SbUser }
  | { ok: false; error: string; invalidCode: boolean };

function parseUser(json: Record<string, unknown>): { tokens: SbTokens; user: SbUser } | null {
  const at = typeof json.access_token === "string" ? json.access_token : null;
  const rt = typeof json.refresh_token === "string" ? json.refresh_token : null;
  const user = (json.user ?? null) as Record<string, unknown> | null;
  const id = user && typeof user.id === "string" ? user.id : null;
  if (!at || !rt || !id) return null;
  return { tokens: { at, rt }, user: { id, email: user && typeof user.email === "string" ? user.email : null } };
}

async function verifyAttempt(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  return authFetch("/auth/v1/verify", { method: "POST", key: ANON_KEY, body });
}

/** Accepts a 6-digit code, a full magic-link URL, or a bare token_hash. */
export async function sbVerifyOtp(email: string, codeOrLink: string): Promise<VerifyOutcome> {
  if (!supabaseAuthConfigured()) return { ok: false, error: "supabase not configured", invalidCode: false };
  const trimmed = codeOrLink.trim();

  // (a) a pasted magic-link URL → extract token_hash + type and use those
  if (/https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const tokenHash = u.searchParams.get("token_hash") ?? u.searchParams.get("token");
      const type = u.searchParams.get("type") ?? "magiclink";
      if (tokenHash) {
        const r = await verifyAttempt({ token_hash: tokenHash, type });
        const parsed = parseUser(r.json);
        if (r.ok && parsed) return { ok: true, ...parsed };
        return { ok: false, error: "link expired or already used", invalidCode: true };
      }
      return { ok: false, error: "no token found in that link", invalidCode: true };
    } catch {
      return { ok: false, error: "that link could not be parsed", invalidCode: true };
    }
  }

  // (b) a bare token_hash (32+ hex-ish chars, not 6 digits)
  if (!/^\d{6}$/.test(trimmed) && /^[A-Za-z0-9_-]{20,}$/.test(trimmed)) {
    const { exists, confirmed } = await sbAdminUser(email);
    const type = !exists || !confirmed ? "signup" : "magiclink";
    const r = await verifyAttempt({ token_hash: trimmed, type });
    const parsed = parseUser(r.json);
    if (r.ok && parsed) return { ok: true, ...parsed };
    return { ok: false, error: "token expired or invalid", invalidCode: true };
  }

  // (c) the 6-digit code — try the type that matches the account's state
  //     first (signup for a new/unconfirmed account, magiclink otherwise),
  //     then the generic "email" type, then the other one. Bounded: 3 calls.
  if (!/^\d{6}$/.test(trimmed)) {
    return { ok: false, error: "enter the 6-digit code (or paste the email link)", invalidCode: true };
  }
  const { exists, confirmed } = await sbAdminUser(email);
  const order: string[] = !exists || !confirmed ? ["signup", "email", "magiclink"] : ["magiclink", "email", "signup"];
  let lastMsg = "";
  for (const type of order) {
    const r = await verifyAttempt({ type, token: trimmed, email });
    const parsed = parseUser(r.json);
    if (r.ok && parsed) return { ok: true, ...parsed };
    lastMsg = typeof r.json.msg === "string" ? r.json.msg : typeof r.json.message === "string" ? r.json.message : `HTTP ${r.status}`;
    if (r.status === 429) {
      return { ok: false, error: "too many attempts — wait a minute and try again", invalidCode: false };
    }
    if (r.status >= 500) continue; // transient — try next type
    // 400: wrong type or wrong code — the next type may still succeed
  }
  return { ok: false, error: `wrong or expired code (${lastMsg.slice(0, 80)})`, invalidCode: true };
}

// ── step 3: verify an access token (/auth/v1/user) with a small cache ────

const g = globalThis as unknown as { __egxSbUserCache?: Map<string, { user: SbUser | null; expires: number }> };
g.__egxSbUserCache ??= new Map();

export async function sbGetUser(at: string): Promise<SbUser | null> {
  const key = createHash("sha256").update(at).digest("hex").slice(0, 16);
  const cached = g.__egxSbUserCache!.get(key);
  const now = Date.now();
  if (cached && cached.expires > now) return cached.user;
  // /auth/v1/user must carry the USER's access token as the bearer (the
  // apikey stays the project's publishable key):
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), AUTH_TIMEOUT_MS);
  let user: SbUser | null = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${at}` },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { id?: string; email?: string };
      if (json.id) user = { id: json.id, email: json.email ?? null };
    }
  } catch {
    user = null;
  } finally {
    clearTimeout(t);
  }
  g.__egxSbUserCache!.set(key, { user, expires: now + 60_000 });
  if (g.__egxSbUserCache!.size > 500) g.__egxSbUserCache!.clear();
  return user;
}

/** T47 — drop the cached identity for an access token (logout must be able
 *  to see its own revocation within the cache window, not after 60s). */
export function sbInvalidateUserCache(at: string): void {
  const key = createHash("sha256").update(at).digest("hex").slice(0, 16);
  g.__egxSbUserCache!.delete(key);
}

/** Refresh an expired access token (rotation: a NEW refresh token returns). */
export async function sbRefresh(rt: string): Promise<SbTokens | null> {
  if (!supabaseAuthConfigured()) return null;
  const r = await authFetch("/auth/v1/token?grant_type=refresh_token", { method: "POST", key: ANON_KEY, body: { refresh_token: rt } });
  const at = typeof r.json.access_token === "string" ? r.json.access_token : null;
  const nrt = typeof r.json.refresh_token === "string" ? r.json.refresh_token : null;
  if (!r.ok || !at || !nrt) return null;
  return { at, rt: nrt };
}

/** Revoke the session server-side (best-effort — cookie clearing is the source of truth). */
export async function sbLogout(at: string): Promise<void> {
  if (!supabaseAuthConfigured()) return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${at}` },
      signal: ctrl.signal,
    });
  } catch {
  } finally {
    clearTimeout(t);
  }
}

// ── cookie plumbing (HttpOnly, SameSite=Lax, 30 days) ────────────────────

export function encodeSbSession(tokens: SbTokens): string {
  return Buffer.from(JSON.stringify({ at: tokens.at, rt: tokens.rt }), "utf8").toString("base64url");
}

export function decodeSbSession(value: string | undefined): SbTokens | null {
  if (!value) return null;
  try {
    const json = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { at?: string; rt?: string };
    // AT is a JWT (long); RT is a short opaque session id (this project's are
    // ~12 chars — the earlier >20 check wrongly rejected valid sessions).
    if (typeof json.at === "string" && typeof json.rt === "string" && json.at.length > 40 && json.rt.length >= 6) return { at: json.at, rt: json.rt };
    return null;
  } catch {
    return null;
  }
}

export function sbSessionCookieOptions(req: Request): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
} {
  // Secure only when the request actually arrived over https (the preview
  // gateway forwards x-forwarded-proto; plain localhost stays usable).
  const proto = req.headers.get("x-forwarded-proto") ?? "";
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: proto.split(",")[0].trim() === "https",
    path: "/",
    maxAge: SB_SESSION_MAX_AGE_S,
  };
}

// ── validation helpers (shared by the routes and the tests) ──────────────

export function isValidEmail(email: string): boolean {
  const v = email.trim().toLowerCase();
  return v.length >= 5 && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

// ── T48 — the ADMIN: one email, passwordless after one bootstrap ─────────
//
// The user named mahmoudmohamedxx1@gmail.com the owner. "Access without
// any password" is implemented as a TRUSTED-DEVICE handshake, not as a
// passwordless hole anyone can walk through:
//
//   • bootstrap #1 — the one-time setup code from .env (ADMIN_SETUP_CODE),
//     OR a normal email-code verify. Either way the server then marks this
//     browser with a signed trust cookie (HMAC-SHA256, HttpOnly, 90 days).
//   • afterwards — entering the admin email signs in instantly: the route
//     requires the valid trust cookie AND mints the session server-side
//     (GoTrue admin generate_link → verify, so no email is sent, and the
//     admin account is auto-created+confirmed if it doesn't exist yet).
//   • an attacker who only KNOWS the admin email gets nothing: without the
//     setup code or the trust cookie the route refuses, and the setup-code
//     path is hard rate-limited (3/hour/IP).

export const ADMIN_TRUST_COOKIE = "egx_admin_trust";
const ADMIN_TRUST_MAX_AGE_S = 60 * 60 * 24 * 90; // 90 days

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!ADMIN_EMAIL) return false;
  return (email ?? "").trim().toLowerCase() === ADMIN_EMAIL;
}

export function adminEmail(): string {
  return ADMIN_EMAIL;
}

function trustHmac(payload: string): string {
  const secret = TRUST_SECRET || SERVICE_KEY || ANON_KEY || "egx-dev-trust";
  return createHmac("sha256", secret).update(`v1|${payload}`).digest("hex");
}

export type AdminTrust = { userId: string; deviceId: string; exp: number };

/** Mint the trust cookie value for an admin user (server-only). */
export function encodeAdminTrust(userId: string): string {
  const deviceId = createHash("sha256")
    .update(`${userId}|${Date.now()}|${Math.random()}`)
    .digest("hex")
    .slice(0, 24);
  const exp = Date.now() + ADMIN_TRUST_MAX_AGE_S * 1000;
  const payload = `${deviceId}|${userId}|${exp}`;
  return `v1.${deviceId}.${userId}.${exp}.${trustHmac(payload)}`;
}

/** Offline (no network) trust-cookie check: signature + expiry, and — when
 *  expectedUserId is given — the user it was issued to. Timing-safe. */
export function decodeAdminTrust(value: string | undefined | null, expectedUserId?: string): AdminTrust | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") return null;
  const [, deviceId, userId, expStr, mac] = parts;
  const exp = Number(expStr);
  if (!/^[0-9a-f]{24}$/.test(deviceId) || !/^[0-9a-f-]{20,40}$/.test(userId)) return null;
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const want = trustHmac(`${deviceId}|${userId}|${exp}`);
  if (mac.length !== want.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(mac, "utf8"), Buffer.from(want, "utf8"))) return null;
  } catch {
    return null;
  }
  if (expectedUserId !== undefined && userId !== expectedUserId) return null;
  return { userId, deviceId, exp };
}

export function adminTrustCookieOptions(req: Request) {
  const proto = req.headers.get("x-forwarded-proto") ?? "";
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: proto.split(",")[0].trim() === "https",
    path: "/",
    maxAge: ADMIN_TRUST_MAX_AGE_S,
  };
}

/** Find the admin's Supabase user id via the admin API (server-only). */
async function sbAdminFindUser(email: string): Promise<{ id: string; confirmed: boolean } | null> {
  if (!SERVICE_KEY) return null;
  const r = await authFetch(`/auth/v1/admin/users?page=1&per_page=200`, { method: "GET", key: SERVICE_KEY });
  if (!r.ok) return null;
  const users = Array.isArray(r.json.users) ? (r.json.users as Record<string, unknown>[]) : [];
  const hit = users.find((u) => typeof u.email === "string" && u.email.toLowerCase() === email.toLowerCase());
  if (!hit) return null;
  return { id: typeof hit.id === "string" ? hit.id : "", confirmed: hit.email_confirmed_at !== null && hit.email_confirmed_at !== undefined };
}

/** Create + confirm the admin account server-side (no email involved). */
async function sbAdminEnsureUser(email: string): Promise<{ id: string } | { error: string }> {
  const found = await sbAdminFindUser(email);
  if (found && found.id) {
    if (!found.confirmed) {
      // confirm the existing account so generate_link can mint sessions
      const r = await authFetch(`/auth/v1/admin/users/${found.id}`, {
        method: "PATCH",
        key: SERVICE_KEY,
        body: { email_confirm: true },
      });
      if (!r.ok) return { error: `could not confirm the admin account (${r.status})` };
    }
    return { id: found.id };
  }
  const r = await authFetch("/auth/v1/admin/users", {
    method: "POST",
    key: SERVICE_KEY,
    body: { email, email_confirm: true, app_metadata: { role: "admin" } },
  });
  const id = typeof r.json.id === "string" ? r.json.id : null;
  if (!r.ok || !id) {
    const msg = typeof r.json.msg === "string" ? r.json.msg : typeof r.json.message === "string" ? r.json.message : `HTTP ${r.status}`;
    return { error: `could not create the admin account: ${msg.slice(0, 120)}` };
  }
  return { id };
}

/** T48 — passwordless admin sign-in, entirely server-side:
 *  GoTrue admin generate_link (returns the magic link, does not depend on
 *  email delivery) → /auth/v1/verify with its token_hash → session tokens.
 *  The link never leaves this process; the browser only gets the session
 *  cookie's HttpOnly value. */
export async function sbAdminPasswordlessSignIn(
  email: string,
): Promise<{ ok: true; tokens: SbTokens; user: SbUser } | { ok: false; error: string }> {
  if (!supabaseAuthConfigured()) return { ok: false, error: "supabase not configured" };
  if (!SERVICE_KEY) return { ok: false, error: "server key not configured" };
  if (!isAdminEmail(email)) return { ok: false, error: "not the admin account" };
  const ensured = await sbAdminEnsureUser(email);
  if (!("id" in ensured)) return { ok: false, error: ensured.error };
  const link = await authFetch("/auth/v1/admin/generate_link", {
    method: "POST",
    key: SERVICE_KEY,
    body: { type: "magiclink", email },
  });
  const props = (link.json.properties ?? null) as Record<string, unknown> | null;
  const actionLink = props && typeof props.action_link === "string" ? props.action_link : null;
  if (!link.ok || !actionLink) {
    const msg = typeof link.json.msg === "string" ? link.json.msg : typeof link.json.message === "string" ? link.json.message : `HTTP ${link.status}`;
    return { ok: false, error: `could not generate the admin session: ${msg.slice(0, 120)}` };
  }
  // parse token_hash + type out of the generated link and verify it here
  let tokenHash = "";
  let type = "magiclink";
  try {
    const u = new URL(actionLink);
    tokenHash = u.searchParams.get("token_hash") ?? u.searchParams.get("token") ?? "";
    type = u.searchParams.get("type") ?? "magiclink";
  } catch {
    return { ok: false, error: "generated admin link could not be parsed" };
  }
  if (!tokenHash) return { ok: false, error: "generated admin link carried no token" };
  const verify = await authFetch("/auth/v1/verify", { method: "POST", key: ANON_KEY, body: { token_hash: tokenHash, type } });
  const parsed = parseUser(verify.json);
  if (!verify.ok || !parsed) {
    const msg = typeof verify.json.msg === "string" ? verify.json.msg : typeof verify.json.message === "string" ? verify.json.message : `HTTP ${verify.status}`;
    return { ok: false, error: `admin session verify failed: ${msg.slice(0, 120)}` };
  }
  return { ok: true, ...parsed };
}

/** The current signed-in user for a request — reads the cookie, verifies
 *  the AT (60s cache), refreshes when expired. Returns the user and, when a
 *  refresh happened, the fresh tokens so the route can re-set the cookie. */
export async function sbCurrentUser(
  cookieValue: string | undefined,
): Promise<{ user: SbUser | null; refreshed: SbTokens | null }> {
  const tokens = decodeSbSession(cookieValue);
  if (!tokens) return { user: null, refreshed: null };
  let user = await sbGetUser(tokens.at);
  if (user) return { user, refreshed: null };
  const fresh = await sbRefresh(tokens.rt);
  if (!fresh) return { user: null, refreshed: null };
  user = await sbGetUser(fresh.at);
  return { user, refreshed: user ? fresh : null };
}
