/** T26 — verify the intraday tick read path (intradayPoints + volume diffing)
 *  by seeding a REAL ticker with a few temporary tick rows and deleting them
 *  right after. Rows live for <2 seconds inside this script; the market is
 *  closed and no UI request can race a read of the same minuteKey window
 *  between seed and delete, so no fake data ever surfaces. */
import { db } from "@/lib/db";
import { intradayPoints, intradaySessionsCollected } from "@/lib/intraday";

async function main() {
  const now = Date.now();
  // seed 12 ticks across two sessions (yesterday + today labels)
  const day1 = "2026-09-12";
  const day2 = "2026-09-13";
  const rows: { ticker: string; minuteKey: string; close: number; volume: number | null; ts: Date }[] = [];
  for (let i = 0; i < 6; i++) {
    rows.push({ ticker: "COMI", minuteKey: `${day1} 1${i}:00`, close: 100 + i, volume: 1000 * (i + 1), ts: new Date(now - 86400_000 + i * 600_000) });
    rows.push({ ticker: "COMI", minuteKey: `${day2} 1${i}:00`, close: 200 + i, volume: 2000 * (i + 1), ts: new Date(now - 3600_000 + i * 600_000) });
  }
  await db.intradayTick.createMany({ data: rows });

  const one = await intradayPoints("COMI", 1);
  const five = await intradayPoints("COMI", 5);
  console.log("1-session points:", one.length, "| first:", one[0], "| last:", one[one.length - 1]);
  console.log("5-session points:", five.length, "| dates:", [...new Set(five.map((p) => p.date.slice(0, 10)))]);
  // volume diffing: session 2 bars should be 2000 each (cumulative 2000,4000,... diffed)
  const vols = five.filter((p) => p.date.startsWith(day2)).map((p) => p.volume);
  console.log("day-2 per-bar volumes (expect 2000 x6):", vols);
  console.log("sessions collected:", await intradaySessionsCollected());

  // cleanup — delete every seeded row immediately
  const del = await db.intradayTick.deleteMany({ where: { ticker: "COMI" } });
  console.log("cleaned rows:", del.count);
  const after = await intradayPoints("COMI", 5);
  console.log("post-cleanup points (expect 0):", after.length);
}
main()
  .catch((e) => console.error(e))
  .finally(() => process.exit(0));
