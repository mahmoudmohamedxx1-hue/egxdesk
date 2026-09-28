#!/usr/bin/env node
/** Detached dev-server launcher (T72): spawns `next dev -p 3000` as a
 *  TRUE daemon (detached process group, stdio → dev.log, unref'd) so it
 *  survives across Bash tool calls in this sandbox. Usage:
 *    node scripts/dev-daemon.mjs          (starts if not already up)
 *    node scripts/dev-daemon.mjs --status (just checks)             */
import { spawn } from "node:child_process";
import { openSync, existsSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const LOG = `${ROOT}dev.log`;

async function up() {
  try {
    const r = await fetch("http://localhost:3000/api/health", { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

if (process.argv.includes("--status")) {
  console.log(await up() ? "up" : "down");
  process.exit(0);
}

if (await up()) {
  console.log("already up");
  process.exit(0);
}

const log = openSync(LOG, "a");
const child = spawn("npx", ["next", "dev", "-p", "3000"], {
  cwd: ROOT,
  detached: true,
  stdio: ["ignore", log, log],
  env: process.env,
});
child.unref();
console.log(`spawned detached pid=${child.pid} — log: dev.log`);
// give it a moment to bind before the launcher (and its shell) exit
await new Promise((r) => setTimeout(r, 1500));
if (!existsSync(LOG)) console.log("(dev.log not found yet — check cwd)");
