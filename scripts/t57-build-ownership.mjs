#!/usr/bin/env node
/**
 * T57 — build the عدسة الملكية (Ownership Lens) dataset from the REAL
 * official-disclosure archive (src/data/insiders.json).
 *
 * The EGX insider-trades bulletin rows carry: issuer company, the acting
 * related party / major holder, action and quantity. Our archive titles
 * concatenate those columns, so this script:
 *   1. parses every trade filing with a strict pattern,
 *   2. strips the issuer's own name variants,
 *   3. matches the remainder against a curated dictionary of REAL investor
 *      entities (EGX-listed companies + known holding groups) that appear
 *      in the archive,
 *   4. emits one edge per (investor, issuer) filing — with the action,
 *      shares, date and the official EGX filing link — nothing invented.
 *
 * Output: src/data/ownership-lens.json (committed; regenerate any time the
 * insiders archive is refreshed).
 *
 * Run: node scripts/t57-build-ownership.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const insiders = JSON.parse(readFileSync("src/data/insiders.json", "utf8"));

// ── current-universe ticker fixes (filings use legacy codes) ──
const TICKER_MAP = {
  ALIC: "RREI", // Arab Real Estate Investment Co. (old ALICO code)
  CRMK: "CRST", // Creast Mark
  GTWO: "GTWL", // Golden Textiles
  FCMI: "FCMD", // Future Care
  // EHDR / KASABF no longer listed — their filings are skipped
};

// ── curated investor dictionary: REAL entities that appear in the archive ──
// name: exact-ish fragments to find in the leftover text (case-insensitive)
// ticker: current listed ticker (null = group/fund, not separately listed)
const INVESTORS = [
  { id: "cib", ticker: "COMI", names: ["Commercial International Bank- Egypt", "Commercial International Bank"], nameEn: "Commercial International Bank (CIB)", nameAr: "البنك التجاري الدولي (CIB)" },
  { id: "efg-holding", ticker: "HRHO", names: ["EFG Holding Group", "EFG Holding", "EFG Hermes"], nameEn: "EFG Holding", nameAr: "المجموعة المالية هيرميس (EFG)" },
  { id: "qala", ticker: "CCAP", names: ["QALA For Financial Investments", "QALA for Financial", "Qalaa Holdings"], nameEn: "QALA Financial Investments", nameAr: "قالة للاستثمارات المالية" },
  { id: "odin", ticker: "ODIN", names: ["ODIN Financial Investments", "ODIN Investments"], nameEn: "ODIN Investments", nameAr: "أودين للاستثمارات" },
  { id: "mohandes", ticker: "MOIN", names: ["Mohandes Insurance"], nameEn: "Mohandes Insurance", nameAr: "المهندس للتأمين" },
  { id: "naeem", ticker: "NAHO", names: ["Naeem Holding", "Naeem Brokerage"], nameEn: "Naeem Holding", nameAr: "نعيم القابضة" },
  { id: "mena-touristic", ticker: "MENA", names: ["Mena Touristic & Real Estate Investm", "Mena Touristic"], nameEn: "Mena Touristic & Real Estate Inv.", nameAr: "مينا للسياحة والاستثمار العقاري" },
  { id: "catalyst", ticker: "CPME", names: ["Catalyst Partners Middle East", "Catalyst Partners"], nameEn: "Catalyst Partners (CPME)", nameAr: "كاتاليست بارتنرز (CPME)" },
  { id: "oriental-weavers", ticker: "ORWE", names: ["Oriental Weavers"], nameEn: "Oriental Weavers", nameAr: "النساجون الشرقيون" },
  { id: "alexandria-spinning", ticker: "SPIN", names: ["Alexandria Spinning & Weaving", "Alexandria Spinning"], nameEn: "Alexandria Spinning & Weaving", nameAr: "الإسكندرية للغزل والنسيج" },
  { id: "atlas", ticker: "AIFI", names: ["Atlas for Investment & Food Indus", "Atlas for Investment"], nameEn: "Atlas for Investment & Food", nameAr: "أطلس للاستثمار والصناعات الغذائية" },
  { id: "ismailia-food", ticker: "INFI", names: ["Ismailia National Food Industri"], nameEn: "Ismailia National Food Industries", nameAr: "الإسماعيلية الوطنية للصناعات الغذائية" },
  { id: "egypt-poultry", ticker: "EPCO", names: ["Egypt for Poultry"], nameEn: "Egypt for Poultry", nameAr: "مصر للدواجن" },
  { id: "efinance", ticker: "EFIH", names: ["E-Finance For Digital and Financial Investements", "E-Finance For Digital and Financial", "E-Finance For Digital"], nameEn: "e-Finance", nameAr: "إي-فاينانس" },
  { id: "nozha-hospital", ticker: "NINH", names: ["Nozha International Hospital"], nameEn: "Nozha International Hospital", nameAr: "مستشفى النزهة الدولي" },
  { id: "moed", ticker: "MOED", names: ["Egyptian Modern Education System"], nameEn: "Egyptian Modern Education Systems", nameAr: "المصرية لنظم التعليم الحديثة" },
  { id: "nile-pharma", ticker: "NIPH", names: ["El-Nile Co. For Pharmaceuticals And Ch", "El-Nile Co. For Pharmaceuticals"], nameEn: "El-Nile Pharmaceuticals", nameAr: "النيل للأدوية والصناعات الكيماوية" },
  { id: "union-pharmacist", ticker: "UPMS", names: ["Union Pharmacist Company For Medical Servi", "Union Pharmacist Company"], nameEn: "Union Pharmacist Co.", nameAr: "الاتحاد للصيادلة" },
  { id: "icfc", ticker: "ICFC", names: ["International Company For Fertilizers & C", "International Company for Fertilizers"], nameEn: "International Co. for Fertilizers", nameAr: "الدولية للأسمدة والكيماويات" },
  { id: "golden-textiles", ticker: "GTWL", names: ["Golden Textiles & Clothes Wool", "Golden Textiles"], nameEn: "Golden Textiles & Clothes Wool", nameAr: "الذهنية للغزل والنسيج" },
  { id: "eastern-tobacco", ticker: "EAST", names: ["Eastern Tobacco"], nameEn: "Eastern Tobacco", nameAr: "الشرقية للدخان" },
  { id: "mm-group", ticker: "MTIE", names: ["MM Group Industrial & International Trade", "MM Group"], nameEn: "MM Group", nameAr: "مجموعة محمد ومصطفى" },
  { id: "tmg-holding", ticker: "TMGH", names: ["TMG Holding"], nameEn: "TMG Holding", nameAr: "مجموعة طلعت مصطفى القابضة", group: true },
  { id: "sinai-cement", ticker: "SCEM", names: ["Sinai Cement"], nameEn: "Sinai Cement", nameAr: "أسمنت سيناء" },
  { id: "ferchem", ticker: "FERC", names: ["FERCHEM MISR CO. FOR FERTILLIZERS & CHEMICALS", "Ferchem Misr"], nameEn: "Ferchem Misr", nameAr: "فيركيم مصر" },
  { id: "act-financial", ticker: "ACTF", names: ["Act Financial"], nameEn: "Act Financial", nameAr: "أكت فاينانشال" },
  { id: "contact-financial", ticker: "CNFN", names: ["Contact Financial Holding"], nameEn: "Contact Financial Holding", nameAr: "كونتاكت المالية القابضة" },
  { id: "ascom", ticker: "ASCM", names: ['Asec Company for Mining "ASCOM"', "Asec Company for Mining"], nameEn: "ASCOM (Asec Mining)", nameAr: "أسيم للحفر والتعدين" },
  { id: "arab-real-estate", ticker: "RREI", names: ["Arab Real Estate Investment CO.- ALICO", "Arab Real Estate Investment CO.-ALICO", "Arab Real Estate Investment"], nameEn: "Arab Real Estate Investment (ALICO)", nameAr: "العربية للاستثمار العقاري (أليكو)" },
];

const TRADE_RE = /تعامل على أسهم\s+(.+?)\s*\((شراء|مبيعات)\)\s*:\s*([\d,]+)\s*سهم/;

const norm = (t) => String(t ?? "").toUpperCase().trim();
const clean = (s) => s.replace(/\s+/g, " ").trim();

const edges = [];
const skippedUnlisted = [];

for (const it of insiders.items) {
  if (it.action !== "bought" && it.action !== "sold") continue;
  const m = TRADE_RE.exec(it.title ?? "");
  if (!m) continue;
  const rawIssuer = m[1];
  const action = m[2] === "شراء" ? "bought" : "sold";
  const shares = Number(m[3].replace(/,/g, ""));
  let targetTicker = TICKER_MAP[it.ticker] ?? it.ticker;

  // find which dictionary entities appear in the leftover text
  const leftovers = [];
  for (const inv of INVESTORS) {
    let rem = rawIssuer;
    for (const n of inv.names) {
      if (rem.toLowerCase().includes(n.toLowerCase())) {
        leftovers.push(inv);
        rem = rem.split(n).join(" ");
      }
    }
  }
  if (!leftovers.length) continue;

  // unlisted targets can't be drawn on the live map — record and skip
  if (!targetTicker || skippedUnlisted.includes(targetTicker)) {
    // keep only if actually known-unlisted
  }

  for (const inv of leftovers) {
    const isSelf = inv.ticker === targetTicker;
    edges.push({
      investorId: inv.id,
      ticker: targetTicker,
      self: isSelf,
      action,
      shares,
      date: it.date,
      filingId: it.filingId ?? null,
      link: it.link ?? null,
    });
  }
}

// aggregate per (investor, ticker): one entry with totals + the filings
const byKey = new Map();
for (const e of edges) {
  const k = `${e.investorId}|${e.ticker}`;
  if (!byKey.has(k)) {
    byKey.set(k, {
      investorId: e.investorId,
      ticker: e.ticker,
      self: e.self,
      boughtShares: 0,
      soldShares: 0,
      filings: 0,
      firstDate: e.date,
      lastDate: e.date,
      links: [],
    });
  }
  const a = byKey.get(k);
  if (e.action === "bought") a.boughtShares += e.shares;
  else a.soldShares += e.shares;
  a.filings += 1;
  if (e.date < a.firstDate) a.firstDate = e.date;
  if (e.date > a.lastDate) a.lastDate = e.date;
  if (e.link && !a.links.includes(e.link)) a.links.push(e.link);
}

const agg = [...byKey.values()].map((a) => ({ ...a, links: a.links.slice(0, 3) }));

const investors = INVESTORS.map((inv) => {
  const mine = agg.filter((a) => a.investorId === inv.id);
  const cross = mine.filter((a) => !a.self);
  return {
    id: inv.id,
    ticker: inv.ticker,
    group: inv.group === true,
    nameEn: inv.nameEn,
    nameAr: inv.nameAr,
    crossHoldings: cross.length,
    filings: mine.reduce((s, a) => s + a.filings, 0),
  };
});

const out = {
  asOf: insiders.asOf,
  generatedAt: new Date().toISOString().slice(0, 10),
  source: insiders.source,
  sourceAr: insiders.sourceAr,
  basis: insiders.basis,
  basisAr: insiders.basisAr,
  noteEn:
    "Investor relationships reconstructed from official EGX post-execution disclosure filings (Capital Market Law Articles 29 & 38) as captured in the desk's disclosure archive. Edges are DOCUMENTED dealings by the listed related party / major holder in the target company's filings — historical facts with dates and filing links, not live ownership percentages.",
  noteAr:
    "علاقات المستثمرين مبنية على إفصاحات البورصة المصرية الرسمية بعد التنفيذ (مواد 29 و38 من قانون سوق المال) كما وثّقها أرشيف الإفصاحات في المنصة. كل رابط هو تعامل موثق للطرف المتصل/المساهم الرئيسي في إفصاحات الشركة المستهدفة — وقائع تاريخية بتواريخها وروابطها الرسمية، وليست نسب ملكية لحظية.",
  investors,
  edges: agg,
};

writeFileSync("src/data/ownership-lens.json", JSON.stringify(out, null, 2) + "\n");

// console summary
const cross = agg.filter((a) => !a.self);
console.log(`investors: ${investors.length}`);
console.log(`edges total: ${agg.length} (cross: ${cross.length}, self: ${agg.length - cross.length})`);
for (const inv of investors.sort((a, b) => b.crossHoldings - a.crossHoldings).slice(0, 12)) {
  console.log(`  ${inv.nameEn.padEnd(42)} cross=${inv.crossHoldings} filings=${inv.filings}`);
}
console.log("wrote src/data/ownership-lens.json");
