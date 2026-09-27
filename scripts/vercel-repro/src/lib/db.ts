import { PrismaClient } from "@prisma/client";
import path from "node:path";
import fs from "node:fs";

/**
 * The SQLite file lives at <project>/db/custom.db. The runtime
 * `datasources` override resolves `file:` URLs against the process CWD,
 * which breaks in `output: standalone` mode (server runs from
 * .next/standalone). Resolve an absolute path that works for every
 * supported launch directory (project root, .next/standalone, or one
 * level below the root).
 *
 * T50 — SERVERLESS (Vercel): the deployment bundle carries a READ-ONLY
 * copy of db/custom.db (next.config.ts `outputFileTracingIncludes`), but
 * SQLite must open the file read-WRITE (journal/WAL sidecars) and the
 * only writable directory on a serverless instance is /tmp. So on Vercel
 * we copy the bundled db to /tmp ONCE per instance and point Prisma at
 * the copy: every read (market history, AI signal sets, news archive,
 * agent records) works exactly like local; writes (agent runs, push
 * subscriptions, usage events) are ephemeral per-instance — the honest
 * trade-off of a preview on serverless, and the reason the full
 * experience lives on the always-on preview server.
 *
 * VERCEL_TMP_DIR exists so the exact code path can be tested locally
 * without touching /tmp.
 */

function resolveDbUrl(): string {
  const cwd = process.cwd();
  const argv1 = process.argv[1] ?? "";
  const serverDir = path.dirname(path.resolve(argv1));
  const candidates = [
    path.join(cwd, "db", "custom.db"), // launched from project root
    path.join(cwd, "..", "db", "custom.db"), // launched one level below root
    path.join(cwd, "..", "..", "db", "custom.db"), // launched from .next/standalone
    path.join(serverDir, "..", "..", "db", "custom.db"), // derived from server.js location
  ];
  const source = candidates.find((c) => {
    try {
      return fs.existsSync(c);
    } catch {
      return false;
    }
  });

  if (process.env.VERCEL) {
    const tmpDir = process.env.VERCEL_TMP_DIR || "/tmp";
    const tmpDb = path.join(tmpDir, "egx-custom.db");
    // once per instance — the global flag survives module re-imports within
    // the same lambda warm life
    const g = globalThis as unknown as { __egxDbCopiedToTmp?: string };
    try {
      if (source && g.__egxDbCopiedToTmp !== tmpDb) {
        fs.copyFileSync(source, tmpDb);
        g.__egxDbCopiedToTmp = tmpDb;
        console.log(`[db] serverless: copied ${source} → ${tmpDb} (${fs.statSync(tmpDb).size} bytes)`);
      }
      if (fs.existsSync(tmpDb)) return `file:${tmpDb}`;
    } catch (err) {
      console.warn("[db] serverless copy failed:", err instanceof Error ? err.message : err);
    }
    // fall through to the read-only path — reads may still work, and the
    // error surfaces honestly in /api/health
  }

  return `file:${source ?? candidates[0]}`;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: resolveDbUrl() } },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
