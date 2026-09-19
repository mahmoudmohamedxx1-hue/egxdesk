# Deploying EGX Desk to Vercel

The repo is Vercel-ready as of T50. Follow this once and every feature works.

## What used to break (and is now fixed)

| Symptom on Vercel | Cause | Fix (already in the repo) |
|---|---|---|
| AI signals / reports / news archive / flows pages empty or 500 | The SQLite dataset (`db/custom.db`) was gitignored, so serverless builds shipped with **no database** | `db/custom.db` is now tracked in git and bundled into every function via `outputFileTracingIncludes`; at runtime `src/lib/db.ts` copies it to `/tmp` (the only writable dir) and points Prisma there |
| AI assistant popup never answers | The assistant brain used the sandbox-only `z-ai-web-dev-sdk` | `/api/assistant` now calls the Z.AI API directly (`src/lib/zai-client.ts`, glm-4.7-flash) — plain HTTPS, works on any host; the key comes **only** from the `ZAI_API_KEY` env var (never hardcoded), and without it the popup still answers via the keyless LLM7 fallback |
| Agent chat died on the first token | Same SDK — it can't authenticate outside the sandbox | The agent route falls back to the keyless LLM7 cloud (no key, no sign-in) when the SDK is unavailable |
| Cold starts burning 30s+ before serving | Background loops (signals warm, desk reports, agent scheduler) ran on boot | They detect `VERCEL` and skip — the API serves the persisted sets from the db snapshot; live quotes still stream on demand |

## The one thing you MUST do: set the env vars

Vercel → your project → **Settings → Environment Variables**, add:

| Variable | Value | Needed for |
|---|---|---|
| `SUPABASE_URL` | `https://uwqgcflnlbmcehpilcud.supabase.co` | Sign-in (email codes) + the data mirror |
| `SUPABASE_ANON_KEY` | the publishable key (`sb_publishable_…`) | Sign-in |
| `SUPABASE_SERVICE_ROLE_KEY` | the secret key (`sb_secret_…`) | Sign-in, admin door, mirror |
| `ADMIN_EMAIL` | `mahmoudmohamedxx1@gmail.com` | The owner/admin door |
| `ADMIN_SETUP_CODE` | your one-time bootstrap code | First passwordless sign-in |
| `AUTH_TRUST_SECRET` | the 32-byte hex secret | 90-day device-trust cookie |
| `AUTH_CHALLENGE_SECRET` | the 32-byte hex secret | Sign-in challenge handshake |
| `ZAI_API_KEY` | your Z.AI key | AI assistant direct tier + signal agent (without it the assistant still answers via the keyless fallback) |

> 🔑 **Rotate your Z.AI key.** An earlier commit embedded the key in source files, and this repo is **public** — treat the old key as compromised: generate a new one in the Z.AI console, put it in `.env` here and in the Vercel env vars. The embedded copy has been removed; the key now lives **only** in env vars.

`DATABASE_URL` is **not** needed — the runtime resolves the bundled SQLite file itself.

> The actual secret values live in the project's `.env` (never committed). On the sandbox they are already set; copy them from your own notes/Supabase dashboard when configuring Vercel.

## Honest serverless limits (by design)

- **Reads are full-fidelity**: every market table (flows, indices, breadth, news archive, AI signal sets, agent record) ships inside the deployment.
- **Writes are ephemeral**: agent runs, push subscriptions and usage events write to the per-instance `/tmp` copy and vanish between invocations. The always-on preview server is where the full loop (self-learning agent, live notifications, push) runs.
- **Signals freshness**: the AI signal set served is the last one computed when the repo/deployment was built; live quote endpoints (`/api/signals`, `/api/overview`, …) are always fresh because they hit the public scanners on demand.

## Deploy

1. Push to `main` (the repo's production branch).
2. Vercel imports the repo with zero config — build command `next build`, output detected automatically (`output: standalone` in `next.config.ts` is ignored by Vercel; the tracing includes still apply).
3. Add the env vars above, redeploy once, done.

## Quick post-deploy checklist

```
/api/health          → {"ok":true,"version":"2.38","db":"up",…}
/api/ai-signals      → {"ok":true,"status":"ready",…}
/api/auth/supabase/challenge → {"ok":true,"token":"…"}
```

If all three are green, everything else is green.
