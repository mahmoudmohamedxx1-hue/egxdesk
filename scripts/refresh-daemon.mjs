#!/usr/bin/env node
/** refresh-daemon.mjs — the sandbox-side replacement for the two daily GitHub
 *  Actions (ownership-refresh.yml + updates-refresh.yml).
 *
 *  WHY THIS EXISTS: the deploy PAT carries only the `repo` scope, and GitHub
 *  refuses to let a repo-scoped token create or update ANY file under
 *  .github/workflows/ (enforced on git push, the Contents API, GraphQL
 *  createCommitOnBranch AND the Git-Data trees endpoint — all four were
 *  probed on 2026-09-25). So the workflow files cannot land until a
 *  workflow-scoped token exists (docs/WORKFLOWS.md §native). This daemon
 *  runs the exact same scripts on the exact same schedule and lands the
 *  data commits through the Git-Data API — which a repo scope CAN do for
 *  regular data files (proven live).
 *
 *  WHAT IT DOES (backstopping the NATIVE GitHub Actions — they are the
 *  primary mechanism since 2026-09-25, landed with a workflow-scoped token
 *  and verified green; this daemon runs +30 min AFTER each Action slot so
 *  the two can never race on the same commit):
 *    · updates job   — Sun–Thu (the EGX trading week) at 07:40 / 11:40 /
 *                      16:40 UTC: `refresh-news.mjs --via-reader` — the ONLY
 *                      path that can refresh hapi (Cloudflare walls its RSS
 *                      to GitHub-runner AND Vercel IPs; the sandbox reader
 *                      service passes) — then `refresh-disclosures.mjs`
 *                      (needs the local esthmr cookie file; fails SAFE).
 *                      Commits news-snapshot.json + disclosures.json.
 *    · ownership job — daily 04:00 UTC: `refresh-ownership.mjs` (same
 *                      cookie; fails SAFE). Commits ownership-network.json.
 *    · Only commits when the DATA changed (asOf stamps are ignored in the
 *      diff), never force-pushes, never deletes anything, and syncs the
 *      local branch back to remote after every API commit.
 *
 *  SECRETS (gitignored, on disk only):
 *    · server-secrets/github-token.txt  — the classic PAT (repo scope).
 *    · server-secrets/esthmr-cookie.txt — one line: the esthmr_session
 *      value (with or without the "esthmr_session=" prefix). Lines starting
 *      with "#" are comments. When it is empty/invalid the cookie-dependent
 *      steps are skipped honestly and the shipped data stays frozen — paste
 *      a fresh cookie after logging in on esthmr.com and the next run picks
 *      it up automatically.
 *
 *  STATE + LOGS: scripts/refresh-state.json (survives restarts → missed
 *  slots are caught up) and scripts/refresh-daemon.log (gitignored).
 *
 *  CLI:
 *    node scripts/refresh-daemon.mjs                  → the scheduler loop
 *    node scripts/refresh-daemon.mjs --once updates   → run one job now
 *    node scripts/refresh-daemon.mjs --once ownership → run one job now
 *
 *  Launch detached: python3 scripts/start-refresh-daemon.py */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_FILE = path.join(ROOT, "scripts", "refresh-state.json");
const LOG_FILE = path.join(ROOT, "scripts", "refresh-daemon.log");
const TOKEN_FILE = path.join(ROOT, "server-secrets", "github-token.txt");
const COOKIE_FILE = path.join(ROOT, "server-secrets", "esthmr-cookie.txt");

const REPO = "mahmoudmohamedxx1-hue/egxdesk";
const BRANCH = "main";
const API = `https://api.github.com/repos/${REPO}`;

const DATA_FILES = {
  news: path.join(ROOT, "src/data/news-snapshot.json"),
  disclosures: path.join(ROOT, "src/data/disclosures.json"),
  ownership: path.join(ROOT, "src/data/ownership-network.json"),
};

// ── logging ────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  // when daemonized, stdout IS the log file (start-refresh-daemon.py dup2)
  // and the launcher sets REFRESH_DAEMON_REDIRECTED=1 so we do not double
  // every line; manual --once runs append for the audit trail
  try {
    if (!process.env.REFRESH_DAEMON_REDIRECTED) {
      fs.appendFileSync(LOG_FILE, line + "\n");
    }
  } catch {}
}

