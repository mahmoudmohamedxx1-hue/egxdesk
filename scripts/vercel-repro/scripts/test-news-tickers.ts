/** T26 — sanity-check Arabic ticker attribution on the real news archive. */
import { db } from "@/lib/db";
import { tickersInText } from "@/lib/sentiment";
import { AR_ALIASES } from "@/lib/ar-search";
import { fetchUniverse } from "@/lib/market";

async function main() {
  const universe = (await fetchUniverse()).map((s) => ({ ticker: s.ticker, name: s.name }));
  const rows = await db.newsPost.findMany({ orderBy: { publishedAt: "desc" }, take: 400 });
  let hits = 0;
  const samples: string[] = [];
  for (const r of rows) {
    const text = `${r.title} ${r.snippet ?? ""}`;
    const tk = tickersInText(text, universe, AR_ALIASES);
    if (tk.length) {
      hits++;
      if (samples.length < 12) samples.push(`${tk.join(",")} | ${r.title.slice(0, 70)}`);
    }
  }
  console.log(`scanned ${rows.length} newest archive rows → ${hits} attributed`);
  for (const s of samples) console.log(" ", s);
}
main()
  .catch((e) => console.error(e))
  .finally(() => process.exit(0));
