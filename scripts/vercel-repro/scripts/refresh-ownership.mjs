#!/usr/bin/env node
/** T59 — daily عدسة الملكية refresh: pull the freshly parsed EGX disclosure
 *  archive (insider-people + sector-ownership) with the esthmr session cookie,
 *  validate it, archive it, then rebuild the compact client network
 *  (src/data/ownership-network.json) via the same deterministic T58 builder.
 *
 *  Run manually (uses the local cookie jar):
 *      node scripts/refresh-ownership.mjs
 *  Or from GitHub Actions / CI (cookie from the ESTHMR_COOKIE secret):
 *      ESTHMR_COOKIE="esthmr_session=…" node scripts/refresh-ownership.mjs
 *
 *  Failure is SAFE by design: any fetch/validation error exits 1 WITHOUT
 *  touching the shipped network file — the lens keeps serving the last good
 *  data (its badge honestly shows the older as-of date). */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(ROOT, "scripts", "research", "t58-esthmr-live");
const COOKIE_JAR = path.join(ROOT, "scripts", "research", "esthmr-session.txt");

const FILES = [
  { name: "insider-people.json", min: 1_000, count: (j) => j.people?.length },
  { name: "sector-ownership.json", min: 20, count: (j) => j.links?.length },
];

function cookieHeader() {
  if (process.env.ESTHMR_COOKIE && process.env.ESTHMR_COOKIE.includes("=")) {
    return process.env.ESTHMR_COOKIE.trim();
  }
  // local manual runs: pull esthmr_session out of the Netscape jar
  try {
    const jar = fs.readFileSync(COOKIE_JAR, "utf8");
    const m = jar.match(/esthmr_session\s+(\S+)/);
    if (m) return `esthmr_session=${m[1]}`;
  } catch {}
  console.error("refresh: no esthmr session cookie (set ESTHMR_COOKIE or provide scripts/research/esthmr-session.txt)");
  process.exit(1);
}

const cookie = cookieHeader();
console.log("refresh: cookie loaded, fetching fresh EGX disclosure archive…");

for (const f of FILES) {
  const res = await fetch(`https://esthmr.com/data/v1/${f.name}`, {
    headers: { Cookie: cookie },
  });
  if (!res.ok) {
    console.error(`refresh: ${f.name} → HTTP ${res.status} — keeping the last good data (nothing written)`);
    process.exit(1);
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error(`refresh: ${f.name} is not valid JSON (${text.slice(0, 80)}) — nothing written`);
    process.exit(1);
  }
  const n = f.count(json) ?? 0;
  if (n < f.min) {
    console.error(`refresh: ${f.name} failed validation (${n} records < ${f.min}) — nothing written`);
    process.exit(1);
  }
  fs.writeFileSync(path.join(SRC_DIR, f.name), text);
  const gen = json.generated ?? json.asOf ?? "?";
  console.log(`refresh: ${f.name} OK — ${n} records, generated ${gen}`);
}

// rebuild the compact network (deterministic; repo-relative paths)
console.log("refresh: rebuilding src/data/ownership-network.json …");
execFileSync(process.execPath, [path.join(ROOT, "scripts", "t58-build-ownership-network.mjs")], {
  stdio: "inherit",
  cwd: ROOT,
});

// post-build sanity: the shipped file must be complete
const net = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "data", "ownership-network.json"), "utf8"));
if (!net.people?.length || net.people.length < 1000 || !net.positions?.length || net.positions.length < 1000) {
  console.error("refresh: rebuilt network failed sanity checks — check the builder output above");
  process.exit(1);
}
console.log(`refresh: DONE — asOf ${net.asOf}, ${net.people.length} parties, ${net.positions.length} positions.`);