// ── secrets ────────────────────────────────────────────────────────────────
function readToken() {
  try {
    const t = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    return t.length > 10 ? t : null;
  } catch {
    return null;
  }
}

function readCookie() {
  try {
    const lines = fs
      .readFileSync(COOKIE_FILE, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    if (!lines.length) return null;
    let v = lines[0];
    if (v.startsWith("esthmr_session=")) v = v.slice("esthmr_session=".length);
    return v.length > 10 ? `esthmr_session=${v}` : null;
  } catch {
    return null;
  }
}

// ── state (survives restarts → catch-up) ───────────────────────────────────
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { updates: {}, ownership: {} };
  }
}
function saveState(s) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  } catch {}
}

// ── GitHub API (git-data commit engine) ────────────────────────────────────
async function api(path, body, method = "POST", token) {
  const res = await fetch(`${API}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "egxdesk-refresh-daemon",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/** remote head {sha, treeSha} */
async function remoteHead(token) {
  const r = await api(`git/ref/heads/${BRANCH}`, null, "GET", token);
  if (r.status !== 200) throw new Error(`ref read ${r.status}`);
  const sha = r.json.object.sha;
  const c = await api(`git/commits/${sha}`, null, "GET", token);
  if (c.status !== 200) throw new Error(`commit read ${c.status}`);
  return { sha, treeSha: c.json.tree.sha };
}

/** bytes of tracked files at the given tree — ONE recursive listing, then a
 *  blob GET per path. Returns { path → Buffer|null } */
async function remoteFileMap(token, treeSha, repoPaths) {
  const t = await api(`git/trees/${treeSha}?recursive=1`, null, "GET", token);
  if (t.status !== 200) throw new Error(`tree read ${t.status}`);
  const entries = new Map((t.json.tree || []).filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
  const out = new Map();
  for (const p of repoPaths) {
    const sha = entries.get(p);
    if (!sha) {
      out.set(p, null);
      continue;
    }
    const b = await api(`git/blobs/${sha}`, null, "GET", token);
    if (b.status !== 200) throw new Error(`blob read ${p} ${b.status}`);
    out.set(p, Buffer.from(b.json.content, "base64"));
  }
  return out;
}

/** strip volatile stamps so a pure asOf bump never triggers a deploy */
function stableJson(bytes) {
  try {
    const o = JSON.parse(bytes.toString("utf8"));
    delete o.asOf;
    return JSON.stringify(o);
  } catch {
    return null; // not valid JSON → treat as "unknown", never commit blind
  }
}

/**
 * Commit the given files (repo-relative paths) with `message` via the
 * Git-Data API. Commits ONLY files whose stable content differs from the
 * remote blobs. Returns the commit sha or null when nothing changed.
 */
async function commitFiles(token, repoPaths, message) {
  const head = await remoteHead(token);
  const remote = await remoteFileMap(token, head.treeSha, repoPaths);
  const changed = [];
  for (const p of repoPaths) {
    const abs = path.join(ROOT, p);
    let local;
    try {
      local = fs.readFileSync(abs);
    } catch {
      continue; // file missing → nothing to commit from this path
    }
    if (local.length > 15_000_000) {
      log(`commit: ${p} is ${local.length} bytes — over the safety cap, skipped`);
      continue;
    }
    if (stableJson(local) === null) {
      log(`commit: ${p} is not valid JSON — refusing to commit (protecting the repo)`);
      continue;
    }
    const rem = remote.get(p);
    if (rem === null || !stableJson(rem) || stableJson(rem) !== stableJson(local)) {
      changed.push({ p, abs, local });
    }
  }
  if (!changed.length) {
    log("commit: data unchanged (asOf-only diffs excluded) — nothing to commit");
    return null;
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    const h = attempt === 1 ? head : await remoteHead(token);
    const treeItems = [];
    for (const c of changed) {
      const b = await api("git/blobs", { content: c.local.toString("utf8"), encoding: "utf-8" }, "POST", token);
      if (b.status !== 201) throw new Error(`blob create ${b.status} ${JSON.stringify(b.json).slice(0, 120)}`);
      treeItems.push({ path: c.p, mode: "100644", type: "blob", sha: b.json.sha });
    }
    const t = await api("git/trees", { base_tree: h.treeSha, tree: treeItems }, "POST", token);
    if (t.status !== 201) throw new Error(`tree create ${t.status} ${JSON.stringify(t.json).slice(0, 120)}`);
    const cm = await api(
      "git/commits",
      { message, tree: t.json.sha, parents: [h.sha] },
      "POST",
      token,
    );
    if (cm.status !== 201) throw new Error(`commit create ${cm.status} ${JSON.stringify(cm.json).slice(0, 120)}`);
    const ref = await api(`git/refs/heads/${BRANCH}`, { sha: cm.json.sha, force: false }, "PATCH", token);
    if (ref.status === 200) {
      log(`commit: ${cm.json.sha.slice(0, 10)} landed — ${changed.map((c) => path.basename(c.p)).join(", ")}`);
      return cm.json.sha;
    }
    if (ref.status === 422 && attempt === 1) {
      log("commit: ref raced with another writer — retrying once on the fresh head");
      continue;
    }
    throw new Error(`ref update ${ref.status} ${JSON.stringify(ref.json).slice(0, 160)}`);
  }
  return null;
}

/** fast-forward the local branch to origin/main without losing local edits */
function syncLocalBranch() {
  try {
    execFileSync("git", ["fetch", "origin", BRANCH], { cwd: ROOT, stdio: "ignore" });
    const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", "HEAD", `origin/${BRANCH}`], {
      cwd: ROOT,
    });
    if (ancestor.status === 0) {
      execFileSync("git", ["reset", `origin/${BRANCH}`], { cwd: ROOT, stdio: "ignore" });
    }
  } catch (e) {
    log(`sync: local branch sync skipped (${String(e).slice(0, 80)})`);
  }
}

// ── job runners ─────────────────────────────────────────────────────────────
function runScript(args, env, timeoutMin) {
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    timeout: timeoutMin * 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const out = `${r.stdout || ""}${r.stderr || ""}`.trim().split("\n").slice(-6).join(" | ");
  return { ok: r.status === 0, out };
}

async function jobUpdates(state) {
  log("job updates: start (news refresh — cookie-free)");
  const news = runScript([path.join(ROOT, "scripts/refresh-news.mjs"), "--via-reader"], {}, 9);
  log(`job updates: news ${news.ok ? "OK" : "FAILED"} — ${news.out}`);
  if (!news.ok) {
    // fail-safe by design: the shipped snapshot stays untouched
    state.updates.lastFailure = new Date().toISOString();
    saveState(state);
  }

  const cookie = readCookie();
  if (cookie) {
    const disc = runScript([path.join(ROOT, "scripts/refresh-disclosures.mjs")], { ESTHMR_COOKIE: cookie }, 4);
    log(`job updates: disclosures ${disc.ok ? "OK" : "FAILED (shipped archive untouched)"} — ${disc.out}`);
  } else {
    log("job updates: no esthmr cookie on file — disclosures step SKIPPED (shipped archive stays; paste a fresh one into server-secrets/esthmr-cookie.txt)");
  }

  const token = readToken();
  if (token) {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
    try {
      const sha = await commitFiles(token, ["src/data/news-snapshot.json", "src/data/disclosures.json"], `data: updates section refresh (${stamp})`);
      if (sha) syncLocalBranch();
    } catch (e) {
      log(`job updates: COMMIT FAILED — ${String(e).slice(0, 200)}`);
    }
  } else {
    log("job updates: no github token on file — data refreshed locally only (no deploy)");
  }
  state.updates.lastRun = new Date().toISOString();
  saveState(state);
}

async function jobOwnership(state) {
  const cookie = readCookie();
  if (!cookie) {
    log("job ownership: no esthmr cookie on file — SKIPPED (shipped network stays; paste a fresh one into server-secrets/esthmr-cookie.txt)");
    state.ownership.lastRun = new Date().toISOString();
    saveState(state);
    return;
  }
  log("job ownership: start (ownership network rebuild)");
  const r = runScript([path.join(ROOT, "scripts/refresh-ownership.mjs")], { ESTHMR_COOKIE: cookie }, 6);
  log(`job ownership: ${r.ok ? "OK" : "FAILED (shipped network untouched)"} — ${r.out}`);

  const token = readToken();
  if (token && r.ok) {
    const day = new Date().toISOString().slice(0, 10);
    try {
      const sha = await commitFiles(token, ["src/data/ownership-network.json"], `data: ownership lens daily refresh (${day})`);
      if (sha) syncLocalBranch();
    } catch (e) {
      log(`job ownership: COMMIT FAILED — ${String(e).slice(0, 200)}`);
    }
  } else if (!token) {
    log("job ownership: no github token on file — data refreshed locally only (no deploy)");
  }
  state.ownership.lastRun = new Date().toISOString();
  saveState(state);
}

// ── scheduler ───────────────────────────────────────────────────────────────
const UPDATES_SLOTS = [
  { h: 7, m: 40 },
  { h: 11, m: 40 },
  { h: 16, m: 40 },
];
const OWNERSHIP_SLOT = { h: 4, m: 0 };

const utc = (d) => ({ day: d.getUTCDay(), date: d.toISOString().slice(0, 10), hm: d.getUTCHours() * 60 + d.getUTCMinutes() });
const isTradingDay = (day) => day >= 0 && day <= 4; // Sunday..Thursday — the EGX week

function dueJobs(state) {
  const now = new Date();
  const { day, date, hm } = utc(now);
  const jobs = [];
  // one run per slot boundary, and ONE catch-up run after any restart:
  // due when the LATEST passed slot of today has not been served yet
  let latestIdx = -1;
  UPDATES_SLOTS.forEach((s, i) => {
    if (hm >= s.h * 60 + s.m) latestIdx = i;
  });
  if (isTradingDay(day) && latestIdx >= 0 && state.updates.lastSlot !== `${date}#${latestIdx}`) {
    jobs.push({ name: "updates", slot: `${date}#${latestIdx}` });
  }
  if (hm >= OWNERSHIP_SLOT.h * 60 + OWNERSHIP_SLOT.m && state.ownership.lastDay !== date) {
    jobs.push({ name: "ownership", day: date });
  }
  return jobs;
}

