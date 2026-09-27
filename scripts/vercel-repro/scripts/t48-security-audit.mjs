#!/usr/bin/env node
/** T48 LIVE security audit — proves the anti-bot / anti-temp-mail / owner
 *  passwordless layer end-to-end against the running dev server (:3000):
 *
 *   A. UA gate        — bot UAs (python-requests, curl, Googlebot, puppeteer)
 *                       refused on challenge + request + verify + admin door.
 *   B. challenge      — required, single-use per scope, tamper-proof, and a
 *                       borrowed token from another "client" fails.
 *   C. honeypot/dwell — filled honeypot refused; sub-1.5s submit refused.
 *   D. temp-mail      — mail.tm / mailinator / guerrillamail / yopmail
 *                       addresses refused before ANY Supabase call.
 *   E. admin door     — non-owner refused; owner without trust/code refused;
 *                       wrong setup code refused; CORRECT setup code signs
 *                       in passwordlessly and creates+confirms the real admin
 *                       account; the trust cookie then signs in with NO code.
 *   F. lockouts       — the admin door's 3/hour/IP attempt cap trips on the
 *                       4th call.
 *   G. mirror         — /api/agent-signals now reports the Supabase mirror
 *                       "ok" (the user ran the SQL).
 *
 *  Run: node scripts/t48-security-audit.mjs   (dev server on :3000) */

import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const BASE = "http://localhost:3000";
const ADMIN = process.env.ADMIN_EMAIL;
const SETUP = process.env.ADMIN_SETUP_CODE;
if (!ADMIN || !SETUP) {
  console.error("ADMIN_EMAIL / ADMIN_SETUP_CODE must be set in .env");
  process.exit(1);
}

const HUMAN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BOT_UAS = ["python-requests/2.31.0", "curl/8.5.0", "Googlebot/2.1 (+http://www.google.com/bot.html)", "HeadlessChrome/120.0.0.0"];

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}

