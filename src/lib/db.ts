import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: "file:../db/custom.db" } },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
