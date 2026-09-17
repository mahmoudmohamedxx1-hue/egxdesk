/** T32 diagnostic — why does the news pillar return 0 coverage for the whole
 *  universe? Steps through newsScoresForUniverse exactly as the scan does. */
import { newsScoresForUniverse } from "@/lib/news-score";
import { fetchUniverse } from "@/lib/market";

async function main() {
  const universe = await fetchUniverse();
  console.log("universe size:", universe.length);
  const map = await newsScoresForUniverse(universe);
  console.log("news map size:", map.size);
  let covered = 0;
  for (const [t, n] of map) {
    if (n.count > 0) {
      covered++;
      if (covered <= 8) {
        console.log(`  ${t}: count=${n.count} bull=${n.bull} bear=${n.bear} score=${n.score}`);
        console.log(`     reasons: ${(n.reasons ?? []).join(" | ").slice(0, 120)}`);
      }
    }
  }
  console.log("tickers with coverage:", covered, "/", map.size);
  process.exit(0);
}
main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
