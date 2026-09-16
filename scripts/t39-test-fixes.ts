/** T39 — regression tests for the second full-audit fix batch.
 *  Covers: language-aware narrative flows, the shared picker matcher,
 *  TradingView name-artifact stripping, extreme-P/E display cap,
 *  deterministic sector-group labels, and the 13 new Arabic company names. */

import { marketNarrative } from "../src/lib/narrative";
import { rowMatchesQuery } from "../src/lib/ar-search";
import { cleanName } from "../src/lib/market";
import { fmtPE } from "../src/lib/format";
import { AR_NAMES } from "../src/lib/ar-names";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

// ── 1. narrative: Arabic spells out مليون/مليار, English keeps m/bn ──
const flows = { egyNet: 245, arabNet: -142, forNet: -103 };
const ar = marketNarrative({
  indexName: "إيجي إكس 30", indexChangePct: -0.16, up: 129, down: 99, total: 296,
  flows, bestSector: "الخدمات الصحية", worstSector: "الخدمات الاستهلاكية",
  topMover: { ticker: "NAPR", changePct: 20 },
}, "ar") ?? "";
const en = marketNarrative({
  indexName: "EGX 30", indexChangePct: -0.16, up: 129, down: 99, total: 296,
  flows, bestSector: "Health Services", worstSector: "Consumer Services",
  topMover: { ticker: "NAPR", changePct: 20 },
}, "en") ?? "";
ok("AR narrative uses مليون (no Latin m)", ar.includes("245 مليون جنيه") && !/\d+m /.test(ar), ar.match(/المصريون[^،]*،?/)?.[0] ?? "");
ok("AR narrative uses مليار for ≥1000m", marketNarrative({
  indexName: "إيجي إكس 30", indexChangePct: 1.2, up: 200, down: 50, total: 296,
  flows: { egyNet: 1450, arabNet: -900, forNet: -550 },
  bestSector: "أ", worstSector: "ب", topMover: null,
}, "ar")?.includes("1.4 مليار") ?? false);
ok("EN narrative keeps compact +245m", en.includes("+245m EGP") && en.includes("−142m"));
ok("AR narrative keeps the Arabic flow sentence shape", ar.includes("المصريون +245 مليون") && ar.includes("العرب −142 مليون"));

// ── 2. shared picker matcher ──
const comiRow = { ticker: "COMI", name: "Commercial International Bank - Egypt (CIB) S.A.E.", nameAr: "البنك التجارى الدولى" };
const hrhoRow = { ticker: "HRHO", name: "EFG Holding S.A.E.", nameAr: "مجموعة إي اف جي القابضة" };
ok("picker: كومي → COMI (alias)", rowMatchesQuery(comiRow, "كومي"));
ok("picker: التجاري matches التجارى (alef-maqsura normalization)", rowMatchesQuery(comiRow, "التجاري"));
ok("picker: latin com → COMI", rowMatchesQuery(comiRow, "com"));
ok("picker: هيرمس → HRHO (alias)", rowMatchesQuery(hrhoRow, "هيرمس"));
ok("picker: exact ticker still first", rowMatchesQuery(comiRow, "COMI"));
ok("picker: empty query no match", !rowMatchesQuery(comiRow, ""));
ok("picker: unrelated Arabic no match", !rowMatchesQuery(comiRow, "أسمنت"));
ok("picker: أبو قير space-insensitive", rowMatchesQuery({ ticker: "ABUK", name: "Abou Kir Fertilizers", nameAr: "ابوقير للاسمدة والصناعات الكيماوية" }, "أبو قير"));

// ── 3. TradingView name artifacts ──
ok("cleanName strips ' & Egp5'", cleanName("El Nasr Housing & Egp5") === "El Nasr Housing", cleanName("El Nasr Housing & Egp5"));
ok("cleanName strips ' Egp10'", cleanName("Egyptian Ferro All Egp10") === "Egyptian Ferro All");
ok("cleanName strips 'Npv'", cleanName("Heibco Npv") === "Heibco");
ok("cleanName strips 'Egp100'", cleanName("El Masreyah Touris Egp100") === "El Masreyah Touris");
ok("cleanName leaves normal names untouched", cleanName("Heliopolis Housing") === "Heliopolis Housing");
ok("cleanName leaves mid-string EGP alone", cleanName("EGP Fund Managers") === "EGP Fund Managers");

