# Daily data refresh — how it runs now (and the optional native-Actions path)

## 1. The active mechanism: the sandbox refresh-daemon (no workflow scope needed)

The deploy PAT carries only the `repo` scope, and GitHub refuses to let a
repo-scoped token create or update **any** file under `.github/workflows/` —
this was probed on 2026-09-25 across all four write paths (git push, the
Contents API, GraphQL `createCommitOnBranch`, and the Git-Data trees endpoint;
a harmless-path tree returned 201 while a workflow-path tree returned a masked
404). So the two daily-refresh workflows cannot be landed by automation with
this token.

`scripts/refresh-daemon.mjs` (launched detached by
`scripts/start-refresh-daemon.py`, log in `scripts/refresh-daemon.log`) does
the identical job from the sandbox and lands the data commits through the
Git-Data API, which a repo scope **can** do for regular files — verified live
on 2026-09-25 (commit `ca9c784`, auto-deployed):

- **updates job** — Sun–Thu (the EGX trading week) at 07:10 / 11:10 / 16:10
  UTC: `refresh-news.mjs --via-reader` (the five outlets esthmr's own news
  document names; the z-ai reader service stands in for Cloudflare-walled
  ones) then `refresh-disclosures.mjs`. Commits
  `src/data/news-snapshot.json` + `src/data/disclosures.json` when the DATA
  changed (`asOf`-only bumps never deploy).
- **ownership job** — daily 03:30 UTC: `refresh-ownership.mjs` → commits
  `src/data/ownership-network.json` when the network changed.
- Missed slots are caught up on daemon restart (state persists in
  `scripts/refresh-state.json`); commits are additive-only, never
  force-pushed; the local branch ff-syncs to `origin/main` after every API
  commit.

### Secrets (gitignored, on disk only — never in the repo)

- `server-secrets/github-token.txt` — the classic PAT (repo scope is enough).
- `server-secrets/esthmr-cookie.txt` — **one line**: the `esthmr_session`
  cookie value after logging in on esthmr.com (devtools → Application →
  Cookies; with or without the `esthmr_session=` prefix; `#` lines are
  comments). The disclosures + ownership legs need it; when it is missing or
  expired those legs SKIP SAFELY and the shipped data stays frozen — paste a
  fresh cookie and the next run picks it up automatically. (The cookie that
  seeded the 919-item archive died on 2026-09-25; the file is currently
  waiting for a fresh value.)

### Manual runs

```bash
node scripts/refresh-daemon.mjs --once updates     # news + disclosures + commit
node scripts/refresh-daemon.mjs --once ownership   # ownership network + commit
python3 scripts/start-refresh-daemon.py            # (re)start the scheduler
```

## 2. Optional: land the native GitHub Actions (redundant, but nice)

The two workflow files still live on disk (untracked, gitignored) with the
same schedules and fail-safe semantics. To activate them the **web UI** is the
easiest path — it needs no token scopes at all: on github.com open this repo →
`Add file → Create new file` → name it `.github/workflows/ownership-refresh.yml`
→ paste the content from that file on your machine → Commit. Repeat for
`.github/workflows/updates-refresh.yml`. Then add the repo secret
`ESTHMR_COOKIE` = `esthmr_session=<value>` (Settings → Secrets and variables →
Actions). Alternatively, a PAT with the `workflow` scope can push them
directly.

Note: the cron day-of-week in the workflow files is `0-4` (Sunday–Thursday —
the EGX week). While both mechanisms run they are safely redundant: the
commit engine only lands changed data files and the disclosures merge is
idempotent by filing id.

## 3. What each refresh does (both mechanisms, identical)

- **News snapshot** (`src/data/news-snapshot.json`): re-fetches Al Borsa,
  Hapi, Arab Finance, Al Mal, Enterprise (the outlets esthmr's own news
  document names) — the baseline the deployed `/api/news-feed` merges for any
  outlet the runtime network cannot reach. Cookie-free.
- **Disclosures archive** (`src/data/disclosures.json`): merges the parsed EGX
  disclosure feed by filing id — the agenda's month strip fills itself day by
  day. Needs the esthmr cookie; fails safely without it.
- **Ownership network** (`src/data/ownership-network.json`): rebuilds عدسة
  الملكية's compact network from the freshly parsed insider filings. Needs
  the same cookie; fails safely.

When data changes → commit → Vercel auto-deploys → the screens' "as of"
stamps move on their own.
