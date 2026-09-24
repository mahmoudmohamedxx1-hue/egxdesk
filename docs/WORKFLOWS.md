# The two GitHub Actions (need a one-time manual paste)

The deploy token currently in use lacks the `workflow` scope, so GitHub refuses
git pushes and API calls that create files under `.github/workflows/`. Both
workflows are already written on disk locally — they just need to be added
ONCE, either way:

**Option A (fastest, 2 minutes):** on github.com open this repo →
`Add file → Create new file` → name it `.github/workflows/ownership-refresh.yml`
→ paste the content from that file on your machine (same repository folder) →
Commit. Repeat for `.github/workflows/updates-refresh.yml`. The web editor
needs no token scopes.

**Option B:** create a new fine-grained PAT with **Contents: Read and write**
**AND Workflows: Read and write** permissions, then update the remote:
`git remote set-url origin https://<NEW_PAT>@github.com/mahmoudmohamedxx1-hue/egxdesk.git`
and push again (the two files are untracked-but-present in the working tree).

## What each workflow does

- **ownership-refresh.yml** (T59): daily 03:30 UTC — pulls the freshly parsed
  EGX disclosure archive (with the `ESTHMR_COOKIE` repo secret) and rebuilds
  `src/data/ownership-network.json` for عدسة الملكية. Needs the secret
  `ESTHMR_COOKIE` = `esthmr_session=<value>` (Settings → Secrets and
  variables → Actions). When the cookie expires (~30 days after each login)
  the run fails safely — log in to esthmr.com, copy the fresh cookie, update
  the secret.

- **updates-refresh.yml** (T60): 3× per trading day (07:10 / 11:10 / 16:10 UTC)
  — re-fetches the five news outlets directly (Al Borsa, Hapi, Arab Finance,
  Al Mal, Enterprise) and rebuilds `src/data/news-snapshot.json` (the baseline
  the deployed feed merges for outlets the serverless network cannot reach),
  then merges the day's EGX disclosures into `src/data/disclosures.json`.
  Also uses the same `ESTHMR_COOKIE` secret (fails safely without it).

Both commit + push automatically when data changes → Vercel auto-deploys →
the screens' "as of" stamps move on their own.
