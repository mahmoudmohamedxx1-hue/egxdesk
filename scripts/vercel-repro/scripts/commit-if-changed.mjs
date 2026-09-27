#!/usr/bin/env node
/** commit-if-changed.mjs — the churn-proof commit step for the two daily
 *  refresh workflows (and safe for manual runs).
 *
 *  WHY: the data documents carry a top-level `asOf` stamp that bumps on every
 *  successful refresh even when nothing real changed — a naive `git add` +
 *  `git diff --cached` commit would push (and Vercel-deploy) three times a
 *  day on zero news. This script commits ONLY the given paths whose STABLE
 *  content (JSON with `asOf` removed) differs from HEAD.
 *
 *  Usage:
 *    node scripts/commit-if-changed.mjs "<commit message>" <path> [path...]
 *
 *  Exit 0 both when it committed and when it correctly skipped (the workflow
 *  step stays green either way); exit 1 only on a real git failure. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [message, ...files] = process.argv.slice(2);
if (!message || !files.length) {
  console.error('usage: commit-if-changed.mjs "<message>" <path> [path...]');
  process.exit(2);
}

const stable = (bytes) => {
  try {
    const o = JSON.parse(bytes.toString("utf8"));
    delete o.asOf;
    return JSON.stringify(o);
  } catch {
    return null; // not valid JSON → never commit blind
  }
};

const sh = (args) => execFileSync("git", args, { cwd: ROOT }).toString();

const changed = [];
for (const f of files) {
  let local;
  try {
    local = fs.readFileSync(path.join(ROOT, f));
  } catch {
    continue; // file absent → nothing to commit from this path
  }
  let head = null;
  try {
    head = sh(["show", `HEAD:${f}`]);
  } catch {
    /* not yet tracked → brand new file */
  }
  const a = stable(local);
  if (a === null) {
    console.log(`skip ${f}: not valid JSON — refusing to commit (protecting the repo)`);
    continue;
  }
  const b = head ? stable(Buffer.from(head)) : null;
  if (b === null || a !== b) changed.push(f);
}

if (!changed.length) {
  console.log("no data changes (asOf-only diffs excluded) — nothing to commit");
  process.exit(0);
}

execFileSync("git", ["add", ...changed], { cwd: ROOT, stdio: "inherit" });
execFileSync("git", ["commit", "-m", message], { cwd: ROOT, stdio: "inherit" });
execFileSync("git", ["push"], { cwd: ROOT, stdio: "inherit" });
console.log(`committed + pushed: ${changed.join(", ")}`);
