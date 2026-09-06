/** Live parser test: Sigma flows table + EGXBot report parsing. */
import { readFileSync } from "fs";
import { sigmaSnapshotFromHtml } from "@/lib/flows";

// 1) saved Sigma EN page
const html = readFileSync("/home/z/my-project/scripts/research/sigmacap_en.html", "utf-8");
const snap = sigmaSnapshotFromHtml(html);
console.log("asOf:", snap.asOf, "| scope:", snap.scope);
console.log("turnover (2-way mn):", snap.turnoverTotal, "| one-way:", snap.valueTradedOneWay);
for (const c of snap.categories) {
  console.log(
    c.key.padEnd(11),
    "buy", String(c.buy).padStart(10),
    "sell", String(c.sell).padStart(10),
    "net", String(c.net).padStart(9),
    "pct", c.tradingPct
  );
}
console.log("nationality net:", snap.nationalityNet);
console.log("retail/inst %:", snap.retailPct, snap.instPct);
console.log("block trades:", snap.blockTrades.length ? snap.blockTrades.slice(0, 3) : "none");

// 2) live fetch through the module (network + cache path)
const { fetchFlows, fetchEgxbotCurrent, ensureHistory, participationHistory } = await import("@/lib/flows");
const live = await fetchFlows();
console.log("\nLIVE asOf:", live.asOf, "matches saved?", live.asOf === snap.asOf);

const egx = await fetchEgxbotCurrent();
console.log("EGXBOT current:", egx);

await ensureHistory();
const hist = await participationHistory();
console.log("participation history points:", hist.length);
console.table(hist.map((h) => ({ date: h.date, egy: h.egyptiansPct, ar: h.arabsPct, fo: h.foreignersPct, val: h.totalValueEgpMn })));
process.exit(0);
