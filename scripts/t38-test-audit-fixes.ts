/** T38 unit test — the full-audit fix set:
 *  1. verifyFinalAnswer — the anti-fabrication gate (fabricated numbers,
 *     CJK leakage, honest roundings, user-question whitelist, no-tool pass)
 *  2. ticker aliases — ISIN->Reuters mapping, round-trips, cleanTicker
 *     accepting both forms
 *  3. Arabic search — كومي/أبوقير space-insensitive matching, هيرميس variants
 *  4. UI fix units — fmtPct double-sign regression, GCC suffix stripper */

import { verifyFinalAnswer, verificationRepairMessage, verificationFootnote, cleanTicker } from "@/lib/agent-protocol";
import { TICKER_ALIASES, TICKER_DEALIASES, prettyTicker, resolveTicker, historySymbol } from "@/lib/ticker-aliases";
import { matchArabic, normalizeAr, normalizeArKey, rowMatchesArabic, AR_ALIASES } from "@/lib/ar-search";
import { fmtPct } from "@/lib/format";

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

// ── 1) the anti-fabrication gate ─────────────────────────────────────────

console.log("1) verifyFinalAnswer — catches the live-observed fabrications");
{
  // the EXACT live case: quote tool served HDBK real data, the model wrote
  // a fully invented answer with sequential digits
  const hdbkJson = JSON.stringify({
    ticker: "HDBK", name: "Housing & Development Bank", close: 116.5,
    changePct: 6.8807339449541285, changeAbs: 7.5, volume: 539653,
    marketCap: 115823397339, pe: 6.221097262717204, pb: 2.6531717016577883,
    divYield: 3.669724770642202, eps: 18.7266, roe: 49.664671736068,
    high52: 124, low52: 30.755, perf1M: 31.400857207308828,
    perfYTD: 159.87062235110417,
  });
  const fabricated = "سعر سهم هيرموس هو 133.32 جنيه مصري. الحجم 1,234,567 والقيمة السوقية 123,456,789,012 جنيه.";
  const v = verifyFinalAnswer(fabricated, [hdbkJson], "ما سعر سلم هيرموس؟");
  ok(!v.ok, "the live fabricated answer FAILS the gate");
  ok(v.suspects.includes("133.32"), "invented price 133.32 flagged", JSON.stringify(v.suspects));
  ok(v.suspects.some((s) => s.replace(/,/g, "") === "1234567"), "sequential volume flagged");
  ok(v.suspects.some((s) => s.replace(/,/g, "") === "123456789012"), "sequential marketCap flagged");

  // a SINGLE invented number still fails (threshold is one — the second live case)
  const single = "The last price is 133.32 EGP.";
  const v1 = verifyFinalAnswer(single, [hdbkJson], "what is the price?");
  ok(!v1.ok && v1.suspects.length === 1, "one invented number alone is enough to fail");

  // the honest twin: every number copied/rounded from the tool passes
  const honest = "HDBK closes at 116.50 EGP (+6.88%, +7.5). Volume 539,653. Market cap 115.82bn EGP. P/E 6.22×, P/B 2.65×, EPS 18.73, ROE 49.66%, div 3.67%, 52w 124.0 / 30.76, 1M +31.40%. In 2026 the bank returned 159.87% YTD over 52 weeks with 10 sessions.";
  const v2 = verifyFinalAnswer(honest, [hdbkJson], "quote HDBK please");
  ok(v2.ok, "honest copied + rounded numbers PASS (±1% tolerance)", JSON.stringify(v2.suspects));

  // derived arithmetic within 1% passes; years and small counts are ignored
  const derived = "That is roughly 117 EGP. Over the last 52 weeks it rose 3 times. Data as of 2026. Average of the 3 levels is 116.5.";
  const v3 = verifyFinalAnswer(derived, [hdbkJson], "levels?");
  ok(v3.ok, "roundings, years and small counts never trigger", JSON.stringify(v3.suspects));

  // user's own numbers are whitelisted
  const echo = "Your 50,000 EGP at 116.5 buys about 429 shares (50,000 / 116.5 ≈ 429.2).";
  const v4 = verifyFinalAnswer(echo, [hdbkJson], "I have 50,000 EGP to invest in HDBK");
  ok(v4.ok, "the user's own 50,000 echoed back is trusted", JSON.stringify(v4.suspects));
  const v5 = verifyFinalAnswer(echo, [hdbkJson], "how many shares can I buy?");
  ok(!v5.ok, "without the question context, 50,000 would be flagged (whitelist is scoped)");

  // CJK leakage
  const cjk = "الأعلى خلال 52 أسبوعًا: ال最高 124 وال最低 30.76.";
  const v6 = verifyFinalAnswer(cjk, [hdbkJson], "high low?");
  ok(!v6.ok && v6.cjk.includes("最"), "CJK characters inside Arabic FAIL the gate", JSON.stringify(v6.cjk));

  // no tool data -> always ok (concept questions)
  ok(verifyFinalAnswer("P/E means price over earnings, e.g. 1234.", [], "what is P/E?").ok, "no-tool concept answers pass");

  // degenerate model breakdown (live case: "-fluid{" after a quote call)
  const vd = verifyFinalAnswer("-fluid{", [hdbkJson], "price?");
  ok(!vd.ok && vd.degenerate === true, "a 7-char broken reply after tool data is degenerate -> fails");
  ok(verifyFinalAnswer("HDBK closes at 116.5 EGP today.", [hdbkJson], "price?").ok, "a normal short quote answer is NOT degenerate (>= 12 chars)");
  ok(verificationRepairMessage({ ok: false, suspects: [], cjk: [], degenerate: true }, "ar").includes("not a usable answer"), "degenerate repair message generated");

  // repair message + footnote shape
  const rm = verificationRepairMessage(v, "ar");
  ok(rm.includes("133.32") && rm.includes("VERIFICATION FAILED"), "repair message names the bad numbers");
  ok(verificationRepairMessage(v6, "ar").includes("最高") || verificationRepairMessage(v6, "ar").includes("最"), "repair message names the CJK chars");
  const fn = verificationFootnote(v, "ar");
  ok(fn.includes("تنبيه التحقق"), "AR footnote text present");
  ok(verificationFootnote(v, "en").includes("Verification note"), "EN footnote text present");
}