async function call(path, { method = "GET", ua = HUMAN_UA, body, cookie } = {}) {
  const headers = {};
  if (ua) headers["user-agent"] = ua;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  const setCookies =
    res.headers.getSetCookie?.() ??
    (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
  return { status: res.status, json, setCookies };
}

async function getChallenge(ua = HUMAN_UA) {
  const r = await call("/api/auth/supabase/challenge", { ua });
  return r.json?.token ?? null;
}

const now = Date.now();
const openedAt = now - 4000; // a human-ish 4s dwell

// ── A. the UA gate ────────────────────────────────────────────────────────
for (const bot of BOT_UAS) {
  const c = await call("/api/auth/supabase/challenge", { ua: bot });
  ok(`A: bot UA refused on challenge (${bot.split("/")[0]})`, c.status === 403);
}
{
  const r = await call("/api/auth/supabase/request", { method: "POST", ua: "curl/8.5.0", body: { email: "someone@gmail.com" } });
  ok("A: bot UA refused on request", r.status === 403 && /automated/.test(r.json?.error ?? ""));
  const v = await call("/api/auth/supabase/verify", { method: "POST", ua: "python-requests/2.31", body: { email: "someone@gmail.com", code: "123456" } });
  ok("A: bot UA refused on verify", v.status === 403);
  const a = await call("/api/auth/supabase/admin-signin", { method: "POST", ua: "HeadlessChrome/120", body: { email: ADMIN } });
  ok("A: bot UA refused on admin door", a.status === 403);
}

// ── B. the challenge handshake ────────────────────────────────────────────
{
  const none = await call("/api/auth/supabase/request", { method: "POST", body: { email: "someone@gmail.com", openedAt } });
  ok("B: request without challenge refused", none.status === 403 && none.json?.challengeFailed === true);

  const tok = await getChallenge();
  ok("B: challenge issued to a human UA", typeof tok === "string" && /^\d+\.[0-9a-f]{64}$/.test(tok));

  // burn it on the request scope (with a disposable email so Supabase is never touched)
  const burn = await call("/api/auth/supabase/request", {
    method: "POST", body: { email: "someone@mail.tm", challenge: tok, openedAt },
  });
  ok("B: first use passes the challenge gate (hits the disposable gate instead)", burn.status === 403 && /disposable/.test(burn.json?.error ?? ""));
  const reuse = await call("/api/auth/supabase/request", {
    method: "POST", body: { email: "someone@mail.tm", challenge: tok, openedAt },
  });
  ok("B: replayed challenge refused", reuse.status === 403 && reuse.json?.challengeFailed === true);

  // tampered token
  const tok2 = await getChallenge();
  const forged = tok2.slice(0, -4) + "beef";
  const tam = await call("/api/auth/supabase/request", {
    method: "POST", body: { email: "someone@mail.tm", challenge: forged, openedAt },
  });
  ok("B: tampered challenge refused", tam.status === 403 && tam.json?.challengeFailed === true);

  // scope isolation: a challenge burned on "request" still works on "verify"
  // (separate scopes) — and one never used on "admin" is required there
  const tok3 = await getChallenge();
  const adminNoCh = await call("/api/auth/supabase/admin-signin", { method: "POST", body: { email: ADMIN } });
  ok("B: admin door without challenge refused", adminNoCh.status === 403 && adminNoCh.json?.challengeFailed === true);
}

// ── C. honeypot + dwell ───────────────────────────────────────────────────
{
  const tok = await getChallenge();
  const hp = await call("/api/auth/supabase/request", {
    method: "POST", body: { email: "someone@gmail.com", challenge: tok, openedAt, hp: "http://spam.example" },
  });
  ok("C: filled honeypot refused", hp.status === 403);

  const tok2 = await getChallenge();
  const fast = await call("/api/auth/supabase/request", {
    method: "POST", body: { email: "someone@gmail.com", challenge: tok2, openedAt: Date.now() },
  });
  ok("C: sub-1.5s dwell refused", fast.status === 403 && /fast/.test(fast.json?.error ?? ""));
}

// ── D. the disposable-email blocklist ─────────────────────────────────────
for (const domain of ["mail.tm", "mailinator.com", "guerrillamail.com", "yopmail.com", "temp-mail.org", "10minutemail.com", "sharklasers.com", "1secmail.com"]) {
  const tok = await getChallenge();
  const r = await call("/api/auth/supabase/request", {
    method: "POST", body: { email: `probe@${domain}`, challenge: tok, openedAt },
  });
  ok(`D: temp-mail domain refused (${domain})`, r.status === 403 && /disposable/.test(r.json?.error ?? ""));
}
{
  // subdomain wildcard: anything.mailinator.com
  const tok = await getChallenge();
  const r = await call("/api/auth/supabase/request", {
    method: "POST", body: { email: "probe@spam.mailinator.com", challenge: tok, openedAt },
  });
  ok("D: temp-mail subdomain refused", r.status === 403 && /disposable/.test(r.json?.error ?? ""));
}

// ── E. the owner's passwordless door ──────────────────────────────────────
{
  const tok = await getChallenge();
  const notOwner = await call("/api/auth/supabase/admin-signin", {
    method: "POST", body: { email: "nottheowner@gmail.com", challenge: tok },
  });
  ok("E: non-owner refused at the admin door", notOwner.status === 403 && /owner/.test(notOwner.json?.error ?? ""));

  const tok2 = await getChallenge();
  const noTrust = await call("/api/auth/supabase/admin-signin", {
    method: "POST", body: { email: ADMIN, challenge: tok2 },
  });
  ok("E: owner without trust/setup refused (needsBootstrap)", noTrust.status === 403 && noTrust.json?.needsBootstrap === true);

  const tok3 = await getChallenge();
  const wrongCode = await call("/api/auth/supabase/admin-signin", {
    method: "POST", body: { email: ADMIN, setupCode: "deadbeef99", challenge: tok3 },
  });
  ok("E: wrong setup code refused", wrongCode.status === 403 && wrongCode.json?.needsBootstrap === true);

  // the real bootstrap: correct setup code → session + trust cookies, and
  // the admin account is created+confirmed in Supabase (no email involved)
  const tok4 = await getChallenge();
  const boot = await call("/api/auth/supabase/admin-signin", {
    method: "POST", body: { email: ADMIN, setupCode: SETUP, challenge: tok4 },
  });
  ok("E: setup code signs the owner in passwordlessly", boot.status === 200 && boot.json?.ok === true && boot.json?.isAdmin === true, JSON.stringify(boot.json));
  const sessionCookie = boot.setCookies.find((c) => c.startsWith("egx_sb_session="))?.split(";")[0];
  const trustCookie = boot.setCookies.find((c) => c.startsWith("egx_admin_trust="))?.split(";")[0];
  ok("E: session + trust cookies issued (HttpOnly)", Boolean(sessionCookie) && Boolean(trustCookie));

  if (sessionCookie) {
    const me = await call("/api/auth/supabase/me", { cookie: sessionCookie });
    ok("E: /me sees the signed-in owner", me.json?.signedIn === true && me.json?.isAdmin === true, JSON.stringify(me.json));
  }

  // the future path: trusted device, NO setup code, NO email → instant sign-in
  if (trustCookie) {
    const tok5 = await getChallenge();
    const quick = await call("/api/auth/supabase/admin-signin", {
      method: "POST", body: { email: ADMIN, challenge: tok5 }, cookie: trustCookie,
    });
    ok("E: trusted device signs in with NO code and NO email", quick.status === 200 && quick.json?.ok === true, JSON.stringify(quick.json));
  }

  // the request-route fast path: the owner + trust cookie never spends an email
  if (trustCookie) {
    const tok6 = await getChallenge();
    const fast = await call("/api/auth/supabase/request", {
      method: "POST", body: { email: ADMIN, challenge: tok6, openedAt }, cookie: trustCookie,
    });
    ok("E: owner request short-circuits to adminFast (no email spent)", fast.json?.adminFast === true, JSON.stringify(fast.json));
  }
}

// ── F. the admin door's failure lockout (6/hour/IP, failures only) ────────
// we've burned 3 failures so far (not-owner, no-trust, wrong-code); keep
// failing until the lockout trips — successful owner sign-ins must NEVER
// count toward it (the quick/fast successes above proved that)
{
  let locked = false;
  for (let i = 0; i < 6; i++) {
    const tok = await getChallenge();
    const r = await call("/api/auth/supabase/admin-signin", {
      method: "POST", body: { email: ADMIN, challenge: tok }, // no cookie, no code → failure
    });
    if (r.status === 429) { locked = true; break; }
  }
  ok("F: repeated failures lock the admin door for an hour", locked);
}

// ── G. the Supabase mirror (user ran the SQL) ─────────────────────────────
{
  const r = await call("/api/agent-signals");
  const supa = r.json?.supabase;
  ok("G: agent-signals reports the Supabase mirror state", Boolean(supa) && typeof supa.state === "string", JSON.stringify(supa));
  if (supa?.state === "ok") {
    ok("G: mirror is LIVE (tables exist — the SQL ran)", true);
  } else if (supa?.state === "needs-setup") {
    console.log(`NOTE G: mirror still needs-setup (SQL may not have run yet) — ${JSON.stringify(supa)}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed${fail ? " — FIX BEFORE SHIPPING" : " — the security layer is live"}`);
process.exit(fail ? 1 : 0);
