# Daily data refresh — the two GitHub Actions (LIVE since 2026-09-25)

Both workflows are **landed, dispatched, and verified green** on
`.github/workflows/`:

- **updates-daily-refresh** — Sun–Thu (the EGX trading week) at 07:10 / 11:10
  / 16:10 UTC: re-fetches the five news outlets (Al Borsa, Arab Finance,
  Al Mal, Enterprise directly; **hapi is Cloudflare-walled to GitHub runners
  too** — its last-known items are CARRIED in the snapshot by
  `refresh-news.mjs` instead of being wiped, and the sandbox daemon's
  reader-fallback refreshes them 30 minutes later), then merges the day's EGX
  disclosures (the `ESTHMR_COOKIE` secret — **set and working**). Commits via
  `scripts/commit-if-changed.mjs`, which skips pure `asOf` bumps so a no-news
  run never triggers a Vercel deploy.
- **ownership-daily-refresh** — daily 03:30 UTC: pulls the freshly parsed EGX
  disclosure archive with the same secret and rebuilds عدسة الملكية's compact
  network. First live run: 1,420 parties / 1,655 positions / 47 weekly
  periods, committed and auto-deployed.

When either workflow's data changes → commit → push → Vercel auto-deploys →
the screens' "as of" stamps move on their own. The `ESTHMR_COOKIE` secret
expires roughly 30 days after each esthmr.com login — when it does, the
updates workflow's disclosures step fails SOFTLY (continue-on-error: shipped
archive stays; the news leg is cookie-free) while the ownership workflow's
red ✗ is the designed "re-login" alarm: log in on esthmr.com, copy the fresh
`esthmr_session` cookie, and update
Settings → Secrets and variables → Actions → ESTHMR_COOKIE.

## The sandbox daemon (backstop, not primary)

`scripts/refresh-daemon.mjs` (launched by `scripts/start-refresh-daemon.py`,
log in `scripts/refresh-daemon.log`) runs the same refresh scripts **+30
minutes after each Action slot** (07:40 / 11:40 / 16:40 UTC updates,
04:00 UTC ownership) so the two can never race on a commit. Its unique job:
it is the ONLY path that can refresh **hapi** (the z-ai reader service passes
Cloudflare where GitHub-runner and Vercel IPs are walled). If the sandbox
resets, relaunch it with `python3 scripts/start-refresh-daemon.py` — until
then hapi's items age out of the snapshot honestly after ~96 h.

Its cookie-dependent legs (disclosures + ownership) read
`server-secrets/esthmr-cookie.txt` (one line: the cookie value, `#` comments
allowed) — optional now that the Actions own those legs; blank = skipped
safely.

## Manual runs

```bash
node scripts/refresh-daemon.mjs --once updates     # news + disclosures + commit
node scripts/refresh-daemon.mjs --once ownership   # ownership network + commit
python3 scripts/start-refresh-daemon.py            # (re)start the backstop
```

Or trigger either workflow by hand from the repo's Actions tab
(workflow_dispatch is enabled on both).

## Token hygiene

The git remote and `server-secrets/github-token.txt` hold the workflow-scoped
PAT. The earlier repo-only PAT (`ghp_cQax…`) is no longer used — revoke it at
github.com → Settings → Developer settings → Tokens (classic) if it is still
active.
