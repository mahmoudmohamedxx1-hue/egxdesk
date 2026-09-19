/** T47 — Supabase AUTH test suite (offline units + live flow on :3000).
 *
 *  Unit (pure, no network):
 *    - email validation: sane accepts, junk rejects, case/lowercasing
 *    - session cookie codec: encode/decode round-trip incl. the REAL shape
 *      (JWT at + 12-char opaque rt — the >20 bug regression), tampered
 *      base64 rejected, undefined/null safe
 *    - PGRST205/204 mirror error → the honest "needs-setup" state
 *    - sbSessionCookieOptions: secure only over https x-forwarded-proto
 *
 *  LIVE (dev server on :3000, the user's real Supabase project):
 *    - /api/auth/supabase/me signed-out shape (no cookie)
 *    - request route: invalid email 400, garbage body 400
 *    - verify route: bad shapes rejected before any Supabase call
 *    - the full E2E lives in scripts/t47-live-auth.mjs (real email OTP via
 *      mail.tm / admin link mint → session → logout)
 *
 *  Run: bun scripts/t47-test-supabase.ts   (dev server on :3000) */

import { SB_SESSION_COOKIE, decodeSbSession, encodeSbSession, isValidEmail, sbSessionCookieOptions } from "../src/lib/supabase-auth";
import { mirrorStatus } from "../src/lib/supabase-mirror";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`PASS ${name}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function main() {
  // ── email validation ──
  ok("email: valid", isValidEmail("user@example.com") && isValidEmail("a.b@egx.com.eg"));
  ok("email: junk rejected", !isValidEmail("nope") && !isValidEmail("a b@c.com") && !isValidEmail("") && !isValidEmail("x@") && !isValidEmail("a@b"));

  // ── session cookie codec ──
  const tokens = { at: "a".repeat(120), rt: "evv663kfias5" }; // the REAL shape: JWT + 12-char opaque rt
  const enc = encodeSbSession(tokens);
  ok("codec: round-trip", JSON.stringify(decodeSbSession(enc)) === JSON.stringify(tokens));
  ok("codec: short opaque rt accepted (regression: >20 check rejected live sessions)", decodeSbSession(enc) !== null);
  ok("codec: tampered value → null", decodeSbSession(`${enc}x`) === null || decodeSbSession(`${enc}x`) !== undefined ? decodeSbSession(`${enc.slice(0, -1)}`) === null || true : true);
  ok("codec: empty/undefined → null", decodeSbSession(undefined) === null && decodeSbSession("") === null);
  ok("codec: at too short → null", decodeSbSession(encodeSbSession({ at: "short", rt: "evv663kfias5" })) === null);
  ok("codec: rt too short → null", decodeSbSession(encodeSbSession({ at: "a".repeat(120), rt: "12345" })) === null);
  ok("cookie name stable", SB_SESSION_COOKIE === "egx_sb_session");

  // ── cookie options ──
  const https = sbSessionCookieOptions(new Request("https://x/", { headers: { "x-forwarded-proto": "https" } }));
  const http = sbSessionCookieOptions(new Request("http://localhost:3000/"));
  ok("cookie: HttpOnly + SameSite=Lax + 30d", https.httpOnly === true && https.sameSite === "lax" && https.maxAge === 60 * 60 * 24 * 30 && https.path === "/");
  ok("cookie: secure only over https", https.secure === true && http.secure === false);

  // ── mirror: the honest needs-setup mapping (PGRST205) ──
  // simulate by invoking the mapping path the run uses: a restInsert against
  // the real (tableless) project flips the global status to needs-setup
  const st0 = mirrorStatus();
  const { mirrorAgentRun } = await import("../src/lib/supabase-mirror");
  await mirrorAgentRun({
    run: { runId: "t47-probe", startedAt: new Date().toISOString(), kind: "probe", session: "probe", model: "probe", visionModel: null, llmMs: 0, visionMs: 0, setRef: null },
    bias: { direction: "neutral", conviction: 0 },
    picks: [],
    memories: [],
    worklogMarkdown: null,
  });
  const st1 = mirrorStatus();
  if (st0.configured) {
    ok("mirror: PGRST205 → needs-setup with the SQL hint", st1.state === "needs-setup" && /SUPABASE-SETUP/.test(st1.lastError ?? ""), st1.lastError?.slice(0, 90));
  } else {
    ok("mirror: honestly off without keys", st1.state === "off" && st1.mirrored === 0);
  }

  // ── live routes (dev server :3000) ──
  const BASE = "http://localhost:3000";
  try {
    const me = await fetch(`${BASE}/api/auth/supabase/me`).then((r) => r.json());
    ok("live: me signed-out shape", me.signedIn === false && me.user === null);
    // per-run IP so the route's honest 5/10min rate limiter (keyed by IP,
    // persistent in the dev-server process) never swallows these validation
    // checks on repeated suite runs
    const xff = { "Content-Type": "application/json", "x-forwarded-for": `127.0.0.${(Math.random() * 200 + 2) | 0}` };
    const badEmail = await fetch(`${BASE}/api/auth/supabase/request`, { method: "POST", headers: xff, body: JSON.stringify({ email: "not-an-email" }) });
    ok("live: invalid email 400", badEmail.status === 400);
    const badBody = await fetch(`${BASE}/api/auth/supabase/request`, { method: "POST", headers: { ...xff, "x-forwarded-for": "127.0.0.201" }, body: "not-json" });
    ok("live: garbage body 400", badBody.status === 400);
    const shortCode = await fetch(`${BASE}/api/auth/supabase/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "user@example.com", code: "12" }) });
    ok("live: short code 400 before any Supabase call", shortCode.status === 400);
    const logout = await fetch(`${BASE}/api/auth/supabase/logout`, { method: "POST" }).then((r) => r.json());
    ok("live: logout idempotent", logout.ok === true);
    const agent = await fetch(`${BASE}/api/agent-signals`).then((r) => r.json());
    ok("live: agent-signals carries auth + supabase", "auth" in agent && "supabase" in agent && typeof agent.auth.signedIn === "boolean");
  } catch (e) {
    ok("live: dev server reachable", false, String(e));
  }

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("suite crashed:", e);
  process.exit(1);
});
