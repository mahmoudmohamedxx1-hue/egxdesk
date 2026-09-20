#!/usr/bin/env node
/**
 * T55 — assemble the standalone output AFTER `next build`, failure-proof.
 *
 * Why: the old build script chained raw `cp -r .next/static
 * .next/standalone/.next/ && cp -r public .next/standalone/` which HARD-FAILS
 * whenever `.next/standalone` is not emitted (Turbopack does not always write
 * it — e.g. when another build/dev process shares .next). A missing folder
 * turned `npm run build` itself into a failure, which would abort any host
 * that runs the package.json build script (Vercel with a custom Build Command
 * override, CI, local). Vercel's default Next.js preset runs plain
 * `next build` and never needs the standalone assembly — but the script must
 * never be the reason a deployment fails.
 *
 * Behavior: if `.next/standalone` exists → copy static + public in (same
 * result as before). If it does not → print a note and exit 0. Idempotent. */
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  console.log(
    "[assemble-standalone] no .next/standalone output (Turbopack skipped it or .next is shared) — skipping assembly, build still OK"
  );
  process.exit(0);
}

const staticSrc = join(root, ".next", "static");
const staticDst = join(standalone, ".next", "static");
if (existsSync(staticSrc)) {
  rmSync(staticDst, { recursive: true, force: true });
  cpSync(staticSrc, staticDst, { recursive: true });
  console.log("[assemble-standalone] copied .next/static into standalone");
}

const publicSrc = join(root, "public");
const publicDst = join(standalone, "public");
if (existsSync(publicSrc)) {
  rmSync(publicDst, { recursive: true, force: true });
  cpSync(publicSrc, publicDst, { recursive: true });
  console.log("[assemble-standalone] copied public/ into standalone");
}

console.log("[assemble-standalone] done");
