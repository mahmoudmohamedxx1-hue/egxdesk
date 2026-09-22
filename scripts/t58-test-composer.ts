/** T58 — unit check: the language gate + deterministic composer against the
 *  EXACT garbage captured from the live Vercel keyless tier today. */
import { languageOk, composeBriefing } from "../src/lib/briefing-composer";

const liveGarbage = `**الخلاصة:** mercado aberto está estável, com pequeno crescimento no EGX30 (+0.12%), movimento amplo de 102 em alta contra 127 em baixa, com 296 ações negociadas – dia relativamente equilibrado. Egyptian investors ganharam uma soma líquida de EGP 403 milhões, enquanto estrangeiros venderam para uma subtração líquida de EGP 377 milhões hoje. Setorialmente, Utilities lidera, enquanto Health Care secteurs está em último lugar, com maior movimento individual SPHT (+22,4%) tuvieron(columns: trésor సి modeling`;

const localClean = `**الخلاصة:** السوق المصري يعاني من ضغوط بيعية محدودة مع تراجع طفيف في المؤشرات الرئيسية، حيث انخفض EGX30 بنسبة 0.12% ليغلق عند 54,930.9 نقطة، بينما شهد EGX70 تراجعاً بنسبة 0.1% عند 20,460.4 نقطة، واتساع الحركة 102 صاعد مقابل 127 هابط من 296 سهم. المصريون +403 مليون جنيه صافي مقابل الأجانب -377 مليون جنيه، وقطاعياً المرافق في الصدارة والرعاية الصحية في المؤخرة، وأكبر حركة SPHT بنسبة +22.41%.`;

const toolResult = {
  indices: [
    { code: "EGX30", nameAr: "EGX 30", close: 54930.9, changePct: -0.12 },
    { code: "EGX70", close: 20460.4, changePct: -0.1 },
    { code: "EGX100", close: 26994.7, changePct: -0.02 },
  ],
  breadth: { up: 102, down: 127, flat: 67, total: 296 },
  movers: [
    { ticker: "SPHT", nameAr: "الشمس بيراميدز للفنادق", changePct: 22.41 },
    { ticker: "NAPR", nameAr: "الوطنية للطباعة والنشر", changePct: 17.1 },
  ],
  bestSector: { nameAr: "المرافق", changePct: 1.2 },
  worstSector: { nameAr: "الرعاية الصحية", changePct: -0.9 },
  flows: { egyNet: 403, arabNet: -26, forNet: -377 },
  narrative:
    "EGX 30 هابط 0.12%، واتساع الحركة 102 صاعداً مقابل 127 هابطاً من 296 سهم — يوم متوازن نسبياً. المصريون +403 مليون جنيه صافي، مقابل الأجانب −377 مليون — أيدي على الطاولة اليوم.",
};

let fails = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) fails++;
};

check("live garbage REJECTED for ar", languageOk(liveGarbage, "ar") === false);
check("live garbage REJECTED for en", languageOk(liveGarbage, "en") === false);
check("clean local Arabic ACCEPTED for ar", languageOk(localClean, "ar") === true);
check("clean Arabic REJECTED for en (asked English, got Arabic)", languageOk(localClean, "en") === false);
check("short/empty rejected", languageOk("", "ar") === false);

const ar = composeBriefing("ar", [{ tool: "market_overview", result: toolResult }]);
const en = composeBriefing("en", [{ tool: "market_overview", result: toolResult }]);
check("Arabic briefing composed", !!ar);
check("Arabic briefing passes its own gate", !!ar && languageOk(ar, "ar"));
check("English briefing composed", !!en);
check("English briefing passes its own gate", !!en && languageOk(en, "en"));
check("numbers copied verbatim (54,930.9)", !!ar && ar.includes("54,930.9"));
check("numbers copied verbatim (+22.41%)", !!ar && ar.includes("+22.41%"));
check("ticker kept Latin (SPHT)", !!ar && ar.includes("SPHT"));
check("quote section works", (() => {
  const q = composeBriefing("ar", [{ tool: "quote", result: { ticker: "COMI", nameAr: "البنك التجاري الدولي", close: 133.14, changePct: 0.53, changeAbs: 0.7, marketCap: 302_000_000_000, pe: 8.4 } }]);
  return !!q && q.includes("COMI") && q.includes("133.14") && languageOk(q!, "ar");
})());
check("failed tools ignored", composeBriefing("ar", [{ tool: "quote", result: { error: "unknown ticker XXXX" } }]) === null);

console.log("\n=== Arabic briefing preview ===\n" + (ar ?? "NULL").slice(0, 900));
console.log("\n=== English briefing preview ===\n" + (en ?? "NULL").slice(0, 500));
process.exit(fails ? 1 : 0);
