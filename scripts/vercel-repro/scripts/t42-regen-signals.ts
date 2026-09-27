/** Clear the pre-ensemble aiSignalSet rows so the next GET regenerates under
 *  the egx-multi-v2 pipeline (dev daemon keeps its own module cache — we bump
 *  the DB directly via Prisma). */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const n = await db.aiSignalSet.deleteMany({});
console.log(`deleted ${n.count} aiSignalSet rows — next /api/ai-signals GET regenerates under egx-multi-v2`);
await db.$disconnect();