// ── 4. extreme P/E display ──
ok("fmtPE: 3406 → —", fmtPE(3406.3) === "—", fmtPE(3406.3));
ok("fmtPE: 6.3 → 6.3", fmtPE(6.3) === "6.3", fmtPE(6.3));
ok("fmtPE: 12 → 12.0", fmtPE(12) === "12.0", fmtPE(12));
ok("fmtPE: 250 → 250", fmtPE(250.4) === "250", fmtPE(250.4));
ok("fmtPE: negative → —", fmtPE(-5) === "—");
ok("fmtPE: null → —", fmtPE(null) === "—");
ok("fmtPE: 999.9 still numeric", fmtPE(999.9) === "1,000", fmtPE(999.9));

// ── 5. the 13 Arabic names exist ──
const need = ["NAPR", "ACRO", "MKIT", "FERC", "DIFC", "SLAR", "NAMI", "ENHD", "NBCC", "EGCN", "NIRE", "ESAC", "HALN"];
const have = need.filter((t) => {
  const v = AR_NAMES[t];
  return !!v && /[\u0600-\u06FF]/.test(v);
});
ok("all 13 TradingView-only listings have Arabic names", have.length === 13, `missing: ${need.filter((t) => !have.includes(t)).join(",")}`);

// ── 6. sector group labels are a pure function of the TradingView sector ──
const { SECTOR_AR, sectorAr } = await import("../src/lib/market");
{
  const codes = new Map<string, string>();
  for (const [en, ar] of Object.entries(SECTOR_AR)) codes.set(en.toLowerCase().replace(/[^a-z0-9]+/g, "-"), ar);
  const dupLabels = new Map<string, string[]>();
  for (const [code, label] of codes) {
    const bucket = dupLabels.get(label) ?? [];
    bucket.push(code);
    dupLabels.set(label, bucket);
  }
  const dups = [...dupLabels.entries()].filter(([, v]) => v.length > 1);
  ok("taxonomy labels unique per code", dups.length === 0, dups.map(([l, v]) => `${l}×${v.length}`).join(" "));
  ok("sectorAr null-safe fallback", sectorAr(null) === "غير مصنّف" && sectorAr("Finance") === "البنوك والخدمات المالية");
}

// ── 7. live: API rows carry the new fields + names ──
{
  const res = await fetch("http://localhost:3000/api/companies");
  const j = (await res.json()) as { rows: { ticker: string; name: string; nameAr: string; sectorGroupAr: string; sectorCode: string; sectorAr: string }[] };
  const rows = j.rows;
  ok("live rows carry sectorGroupAr", rows.every((r) => typeof r.sectorGroupAr === "string" && r.sectorGroupAr.length > 0));
  const byGroupLabel = new Map<string, string>();
  let conflict = 0;
  for (const r of rows) {
    const prev = byGroupLabel.get(r.sectorCode);
    if (prev !== undefined && prev !== r.sectorGroupAr) conflict++;
    byGroupLabel.set(r.sectorCode, r.sectorGroupAr);
  }
  ok("sectorGroupAr deterministic (one label per code)", conflict === 0, `${conflict} conflicts`);
  const labels = [...new Set(rows.map((r) => r.sectorGroupAr))];
  const labelCount = new Map<string, number>();
  rows.forEach((r) => labelCount.set(r.sectorGroupAr, (labelCount.get(r.sectorGroupAr) ?? 0) + 1));
  ok("no two sector codes share one Arabic filter label", labels.length === byGroupLabel.size, `${labels.length} labels vs ${byGroupLabel.size} codes`);
  const napr = rows.find((r) => r.ticker === "NAPR");
  ok("NAPR shows its Arabic name live", !!napr && /[\u0600-\u06FF]/.test(napr.nameAr), napr?.nameAr);
  const enhd = rows.find((r) => r.ticker === "ENHD");
  ok("ENHD name artifact stripped live", !!enhd && !/Egp\d/i.test(enhd.name) && !/Egp\d/i.test(enhd.nameAr), `${enhd?.name} | ${enhd?.nameAr}`);
  const badNames = rows.filter((r) => /Egp\s?\d+|\bNpv\b/i.test(r.name) || /Egp\s?\d+|\bNpv\b/i.test(r.nameAr));
  ok("no EgpN/Npv artifacts anywhere live", badNames.length === 0, badNames.map((r) => r.ticker).join(","));
  const noArabic = rows.filter((r) => !/[\u0600-\u06FF]/.test(r.nameAr));
  ok("every live row has an Arabic display name", noArabic.length === 0, noArabic.map((r) => r.ticker).slice(0, 10).join(","));
}

console.log(`\nT39 RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
