/** T41 tests — the fourth-audit fixes:
 *   1. calendar duplicate-event dedupe (live API)
 *   2. ai-signals language-purity gate (unit: strayLatinInArabic /
 *      strayArabicInEnglish / numbersPreserved; live: served set carries no
 *      stray Latin in Arabic fields)
 *   3. strategy-lab notes Arabic translation (unit: noteAr)
 *   4. overview ?lang=en serves the English news feed (live)
 *   5. dead scaffold code removed (auth/watchlist routes 404, not 500)
 * Run: bun scripts/t41-test-fixes.ts   (server must be up on :3000)
 */
import { strayLatinInArabic, strayArabicInEnglish, numbersPreserved } from "@/lib/ai-signals";
import { noteAr } from "@/components/views/strategy-lab-view";
import { isDeadFeed, STALE_GRACE_MS } from "@/components/market/use-live-data";

const BASE = "http://localhost:3000";
let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

// ── 1. language purity: detection ─────────────────────────────────────────
console.log("\n[1] ai-signals language-purity gate (unit)");
{
  const strays = strayLatinInArabic("رغم وجوده فوق المتوسطات، فإن السهم في حالة تمدد مفرط (RSI 100) وهذه combination عالية المخاطر مع SMA20 و COMI و volume ضعيف");
  ok(strays.length === 2, `catches the exact live leak (got ${strays.length}: ${strays.join(",")})`);
  ok(strays.includes("combination") && strays.includes("volume"), "names the offending words");
  const clean = strayLatinInArabic("السهم فوق المتوسطين RSI 56.7 و MACD موجب مع ATR14 2.35% و P/E 5 مقابل 8 للقطاع، والهدف عند SMA20");
  ok(clean.length === 0, `technical acronyms pass unflagged (got ${clean.length}: ${clean.join(",")})`);
  const tickerOk = strayLatinInArabic("بنك قوي مثل COMI مع ROE 30.2% و EGX30 في صعود");
  ok(tickerOk.length === 0, `tickers/index codes pass (got ${tickerOk.length})`);
  ok(strayLatinInArabic("").length === 0, "empty string is clean");
  const lower = strayLatinInArabic(" breakout و momentum قوي");
  ok(lower.length === 2, "lowercase english words caught");
  // English side
  ok(!strayArabicInEnglish("Bullish led by banks and telecos"), "pure english passes");
  ok(strayArabicInEnglish("The stock قوي جدا today"), "arabic script inside english caught");
  const brand = strayLatinInArabic("شركة A.T.LEASE في صعود مع RSI 60");
  ok(brand.length === 0, `dotted Latin brand passes (got ${brand.length}: ${brand.join(",")})`);
  // numbersPreserved
  ok(numbersPreserved("RSI 56.7 و P/E 5", "مؤشر RSI عند 56.7 و P/E عند 5"), "identical number multiset accepted");
  ok(!numbersPreserved("RSI 56.7", "RSI 56.8"), "altered number rejected");
  ok(!numbersPreserved("RSI 56.7", "RSI 56.7 و 12"), "invented number rejected");
  ok(!numbersPreserved("RSI 56.7 و 12", "RSI 56.7"), "dropped number rejected");
  ok(numbersPreserved("", ""), "empty pair accepted");
}

// ── 2. strategy-lab notes translation ─────────────────────────────────────
console.log("\n[2] strategy-lab notes Arabic (unit)");
{
  const n1 = noteAr("Past performance is NOT a guarantee — the backtest validates the RULES on history, it cannot validate the LLM's future judgment.");
  ok(/[\u0600-\u06ff]/.test(n1) && !/[A-Za-z]{4,}/.test(n1.replace(/LLM/g, "")), "note 1 translated to Arabic");
  const n2 = noteAr("Trades with |gross return| > 45% inside a 10-session hold (4 found) are excluded as likely rights-issue/split print artifacts.");
  ok(n2.includes("٤") || n2.includes("45") || /45٪/.test(n2), "note 2 keeps the 45% threshold");
  ok(n2.includes("4") || n2.includes("٤"), "note 2 interpolates the suspects count");
  ok(!/Trades with/.test(n2), "note 2 is not the English original");
  const n3 = noteAr("Universe is today's most-traded names — mild survivorship/selection bias is possible.");
  ok(/[\u0600-\u06ff]/.test(n3), "note 3 translated");
  const n4 = noteAr("Quotes are ~15-min delayed daily candles; fills at next available close, no intraday stops modeled (EGX circuit breakers make stop fills uncertain).");
  ok(/[\u0600-\u06ff]/.test(n4), "note 4 translated");
  const unknown = noteAr("A brand new generator note that did not exist before.");
  ok(unknown === "A brand new generator note that did not exist before.", "unknown note falls back to English honestly");
}

