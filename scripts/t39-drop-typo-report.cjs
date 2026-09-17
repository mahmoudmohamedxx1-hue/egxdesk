/* eslint-disable @typescript-eslint/no-require-imports */
// T39 — delete the stored EOD report for session 2026-09-16 (its LLM-written
// Arabic summary carried the typo "تراجط" for "تراجع"), then let the next
// /api/reports call regenerate a fresh one.
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
(async () => {
  const rows = await db.marketReport.findMany({
    where: { session: "2026-09-16", kind: "eod" },
    select: { id: true, createdAt: true },
  });
  console.log("found:", rows.length);
  if (rows.length) {
    await db.marketReport.deleteMany({ where: { session: "2026-09-16", kind: "eod" } });
    console.log("deleted eod rows for 2026-09-16");
  }
  await db.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
