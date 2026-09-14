/** Unit sanity test for the composite TA+FA signal engine (Task 31).
 *  Verifies: pillar math, null-safety, composite blending, rating thresholds,
 *  sector medians, and regression examples with hand-computed expectations. */

import { computeFundamentals, compositeScores, ratingFromScore, sectorStatsMap, marketStats, statsFor, type SectorStats } from "@/lib/fundamentals";
import type { Stock } from "@/lib/market";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label} ${extra}`);
  }
}

const base: Stock = {
  ticker: "TEST",
  name: "Test",
  sector: "banks",
  industry: null,
  close: 10,
  changePct: 0,
  changeAbs: 0,
  volume: 1000,
  valueTraded: 10000,
  marketCap: 1e9,
  perfW: null, perf1M: null, perf3M: null, perf6M: null, perfYTD: null, perfY: null, perf3Y: null, perf5Y: null,
  pe: null, eps: null, divYield: null,
  high52: null, low52: null, high1M: null, low1M: null,
  avgVolume: null, avgTurnover30: null, floatShares: null,
  revenueTTM: null, netMarginTTM: null, beta: null, updateMode: null,
  pb: null, debtToEquity: null, roe: null, netIncomeTTM: null, payoutRatio: null, grossMarginTTM: null,
  nextEarnings: null,
} as unknown as Stock;

const stats: SectorStats = { n: 10, pe: 10, pb: 2, roe: 15, divYield: 5 };

console.log("— pillar math —");
// cheap vs sector: pe 5 vs 10 → log2(2)=+1; pb 1 vs 2 → +1 → valuation +1
{
  const f = computeFundamentals({ ...base, pe: 5, pb: 1 }, stats);
  ok(f.valuation === 1, `valuation cheap = +1 (${f.valuation})`);
}
// expensive: pe 20 vs 10 → log2(0.5)=-1
{
  const f = computeFundamentals({ ...base, pe: 20 }, stats);
  ok(f.valuation === -1, `valuation expensive = -1 (${f.valuation})`);
}
// loss-making penalty −0.5 (pe weight .6 of valuation)
{
  const f = computeFundamentals({ ...base, pe: -3, pb: 2 }, stats);
  ok(f.valuation !== null && Math.abs(f.valuation - (0.6 * -0.5 + 0.4 * 0)) < 1e-9, `loss-making PE → −0.3 valuation (${f.valuation})`);
  ok(f.reasons.some((r) => r.startsWith("Loss-making")), "loss-making reason present");
}
// quality: ROE 25 → +1; margin 25 → +1; DE 0.3 → +1
{
  const f = computeFundamentals({ ...base, roe: 25, netMarginTTM: 25, debtToEquity: 0.3 }, stats);
  ok(f.quality === 1, `quality all-strong = +1 (${f.quality})`);
}
// income: dy 10 → +1 payout 0.5 → +0.1 → (0.7*1 + 0.3*0.1) = 0.73
{
  const f = computeFundamentals({ ...base, divYield: 10, payoutRatio: 0.5 }, stats);
  ok(f.income !== null && Math.abs(f.income - 0.73) < 1e-9, `income = 0.73 (${f.income})`);
}
// unsustainable payout: dy 12 → +1 (clamped), payout 1.5 → −0.8 → 0.7−0.24=0.46
{
  const f = computeFundamentals({ ...base, divYield: 12, payoutRatio: 1.5 }, stats);
  ok(f.income !== null && Math.abs(f.income - 0.46) < 1e-9, `unsustainable payout = 0.46 (${f.income})`);
}

console.log("— coverage & null-safety —");
{
  const f = computeFundamentals(base, stats); // no fundamentals at all
  ok(f.score === null, "no data → null score");
  ok(f.rating === "neutral", "null score → neutral rating");
  ok(f.coverage === 0, "coverage 0");
}
{
  // only ONE component (roe) → below the 2-component bar → still null
  const f = computeFundamentals({ ...base, roe: 20 }, stats);
  ok(f.score === null, "single component → null (no noisy half-score)");
  ok(f.coverage > 0 && f.coverage < 0.3, `coverage fraction (${f.coverage})`);
}
{
  // TWO components → renormalized over the pillars that exist
  const f = computeFundamentals({ ...base, pe: 5, roe: 25 }, stats); // V +1, Q +1 → fund +1
  ok(f.score === 1, `two components both max → +1 (${f.score})`);
}

console.log("— composite blending —");
{
  const { composite, fundWeight } = compositeScores(1, 1);
  ok(composite === 1 && fundWeight === 0.45, "tech 1 fund 1 → 1");
}
{
  const { composite } = compositeScores(1, -1);
  ok(Math.abs(composite - 0.1) < 1e-9, `tech +1 fund −1 → +0.10 (${composite})`);
}
{
  const { composite, fundWeight } = compositeScores(0.8, null);
  ok(composite === 0.8 && fundWeight === 0, "null fund → pure tech fallback");
}
{
  // opposite reads: tech −0.4, fund +0.6 → 0.55(−0.4)+0.45(0.6) = +0.05
  const { composite } = compositeScores(-0.4, 0.6);
  ok(Math.abs(composite - 0.05) < 1e-9, `blend −0.4/+0.6 → +0.05 (${composite})`);
}

console.log("— rating thresholds (mirror aggregateSignals) —");
ok(ratingFromScore(0.6) === "strongBuy", "0.6 → strongBuy");
ok(ratingFromScore(0.2) === "buy", "0.2 → buy");
ok(ratingFromScore(0.05) === "neutral", "0.05 → neutral");
ok(ratingFromScore(-0.2) === "sell", "-0.2 → sell");
ok(ratingFromScore(-0.6) === "strongSell", "-0.6 → strongSell");
ok(ratingFromScore(null) === "neutral", "null → neutral");

console.log("— sector stats —");
{
  const stocks: Stock[] = [
    { ...base, ticker: "A", sector: "banks", pe: 5 },
    { ...base, ticker: "B", sector: "banks", pe: 10 },
    { ...base, ticker: "C", sector: "banks", pe: 15 },
    { ...base, ticker: "D", sector: "banks", pe: 20 },
    { ...base, ticker: "E", sector: "banks", pe: 25 },
    { ...base, ticker: "F", sector: "banks", pe: -1 },   // loss excluded
    { ...base, ticker: "G", sector: "banks", pe: null },  // null excluded
  ];
  const m = sectorStatsMap(stocks);
  const banks = m.get("banks");
  ok(banks?.pe === 15, `median pe of [5,10,15,20,25] = 15 (${banks?.pe})`);
  ok(banks?.n === 7, `n counts all sector members (${banks?.n})`);
  // market stats fallback for a tiny sector
  const tiny: Stock[] = [
    { ...base, ticker: "X", sector: "tiny", pe: 4 },
    { ...base, ticker: "Y", sector: "other", pe: 8 },
    { ...base, ticker: "Z", sector: "other", pe: 12 },
  ];
  const bySector = sectorStatsMap(tiny);
  const market = marketStats(tiny);
  const resolved = statsFor(tiny[0], bySector, market); // sector "tiny" has n=1 → market fallback
  ok(resolved === market, "tiny sector falls back to market medians");
}

console.log("— bilingual reasons —");
{
  const f = computeFundamentals({ ...base, pe: 5, roe: 20, divYield: 7, payoutRatio: 0.5 }, stats);
  ok(f.reasons.some((r) => r.includes("P/E 5") || r.includes("P/E 5.0")), `EN reason has P/E (${f.reasons[0]})`);
  ok(f.reasonsAr.some((r) => r.includes("م/ع")), "AR reason has م/ع");
  ok(f.reasonsAr.length === f.reasons.length, "reason lists aligned");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
