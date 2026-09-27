/** T37 unit test — price-adaptive ATR level precision (riskLevels) + fmtLevel:
 *  the served entry/stop/target must keep the charter's R:R ≈ 1.5 even for
 *  low-priced EGX names, where a fixed 2dp round used to distort it to 1.75
 *  (SPMD at ~0.6 EGP). Also locks the XLSX "lvl" General format choice. */
import { riskLevels, type StrategyFeatures } from "../src/lib/strategy";
import { fmtLevel } from "../src/lib/format";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}`);
  }
};

function feat(close: number, atrPct: number, sma20: number | null = null): StrategyFeatures {
  return {
    ticker: "TEST",
    close,
    trend: 1,
    momentum: 0.5,
    volumeC: 0.5,
    position52: 0.5,
    pullback: 0,
    atrPct,
    volRatio20: 1,
    rsi: 55,
    macdHist: 0.1,
    sma20,
    sma50: close * 0.95,
    sma200: close * 0.9,
    pos52: 70,
    belowHigh20Pct: 4,
    score: 0.5,
    evidence: [],
  };
}

function decimals(n: number): number {
  const s = String(n);
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
}

console.log("── high-priced name (close 133, ATR 2.5%) ──");
{
  const r = riskLevels(feat(133.32, 2.5))!;
  const rr = (r.target - r.entry) / (r.entry - r.stop);
  ok(Math.abs(rr - 1.5) < 0.05, `R:R stays 1.5 (got ${rr.toFixed(3)})`);
  ok(decimals(r.entry) === 2, `2dp levels at this price (entry ${r.entry})`);
  ok(r.stop < r.entry && r.entry < r.target, "stop < entry < target");
}

console.log("── mid-priced name (close 2.82, ATR 4%) ──");
{
  const r = riskLevels(feat(2.82, 4))!;
  const rr = (r.target - r.entry) / (r.entry - r.stop);
  ok(Math.abs(rr - 1.5) < 0.05, `R:R stays 1.5 (got ${rr.toFixed(3)})`);
  ok(decimals(r.stop) === 3, `3dp levels at this price (stop ${r.stop})`);
}

console.log("── THE BUG: penny name (close 0.6, ATR 3.8%) — old code served 1.75 ──");
{
  const r = riskLevels(feat(0.6, 3.8))!;
  const rr = (r.target - r.entry) / (r.entry - r.stop);
  ok(Math.abs(rr - 1.5) < 0.05, `R:R stays 1.5 (got ${rr.toFixed(3)} — was 1.75)`);
  ok(decimals(r.stop) === 4, `4dp levels at this price (stop ${r.stop})`);
  ok(r.stop < r.entry && r.entry < r.target, "stop < entry < target");
  ok(Math.abs(r.rr - rr) < 0.02, `reported rr matches served levels (${r.rr})`);
}

console.log("── extreme penny (close 0.18, ATR 5%) ──");
{
  const r = riskLevels(feat(0.18, 5))!;
  const rr = (r.target - r.entry) / (r.entry - r.stop);
  ok(Math.abs(rr - 1.5) < 0.05, `R:R stays 1.5 even at 0.18 EGP (got ${rr.toFixed(3)})`);
}

console.log("── SMA20 dip entry path (close 50, SMA20 49 within 1 ATR) ──");
{
  const r = riskLevels(feat(50, 2, 49.5))!;
  ok(Math.abs(r.entry - 49.5) < 0.01, `entry takes the SMA20 dip (${r.entry})`);
  const rr = (r.target - r.entry) / (r.entry - r.stop);
  ok(Math.abs(rr - 1.5) < 0.05, `R:R 1.5 on the dip path too (${rr.toFixed(3)})`);
}

console.log("── guards ──");
{
  ok(riskLevels(feat(100, 0)) === null, "zero ATR → null (no fake levels)");
  ok(riskLevels(feat(100, -1)) === null, "negative ATR → null");
}

console.log("── fmtLevel display parity ──");
{
  ok(fmtLevel(46.48) === "46.48", `fmtLevel 2dp ≥20 (${fmtLevel(46.48)})`);
  ok(fmtLevel(2.822) === "2.822", `fmtLevel 3dp ≥2 (${fmtLevel(2.822)})`);
  ok(fmtLevel(0.5984) === "0.5984", `fmtLevel 4dp <2 (${fmtLevel(0.5984)})`);
  ok(fmtLevel(null) === "—", "fmtLevel null → em dash");
}

console.log(`\nRESULT: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
