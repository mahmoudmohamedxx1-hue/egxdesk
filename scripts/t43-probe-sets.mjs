import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const rows = await db.aiSignalSet.findMany({ orderBy: { createdAt: "desc" }, take: 30, select: { id: true, createdAt: true, strategyRev: true, data: true } });
console.log("total sets:", rows.length);
for (const r of rows) {
  try {
    const d = JSON.parse(r.data);
    const picks = (d.picks ?? []).map(p => `${p.ticker}:${p.stance}@${p.entry ?? "-"}`);
    console.log(r.createdAt.toISOString().slice(0, 16), r.strategyRev, "|", picks.join(" "));
  } catch { console.log(r.createdAt.toISOString().slice(0,16), "unparseable"); }
}
await db.$disconnect();
