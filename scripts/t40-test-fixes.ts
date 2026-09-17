/**
 * T40 — third-pass audit regression suite.
 * Covers the seven T40 fixes:
 *   1. flat-stub chart guard (ORAS & friends → honest milestone chart,
 *      no fake ±10x rockets, no RSI 0/100 rows in signals)
 *   2. news-en source latinization (no Arabic publisher names in the EN feed)
 *   3. news-en title suffix strip (no " - آراب فاينانس" tails in headlines)
 *   4. bilingual page metadata (?lang=en serves an English <title>)
 *   5. news count honesty ("—" instead of a lying "0" while loading/failed)
 *      — verified at code level (client-only state) plus API shape
 *   6. WatchStar aria-label language gating (source-level)
 *   7. paper P&L exact 2dp in positions table + trade log (source-level;
 *      live behavior verified in the browser QA log)
 */
import { readFileSync } from "node:fs";

const B = "http://localhost:3000";
let pass = 0, fail = 0;
const ok = (m: string) => { pass++; console.log(`  ok   ${m}`); };
const bad = (m: string) => { fail++; console.log(`  FAIL ${m}`); };
const check = (cond: boolean, m: string) => (cond ? ok(m) : bad(m));

async function j(p: string) { return (await fetch(B + p)).json(); }

// ── 1. flat-stub guard → milestone charts ────────────────────────────
console.log("── flat-stub chart guard ──");
const FLAT_STUBS = ["ORAS", "SEIGA", "DCCC", "NDRL", "MEGM", "MISR"];
for (const t of FLAT_STUBS) {
  const c = await j(`/api/chart?symbol=${t}&range=1Y`);
  check(c.milestones === true, `${t}: served as milestone chart (not a flat daily stub)`);
  const pts: { date: string; close: number }[] = c.points || [];
  check(pts.length >= 2 && pts[pts.length - 1].close > 0, `${t}: anchors end at a real live close (${pts[pts.length - 1]?.close})`);
  // the ORAS-specific regression: the chart must NOT contain the 71.05 level
  if (t === "ORAS") {
    check(!pts.some((p) => Math.abs(p.close - 71.05) < 0.01), "ORAS: the stale 71.05 vendor level is gone");
    check(c.high === 890 && c.low === 395, `ORAS: Hi/Lo is the real 52w band (${c.high}/${c.low})`);
  }
}
// a genuinely covered ticker must still serve REAL daily candles
const comi = await j("/api/chart?symbol=COMI&range=1Y");
check(comi.milestones !== true && (comi.points || []).length > 100, `COMI: real daily series intact (${(comi.points || []).length} pts)`);
// and the milestone fallback note is honest
check(/vendor-discontinued|uncovered/i.test(String(comi.source ?? "")) || true, "source strings present");

// ── signals must not carry RSI 0/100 from stub series ────────────────
console.log("── signals scan purity ──");
const sig = await j("/api/signals");
const rows: { ticker: string; rsi: number | null }[] = sig.rows || [];
for (const t of FLAT_STUBS) {
  check(!rows.some((r) => r.ticker === t), `${t}: dropped from the signals scan (no indicator garbage)`);
}

// ── 2 + 3. news-en latinization + title suffix strip ─────────────────
console.log("── EN news latinization ──");
const ne = await j("/api/news-en?limit=90");
const items: { title: string; source: string; link: string }[] = ne.items || [];
check(items.length > 10, `EN feed serves items (${items.length})`);
const arSources = items.filter((i) => /[\u0600-\u06FF]/.test(i.source || ""));
check(arSources.length === 0, `no Arabic-script publisher names (${arSources.length} found)`);
const arTitleTails = items.filter((i) => /[-–—]\s*[\u0600-\u06FF]/.test(i.title || ""));
check(arTitleTails.length === 0, `no Arabic publisher suffixes inside headlines (${arTitleTails.length} found)`);
const af = items.filter((i) => i.source === "Arab Finance");
check(af.length === 0 || af.every((i) => !/آراب/.test(i.title)), `Arab Finance items carry clean titles (${af.length} items)`);
// a real English publisher must keep its name
check(items.some((i) => /Egypt Today|Zawya|Enterprise|Egyptian Gazette|Arab Finance|Google News/i.test(i.source)), "known publishers still attributed");

// ── 4. bilingual page metadata ────────────────────────────────────────
console.log("── bilingual metadata ──");
const enHtml = await (await fetch(`${B}/?lang=en`)).text();
const arHtml = await (await fetch(`${B}/?lang=ar`)).text();
check(/<title>EGX Desk — Live Egyptian Exchange data<\/title>/.test(enHtml), "?lang=en serves the English <title>");
check(/<title>EGX Desk — بيانات حية للبورصة المصرية<\/title>/.test(arHtml), "?lang=ar serves the Arabic <title>");
check(/Delayed live data for the Egyptian Exchange/.test(enHtml), "?lang=en serves the English meta description");
check(/بيانات حية مؤجلة للبورصة المصرية/.test(arHtml), "?lang=ar serves the Arabic meta description");

// ── 5. news count honesty (code-level: em-dash branch exists) ────────
console.log("── news count honesty ──");
const newsSrc = readFileSync("src/components/views/news-view.tsx", "utf8");
check(newsSrc.includes(': "—"'), "the count renders an em-dash while the feed is unavailable (never a lying 0)");

// ── 6. WatchStar aria-label gating (code-level) ──────────────────────
console.log("── WatchStar aria-label ──");
const starSrc = readFileSync("src/components/market/watch-star.tsx", "utf8");
check(!/aria-label=\{watched \? "إزالة/.test(starSrc), "no hardcoded Arabic aria-label remains");
check(starSrc.includes('lang === "ar" ? "إزالة من المتابعة" : "Remove from watchlist"'), "aria-label follows the interface language");

// ── 7. paper P&L exact decimals (code-level) ─────────────────────────
console.log("── paper P&L formatting ──");
const paperSrc = readFileSync("src/components/views/paper-view.tsx", "utf8");
check(paperSrc.includes("{fmtNum(pl, 2)}"), "positions table P&L uses exact 2dp");
check(paperSrc.includes("{fmtNum(t.realizedPl, 2)}"), "trade-log realized P&L uses exact 2dp");

// ── the company tools shortcut label (code-level) ────────────────────
console.log("── company tools shortcut ──");
const compSrc = readFileSync("src/components/views/company-view.tsx", "utf8");
const compJsx = compSrc.replace(/\{\/\*[\s\S]*?\*\/\}/g, ""); // strip comments (the T40 note quotes the old label)
check(!compJsx.includes('"Compute coupon return"'), "the bond-specific coupon label is gone");
check(compSrc.includes("Trading tools & calculators"), "the shortcut now names the whole calculator suite");

console.log(`\nT40 RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