let running = false;
async function runDue() {
  if (running) return;
  const state = loadState();
  const due = dueJobs(state);
  if (!due.length) return;
  running = true;
  try {
    for (const j of due) {
      if (j.name === "updates") {
        log(`scheduler: updates job due (slot ${j.slot})`);
        await jobUpdates(state);
        state.updates.lastSlot = j.slot;
        saveState(state);
      } else {
        log(`scheduler: ownership job due (${j.day})`);
        await jobOwnership(state);
        state.ownership.lastDay = j.day;
        saveState(state);
      }
    }
  } finally {
    running = false;
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const once = process.argv.includes("--once");
if (once) {
  const which = process.argv[process.argv.indexOf("--once") + 1];
  const state = loadState();
  if (which === "updates") {
    await jobUpdates(state);
    // mark the latest slot that has already passed so the scheduler does not
    // immediately re-run the same trading day's refresh after a manual run
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    let idx = -1;
    UPDATES_SLOTS.forEach((s, i) => {
      if (now.getUTCHours() * 60 + now.getUTCMinutes() >= s.h * 60 + s.m) idx = i;
    });
    state.updates.lastSlot = idx >= 0 ? `${date}#${idx}` : `${date}#manual`;
    saveState(state);
  } else if (which === "ownership") {
    await jobOwnership(state);
    state.ownership.lastDay = new Date().toISOString().slice(0, 10);
    saveState(state);
  } else {
    console.error("usage: --once updates|ownership");
    process.exit(2);
  }
  process.exit(0);
}

log("scheduler: refresh-daemon started (updates Sun–Thu 07:40/11:40/16:40 UTC · ownership daily 04:00 UTC · +30min after each Action slot · catch-up on start)");
setInterval(runDue, 20_000);
runDue().catch((e) => log(`scheduler: tick error ${String(e).slice(0, 160)}`));