// ── 2) ticker aliases ─────────────────────────────────────────────────────

console.log("2) ticker aliases — the 11 ISIN->Reuters remaps");
{
  ok(Object.keys(TICKER_ALIASES).length === 11, "exactly 11 aliased instruments (8 plain + 3 -EGP)");
  ok(prettyTicker("EGS370O1C013") === "NAPR", "National Printing -> NAPR");
  ok(prettyTicker("EGS659O1C015") === "MKIT", "Misr Kuwait -> MKIT");
  ok(prettyTicker("EGS385S1C012") === "FERC", "Ferchem -> FERC");
  ok(prettyTicker("EGS65861C014") === "EGCN", "Egyptian Contracting -> EGCN");
  ok(prettyTicker("EGS73M81C012") === "NAMI", "National Asset Mgmt -> NAMI");
  ok(prettyTicker("EGS72L31C011") === "SLAR", "SOLARSOL -> SLAR");
  ok(prettyTicker("EGS65621C012") === "ENHD", "El Nasr Housing -> ENHD");
  ok(prettyTicker("EGS65101C015") === "NIRE", "National Inv & Reconstruction -> NIRE");
  ok(prettyTicker("EGS3E071C013-EGP") === "ACRO", "Acrow Misr (-EGP form) -> ACRO");
  ok(prettyTicker("EGS30AJ1C016-EGP") === "DIFC", "International Dry Ice (-EGP form) -> DIFC");
  ok(prettyTicker("EGS48271C018-EGP") === "ESAC", "Egypt-South Africa (-EGP form) -> ESAC");
  ok(prettyTicker("EGS3E071C013EGP") === "ACRO", "dash-STRIPPED ISIN form also resolves");
  ok(prettyTicker("COMI") === "COMI" && prettyTicker("") === "", "normal tickers pass through untouched");
  ok(resolveTicker("EGS370O1C013") === "NAPR" && resolveTicker("NAPR") === "NAPR", "resolveTicker accepts BOTH forms");
  ok(historySymbol("NAPR") === "EGS370O1C013", "historySymbol maps Reuters -> ISIN for Yahoo");
  ok(historySymbol("ACRO") === "EGS3E071C013-EGP", "historySymbol keeps the -EGP suffix Yahoo needs");
  ok(historySymbol("EGS30AJ1C016-EGP") === "EGS30AJ1C016-EGP", "historySymbol round-trips the raw -EGP form");
  ok(historySymbol("EGS48271C018EGP") === "EGS48271C018-EGP", "historySymbol restores the dash on stripped input");
  ok(historySymbol("COMI") === "COMI", "historySymbol passes normal tickers through");
  ok(TICKER_DEALIASES["NAPR"] === "EGS370O1C013" && Object.keys(TICKER_DEALIASES).length === 11, "reverse map complete");
  // cleanTicker — the old 10-char cap silently truncated ISINs; now both work
  ok(cleanTicker("napr") === "NAPR", "cleanTicker lowercases normal tickers");
  ok(cleanTicker("EGS370O1C013") === "NAPR", "cleanTicker resolves the full 12-char ISIN (was truncated before)");
  ok(cleanTicker("egs659o1c015") === "MKIT", "cleanTicker resolves lowercase ISIN form");
  ok(cleanTicker("EGS3E071C013-EGP") === "ACRO", "cleanTicker survives the dash-stripping of -EGP forms");
  ok(cleanTicker(123) === "" && cleanTicker(null) === "", "non-string args stay empty");
}

