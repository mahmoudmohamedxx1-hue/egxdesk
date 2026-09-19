# Supabase Integration — status: FULLY LIVE (T47 auth + T48 security)

Your credentials (publishable + secret keys) are configured in `.env` and
verified live. **All three integration halves are now running** — and the
SQL you ran in the dashboard completed the last one.

## ✅ AUTH — live, and now bot-proof (T48)

The website has real, server-verified sign-in, hardened in T48 into a
humans-only pipeline (every check server-side, fail-closed):

- **Bot / AI-agent block** — scripted clients (curl, python-requests,
  scrapy, headless browsers, raw fetch without a browser User-Agent) are
  refused on ALL sign-in endpoints before anything else happens.
- **Challenge handshake** — the page fetches a one-time HMAC token when the
  dialog opens and must echo it back with every POST; it is bound to the
  caller's IP + browser, expires in 15 minutes, and is single-use per
  endpoint. A raw scripted POST never gets through.
- **Temp-mail blocklist** — ~240 disposable domains (mail.tm, mailinator,
  guerrillamail, yopmail, 10minutemail, … incl. subdomain wildcards) are
  refused before any Supabase call, so an AI agent spinning up a throwaway
  inbox can never create an account. This is the direct fix for the
  "ai agents can login using temp mail" request.
- **Honeypot + dwell time** — a hidden field only automation fills, and
  sub-1.5s form submissions, are refused.
- **Lockouts** — per-mailbox failure lockout (5 wrong codes / 15 min),
  per-mailbox email budget (3/hour), per-IP email budget (5/10 min),
  flood caps, plus email normalization (plus-addressing and gmail dots
  collapsed) so one mailbox can't farm many identities.
- **Security headers** — CSP (`default-src 'self'`, `frame-ancestors
  'none'`), X-Frame-Options DENY, nosniff, Referrer-Policy,
  Permissions-Policy on every response.

Endpoints: `POST /api/auth/supabase/request` · `POST
/api/auth/supabase/verify` · `GET /api/auth/supabase/challenge` · `POST
/api/auth/supabase/admin-signin` · `GET /api/auth/supabase/me` · `POST
/api/auth/supabase/logout`. Verified end-to-end by
`scripts/t48-security-audit.mjs` — **35/35 live checks pass**.

Honest limits unchanged: the free tier sends ~2 auth emails per hour (the
UI states it when you hit it); a 6-digit code or the pasted email link both
work at verify.

## 👑 THE OWNER — mahmoudmohamedxx1@gmail.com (T48)

The admin account is **already created + confirmed** in your project
(Authentication → Users, app_metadata role `admin` — created by the live
audit). "Access without any password" is a trusted-device handshake, not an
open door:

- **First time on a browser**: open the account dialog, enter
  `mahmoudmohamedxx1@gmail.com`, and either
  - use the emailed code (normal flow — the verify then also trusts the
    browser for 90 days), or
  - paste the one-time **owner setup code** (the `ADMIN_SETUP_CODE=` value
    in `.env` — keep it private, it lives only there and never in git) —
    no email needed. Wrong attempts are failure-counted (6/hour/IP) so the
    code can't be brute-forced.
- **Every time after**: the dialog shows a **"Owner quick sign-in"** button
  (one click — no code, no email, session minted server-side via GoTrue's
  admin generate_link). The signed-in owner wears an "Owner" badge.
- The trust cookie is HMAC-signed, HttpOnly, 90-day, and bound to the
  admin's user id — knowing the admin email alone gets an attacker nothing.

If you ever want to revoke the owner trust on all devices: rotate
`AUTH_TRUST_SECRET` in `.env` (and optionally regenerate
`ADMIN_SETUP_CODE`).

## ✅ THE AGENT'S SIGNALS/MEMORY/WORKLOG MIRROR — live

You ran the SQL — `/api/agent-signals` now reports `supabase:
{ state: "ok", mirrored: N }`. The next agent run (weekday slot or manual
trigger) mirrors automatically: every signal, every run (successes AND
failures), the memory ledger, and the whole worklog land in
`agent_signals`, `agent_runs`, `agent_memories`, `agent_worklog`.
SQLite + `data/agent/` files remain the source of truth; the mirror is a
cloud twin, never a dependency.

## Key hygiene (already handled)

- The **secret key** stays server-side only (`src/lib/supabase-auth.ts`,
  `auth-security.ts`, `supabase-mirror.ts` — hard browser-import guards)
  and in `.env`, which is git-ignored. The browser only ever holds the
  publishable-key semantics via server routes.
- `.env` never ships to GitHub — verified in `.gitignore`.