// ── 3. live: calendar has no exact duplicates ────────────────────────────
console.log("\n[3] calendar dedupe (live API)");
{
  const d = await (await fetch(`${BASE}/api/calendar`)).json();
  const keys = d.events.map((e: { date: string; type: string; ticker: string | null; labelAr: string }) => `${e.date}|${e.type}|${e.ticker}|${e.labelAr}`);
  const dups = keys.filter((k: string, i: number) => keys.indexOf(k) !== i);
  ok(dups.length === 0, `no exact duplicate events (found ${dups.length}: ${dups.slice(0, 2).join(" ; ")})`);
  const grca = d.events.filter((e: { ticker: string | null; date: string }) => e.ticker === "GRCA" && e.date === "2026-09-10");
  ok(grca.length === 1, `the GRCA Sep-10 pair collapsed to one (got ${grca.length})`);
  const total = d.events.length;
  ok(total >= 400, `event count still healthy (${total})`);
}

// ── 4. live: overview ?lang=en serves English news ───────────────────────
console.log("\n[4] overview EN news (live API)");
{
  const en = await (await fetch(`${BASE}/api/overview?lang=en`)).json();
  const ar = await (await fetch(`${BASE}/api/overview?lang=ar`)).json();
  ok(Array.isArray(en.news) && en.news.length > 0, `EN news non-empty (${en.news.length})`);
  const arabicTitles = (en.news as { title: string }[]).filter((n) => /[\u0600-\u06ff]/.test(n.title));
  ok(arabicTitles.length === 0, `zero Arabic titles in EN mode (found ${arabicTitles.length}${arabicTitles[0] ? ": " + arabicTitles[0].title.slice(0, 50) : ""})`);
  const arabicSources = (en.news as { source: string }[]).filter((n) => /[\u0600-\u06ff]/.test(n.source));
  ok(arabicSources.length === 0, `zero Arabic source chips in EN mode (${arabicSources.length})`);
  ok(Array.isArray(ar.news) && ar.news.length > 0, `AR news still served (${ar.news.length})`);
  const arHasArabic = (ar.news as { title: string }[]).some((n) => /[\u0600-\u06ff]/.test(n.title));
  ok(arHasArabic, "AR mode keeps the Arabic archive");
}

// ── 5. live: dead scaffold routes are gone (404, not a broken 500) ───────
console.log("\n[5] dead scaffold code removed (live)");
{
  for (const p of ["/api/auth/request", "/api/auth/verify", "/api/auth/me", "/api/auth/signout", "/api/watchlist"]) {
    const r = await fetch(`${BASE}${p}`, { method: "POST" });
    ok(r.status === 404, `${p} → 404 (got ${r.status})`);
  }
}

// ── 6. live: the served AI-signals set is purity-clean after regen ───────
console.log("\n[6] ai-signals served set purity (live)");
{
  const r = await (await fetch(`${BASE}/api/ai-signals?wait=75`)).json();
  ok(r.ok && r.set, `set served (status ${r.status})`);
  if (r.set) {
    for (const p of r.set.picks as { ticker: string; thesisAr: string; thesisEn: string }[]) {
      const strays = strayLatinInArabic(p.thesisAr ?? "");
      ok(strays.length === 0, `${p.ticker} thesisAr clean (strays: ${strays.join(",") || "none"})`);
      ok(!strayArabicInEnglish(p.thesisEn ?? ""), `${p.ticker} thesisEn clean`);
    }
    ok(strayLatinInArabic(r.set.marketBias.summaryAr ?? "").length === 0, "bias summaryAr clean");
    ok(!strayArabicInEnglish(r.set.marketBias.summaryEn ?? ""), "bias summaryEn clean");
    if (r.set.notesAr) ok(strayLatinInArabic(r.set.notesAr).length === 0, "notesAr clean");
  }
}

// ── 7. honest-degradation rule (unit) ────────────────────────────────────
console.log("\n[7] isDeadFeed grace rule (unit)");
{
  ok(!isDeadFeed({ error: false, data: null, staleMs: null }), "no error + no data (loading) is not dead");
  ok(isDeadFeed({ error: true, data: null, staleMs: null }), "error + no data = dead (the cold-outage card)");
  ok(!isDeadFeed({ error: true, data: { x: 1 }, staleMs: 30_000 }), "error + 30s-old data survives (brief hiccup)");
  ok(!isDeadFeed({ error: true, data: { x: 1 }, staleMs: STALE_GRACE_MS - 1000 }), "error + data just inside grace survives");
  ok(isDeadFeed({ error: true, data: { x: 1 }, staleMs: STALE_GRACE_MS + 1000 }), "error + data past grace = dead (sustained outage)");
  ok(isDeadFeed({ error: true, data: { x: 1 }, staleMs: null }), "error + data but unknown age = dead (safe side)");
  ok(STALE_GRACE_MS === 10 * 60_000, "grace window is 10 minutes");
}

console.log(`\n=== T41: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
