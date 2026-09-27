// Debug: inspect which anchors milestoneChart produces and why
import { fetchUniverse } from "../../src/lib/market";
import { milestoneChart } from "../../src/lib/history";

async function main() {
  const u = await fetchUniverse();
  for (const t of ["EGS370O1C013", "SMPP", "TAQA"]) {
    const row = u.find((s) => s.ticker === t);
    if (!row) { console.log(`${t}: not in universe`); continue; }
    console.log(`\n${t}: close=${row.close} perfW=${row.perfW} 1M=${row.perf1M} 3M=${row.perf3M} 6M=${row.perf6M} YTD=${row.perfYTD} Y=${row.perfY} 3Y=${row.perf3Y} 5Y=${row.perf5Y} hi52=${row.high52} lo52=${row.low52}`);
    for (const r of ["6M", "1Y"] as const) {
      try {
        const ms = milestoneChart(t, r, row);
        console.log(`  ${r}: ${ms.points.map((p) => `${p.date}:${p.close.toFixed(2)}`).join(" ")}`);
      } catch (e: any) { console.log(`  ${r}: FAIL ${e.message}`); }
    }
  }
}
main().catch((e) => console.error(e.message));