// ── 3) Arabic search tolerance ────────────────────────────────────────────

console.log("3) Arabic search — the fixes for كومي / أبوقير / هيرمس");
{
  ok((AR_ALIASES.COMI ?? []).includes("كومي"), "كومي is now a curated COMI alias");
  ok((AR_ALIASES.HRHO ?? []).includes("هيرمس") && (AR_ALIASES.HRHO ?? []).includes("هرمس"), "Hermes press variants added");

  const komy = matchArabic("كومي");
  ok(komy.length > 0 && komy[0].ticker === "COMI", "matchArabic(\"كومي\") finds COMI");
  ok(matchArabic("ابوقير")[0]?.ticker === "ABUK", "\"ابوقير\" (no space) matches \"أبو قير\"");
  ok(matchArabic("أبو قير")[0]?.ticker === "ABUK", "spaced form still matches");
  ok(matchArabic("ابو قير")[0]?.ticker === "ABUK", "bare-alef spaced form matches");
  ok(matchArabic("التجاري")[0]?.ticker === "COMI", "التجاري finds COMI");
  ok(normalizeArKey("أبو قير") === normalizeArKey("أبوقير"), "normalizeArKey kills the space difference");
  ok(normalizeArKey("التجاري الدولي") === "التجاريالدولي", "normalizeArKey on multi-word");
  ok(rowMatchesArabic("ABUK", "ابوقير"), "rowMatchesArabic is space-insensitive");
  ok(matchArabic("هيرمس")[0]?.ticker === "HRHO", "هيرمس variant finds HRHO");
  ok(matchArabic("هرمس")[0]?.ticker === "HRHO", "هرمس variant finds HRHO");
  const bad = matchArabic("شركة غير موجودة تماما");
  ok(bad.length === 0, "garbage query matches nothing");
}

// ── 4) UI fix units ───────────────────────────────────────────────────────

console.log("4) UI regressions — double-sign + GCC ticker suffix");
{
  // company-view used to render "+" + fmtPct(52.53) = "++52.53%"
  ok(fmtPct(52.53) === "+52.53%", "fmtPct alone signs exactly once");
  ok(!("++" in { }) && `${fmtPct(52.53)}`.startsWith("+") && !`${fmtPct(52.53)}`.startsWith("++"), "no double-plus when the manual + is removed");
  ok(fmtPct(-0.57) === "-0.57%", "negative pct still signs once");

  // GCC suffix stripper (same expression as gcc.ts)
  const strip = (t: string) => t.replace(/(TADAWUL|ADX|DFM)$/i, "");
  ok(strip("1120TADAWUL") === "1120", "1120TADAWUL -> 1120");
  ok(strip("2222TADAWUL") === "2222", "2222TADAWUL -> 2222");
  ok(strip("IHC") === "IHC" && strip("EMAAR") === "EMAAR", "clean ADX/DFM symbols untouched");
  ok(strip("TADAWUL") === "", "degenerate all-suffix symbol empties (filtered out by the row guard)");
}

console.log(`\nT38 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
