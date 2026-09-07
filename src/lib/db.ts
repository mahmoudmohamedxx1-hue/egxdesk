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
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return `file:${c}`;
    } catch {}
  }
  return `file:${candidates[0]}`;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: resolveDbUrl() } },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
