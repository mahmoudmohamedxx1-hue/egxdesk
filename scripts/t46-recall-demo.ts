/** T46 recall demo — prove the supermemory recalls the REAL stored memories
 *  (from the 15:32 successful run) for a CURRENT-situation query. No writes. */
import { recallMemories, memoryStats } from "@/lib/supermemory";

async function main() {
  const stats = await memoryStats();
  console.log(`memory bank: ${stats.total} entries`);
  for (const k of stats.byKind) console.log(`  ${k.kind}: ${k.count}`);

  // a CURRENT run's context query — same shape recallForRun builds
  const query =
    "EGX manual run · " +
    "market bias bullish consensus picks thesis vision verdict whale insider momentum trend · " +
    "candidates ALCN GSSC RAKT EGAS UNIP PRMH HRHO COMI";
  console.log(`\nquery: ${query.slice(0, 100)}…`);
  const hits = await recallMemories(query, 6);
  console.log(`\nrecalled ${hits.length}:`);
  for (const h of hits) {
    console.log(`  [${h.kind}] score=${h.score.toFixed(3)} age=${h.ageDays.toFixed(2)}d :: ${h.text.slice(0, 120)}`);
  }
}
main();
