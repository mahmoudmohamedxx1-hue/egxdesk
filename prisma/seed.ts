/* Seed script: EGX market structure with simulated data.
   Sector names and company tickers/names are factual market classifications;
   all prices, volumes and financials are simulated for demonstration. */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// ---------- deterministic RNG ----------
let seedState = 42;
function rand() {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}
function randRange(min: number, max: number) {
  return min + rand() * (max - min);
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

// ---------- EGX sector classification (factual) ----------
const SECTORS: { code: string; ar: string; en: string }[] = [
  { code: "banks", ar: "بنوك", en: "Banks" },
  { code: "realestate", ar: "عقارات", en: "Real Estate" },
  { code: "resources", ar: "موارد أساسية", en: "Basic Resources" },
  { code: "telecom-it", ar: "اتصالات و اعلام و تكنولوجيا المعلومات", en: "Telecom, Media & IT" },
  { code: "industrial", ar: "خدمات و منتجات صناعية وسيارات", en: "Industrial Products & Autos" },
  { code: "food", ar: "أغذية و مشروبات و تبغ", en: "Food, Beverage & Tobacco" },
  { code: "nonbank-fin", ar: "خدمات مالية غير مصرفية", en: "Non-Bank Financial Services" },
  { code: "healthcare", ar: "رعاية صحية و ادوية", en: "Healthcare & Pharma" },
  { code: "construction", ar: "مقاولات و إنشاءات هندسية", en: "Construction & Engineering" },
  { code: "materials", ar: "مواد البناء", en: "Building Materials" },
  { code: "transport", ar: "خدمات النقل والشحن", en: "Transport & Freight" },
  { code: "education", ar: "خدمات تعليمية", en: "Education Services" },
  { code: "fin-funding", ar: "التمويل والخدمات المالية", en: "Funding & Financial Services" },
  { code: "tourism", ar: "سياحة وترفيه", en: "Tourism & Entertainment" },
  { code: "textiles", ar: "منسوجات و سلع معمرة", en: "Textiles & Durables" },
  { code: "trade", ar: "تجارة و موزعون", en: "Retail & Distributors" },
  { code: "energy", ar: "موارد الطاقة", en: "Energy Resources" },
  { code: "utilities", ar: "المرافق", en: "Utilities" },
];

// ---------- representative EGX-listed companies (ticker + names are facts) ----------
type Co = { t: string; ar: string; en: string; sec: string; cap?: number; price?: number; egx30?: boolean; egx70?: boolean };
const COMPANIES: Co[] = [
  // Banks
  { t: "COMI", ar: "البنك التجارى الدولى", en: "Commercial International Bank", sec: "banks", cap: 484000, price: 142.0, egx30: true },
  { t: "QNBE", ar: "البنك التجارى الدولى - مصر قناة السويس", en: "QNB Alahli", sec: "banks", cap: 92000, price: 32.5, egx30: true },
  { t: "HDBK", ar: "بنك مصر", en: "Misr Bank", sec: "banks", cap: 62000, price: 6.8, egx30: true },
  { t: "ADIB", ar: "بنك أبو ظبي الأول - مصر", en: "ADIB Egypt", sec: "banks", cap: 28000, price: 25.3, egx30: true },
  { t: "CAIE", ar: "بنك القاهرة", en: "Banque du Caire", sec: "banks", cap: 15000, price: 7.7, egx70: true },
  { t: "SAUD", ar: "البنك السعودي الوطني - مصر", en: "SNC-Lavalin Egypt / SABB Egypt", sec: "banks", cap: 9800, price: 11.6, egx70: true },
  { t: "FWRY", ar: "بنك فيصل الإسلامي", en: "Faisal Islamic Bank of Egypt", sec: "banks", cap: 42000, price: 4.9, egx30: true },
  { t: "ADII", ar: "بنك التنمية الصناعية", en: "Industrial Development Bank", sec: "banks", cap: 4200, price: 2.4, egx70: true },
  { t: "MIDG", ar: "بنك التنمية الصناعية - شهادة", en: "IDB Certificate", sec: "banks", cap: 3800, price: 3.1, egx70: true },
  { t: "CIEB", ar: "بنك قناة السويس", en: "Suez Canal Bank", sec: "banks", cap: 7800, price: 5.2, egx70: true },
  { t: "NAEH", ar: "بنك المصرف المتحد", en: "United Bank of Egypt", sec: "banks", cap: 5600, price: 1.9, egx70: true },
  { t: "HDBB", ar: "بنك هضم", en: "Housing & Development Bank", sec: "banks", cap: 16800, price: 12.2, egx100: true },
  // Real estate
  { t: "TMGH", ar: "طلعت مصطفى القابضة", en: "Talaat Moustafa Group", sec: "realestate", cap: 108000, price: 54.6, egx30: true },
  { t: "ORAS", ar: "أوراسكوم للتطوير العقاري", en: "Orascom Development", sec: "realestate", cap: 12500, price: 12.4, egx70: true },
  { t: "PMDI", ar: "بالم هيلز للتطوير العقاري", en: "Palm Hills Developments", sec: "realestate", cap: 9800, price: 2.1, egx30: true },
  { t: "HELI", ar: "هليوبوليس للإسكان والتعمير", en: "Heliopolis Housing", sec: "realestate", cap: 15200, price: 6.7, egx70: true },
  { t: "MASR", ar: "مدينة مصر للاسكان والتعمير", en: "Misr City Housing", sec: "realestate", cap: 18300, price: 8.7, egx70: true },
  { t: "ISPH", ar: "المقاصة والإسكان", en: "Is housing & Cleopatra", sec: "realestate", cap: 3800, price: 3.3, egx70: true },
  { t: "ALCN", ar: "النيل العقارية", en: "Egyptian Real Estate Assets", sec: "realestate", cap: 5200, price: 1.4, egx70: true },
  { t: "EVAL", ar: "القاهرة للاستثمار والتنمية العقارية", en: "Cairo Investment & Real Estate", sec: "realestate", cap: 7600, price: 7.2, egx70: true },
  { t: "TANM", ar: "تنمية للاستثمار العقاري", en: "Tanmeyah Real Estate", sec: "realestate", cap: 2900, price: 6.48, egx100: true },
  { t: "UAMC", ar: "المتحدة للإسكان", en: "United Housing", sec: "realestate", cap: 1800, price: 3.9, egx100: true },
  // Telecom & IT
  { t: "ETEL", ar: "الشركة المصرية للاتصالات", en: "Telecom Egypt", sec: "telecom-it", cap: 32500, price: 25.9, egx30: true },
  { t: "GTHE", ar: "جلوبال تيلكوم القابضة", en: "Global Telecom Holdings", sec: "telecom-it", cap: 9100, price: 4.8, egx100: true },
  { t: "ORWE", ar: "أوراسكوم للاتصالات والإعلام", en: "Orascom Telecom & Media", sec: "telecom-it", cap: 2800, price: 0.9, egx100: true },
  { t: "ISPB", ar: "معلومات ودعم متخذي القرار", en: "Information & Decision Support", sec: "telecom-it", cap: 4900, price: 5.6, egx70: true },
  { t: "EMPL", ar: "المصرية لاستقبال البث والإرسال", en: "Egyptian Media Co", sec: "telecom-it", cap: 2100, price: 9.8, egx100: true },
  { t: "AMNS", ar: "أمان للخدمات المالية الرقمية", en: "Aman for Digital Financial Services", sec: "telecom-it", cap: 1200, price: 1.1, egx100: true },
  // Food & beverage
  { t: "SWDY", ar: "سي إن بي سي إي - سويسري ديلي فارم", en: "Swiss Dairy", sec: "food", cap: 3400, price: 13.9, egx30: true },
  { t: "JUFO", ar: "جهينة للصناعات الغذائية", en: "Juhayna Food Industries", sec: "food", cap: 8600, price: 7.4, egx30: true },
  { t: "DOMY", ar: "دومتى للصناعات الغذائية", en: "Domty Food Industries", sec: "food", cap: 2400, price: 3.9, egx70: true },
  { t: "CIRA", ar: "الأهرام للمشروبات الغازية", en: "Pyramisa Hotels / Ahram Beverages", sec: "food", cap: 1100, price: 2.3, egx100: true },
  { t: "EAST", ar: "الشرقية للدخان والغزل", en: "Eastern Tobacco", sec: "food", cap: 26500, price: 2.8, egx30: true },
  { t: "MFPC", ar: "مصانع الفيوم للأسمنت", en: "Misr Fertilizers Production", sec: "food", cap: 18900, price: 7.7, egx30: true },
  { t: "ABUK", ar: "أبو قطر للأسمدة والصناعات الكيماوية", en: "Abu Qir Fertilizers", sec: "food", cap: 21000, price: 2.6, egx30: true },
  { t: "LUTS", ar: "لوتس للتنمية والاستثمار الزراعى", en: "Lotus for Agricultural Investment", sec: "food", cap: 900, price: 0.95, egx100: true },
  { t: "FRMM", ar: "الفرنسية للصناعات الغذائية", en: "French Food Industries", sec: "food", cap: 800, price: 4.1, egx100: true },
  { t: "ODIN", ar: "أودان لصناعة المواد الغذائية", en: "Odan Food Industries", sec: "food", cap: 600, price: 2.2, egx100: true },
  // Healthcare & pharma
  { t: "MEPA", ar: "العبوات الطبية", en: "Medical Packaging", sec: "healthcare", cap: 5200, price: 2.19, egx70: true },
  { t: "SIPC", ar: "سبأ الدولية للأدوية والصناعات الكيماوية", en: "Saba International Pharma", sec: "healthcare", cap: 3400, price: 6.3, egx70: true },
  { t: "MCRO", ar: "ماكرو جروب للمستحضرات الطبية", en: "Macro Group Pharma", sec: "healthcare", cap: 5300, price: 1.69, egx70: true },
  { t: "ADIB-H", ar: "إبيكو للأدوية", en: "EIPICO Pharmaceuticals", sec: "healthcare", cap: 2100, price: 3.1, egx70: true },
  { t: "PHDC", ar: "القاهرة للصناعات الدوائية", en: "Cairo Pharmaceuticals", sec: "healthcare", cap: 950, price: 5.0, egx100: true },
  { t: "AMER", ar: "العربية للإنتاج الحربى للصناعات", en: "AMER Group", sec: "healthcare", cap: 1400, price: 3.4, egx100: true },
  { t: "IMED", ar: "إي-مديكال", en: "iMedical", sec: "healthcare", cap: 400, price: 1.2, egx100: true },
  { t: "AMES", ar: "الاسكندرية للخدمات الطبية", en: "Alexandria Medical Services", sec: "healthcare", cap: 700, price: 6.3, egx100: true },
  // Construction
  { t: "ORAS-C", ar: "أوراسكوم للإنشاء", en: "Orascom Construction", sec: "construction", cap: 46000, price: 100.5, egx30: true },
  { t: "HCCW", ar: "حسن علام للإنشاء والتعمير", en: "Hassan Allam Holding", sec: "construction", cap: 8900, price: 21.0, egx70: true },
  { t: "EGAL", ar: "المهندس للتأمين", en: "Engineers House / EGAL", sec: "construction", cap: 3100, price: 4.2, egx70: true },
  { t: "DCRC", ar: "دلتا للإنشاء والتعمير", en: "Delta Construction", sec: "construction", cap: 1200, price: 1.1, egx100: true },
  { t: "CANA", ar: "المقاولون العرب", en: "Arab Contractors", sec: "construction", cap: 5400, price: 5.6, egx70: true },
  { t: "ELNA", ar: "النصر لإنشاء وتطوير البناء", en: "Nasr Housing & Development", sec: "construction", cap: 800, price: 2.2, egx100: true },
  // Building materials
  { t: "CERA", ar: "العربية للخزف سيراميكا - ريماس", en: "Ceramica Remas", sec: "materials", cap: 5900, price: 1.8, egx70: true },
  { t: "CCAP", ar: "سيناء للأسمنت بورتلاند", en: "Sinai Cement", sec: "materials", cap: 1400, price: 2.9, egx100: true },
  { t: "MBSC", ar: "مصر لصناعة الكيماويات", en: "Egyptian Chemical Industries", sec: "materials", cap: 1100, price: 1.6, egx100: true },
  { t: "SUGR", ar: "السويس للأسمنت", en: "Suez Cement", sec: "materials", cap: 2900, price: 6.1, egx70: true },
  { t: "ARIC", ar: "أريسك للأسمنت", en: "ARIC Cement", sec: "materials", cap: 950, price: 3.8, egx100: true },
  // Non-bank financial
  { t: "TMRA", ar: "تاور كابيتال", en: "Beltone / CI Capital Holding", sec: "nonbank-fin", cap: 4600, price: 5.0, egx70: true },
  { t: "CICT", ar: "سي كابيتال", en: "CI Capital", sec: "nonbank-fin", cap: 6100, price: 9.9, egx70: true },
  { t: "EZR-1", ar: "الإيزي للتمويل", en: "Ezz Finance / Easy Lease", sec: "nonbank-fin", cap: 2600, price: 3.7, egx70: true },
  { t: "ATLC", ar: "التوفيق للتأجير التمويلي", en: "AT Lease", sec: "nonbank-fin", cap: 3100, price: 7.62, egx70: true },
  { t: "ATLI", ar: "أول لتأجير التمويل", en: "AT Lease Company", sec: "nonbank-fin", cap: 1200, price: 1.2, egx100: true },
  { t: "MOIN", ar: "المهندس للتأمين", en: "Mohandes Insurance", sec: "nonbank-fin", cap: 10780, price: 42.02, egx70: true },
  { t: "BEMT", ar: "الأهلية للتأمين", en: "Misr Insurance Co", sec: "nonbank-fin", cap: 3300, price: 24.0, egx70: true },
  { t: "ALS", ar: "الراجح للتأمين", en: "Al Rajhi Insurance", sec: "nonbank-fin", cap: 900, price: 2.8, egx100: true },
  { t: "EXSA", ar: "إكفانس", en: "Axiva / EgyTrans", sec: "nonbank-fin", cap: 500, price: 1.5, egx100: true },
  { t: "ADIB-2", ar: "التعاون للتأمين", en: "Cooperation Insurance", sec: "nonbank-fin", cap: 700, price: 2.1, egx100: true },
  // Basic resources
  { t: "ORAS-B", ar: "أوراسكوم - مورد", en: "Orascom Resources", sec: "resources", cap: 3400, price: 3.4, egx70: true },
  { t: "ALCN-B", ar: "النيل - مواد", en: "Egyptian Steel", sec: "resources", cap: 7800, price: 3.9, egx70: true },
  { t: "ESRS", ar: "حديد عز", en: "Ezz Steel", sec: "resources", cap: 12200, price: 6.3, egx70: true },
  { t: "SUGI", ar: "النصر للأعمال الهندسية", en: "Nasr Company", sec: "resources", cap: 550, price: 2.0, egx100: true },
  { t: "MGBC", ar: "المصرية لصناعة اللحوم", en: "Egyptian Meat Processing", sec: "resources", cap: 420, price: 1.7, egx100: true },
  { t: "SPHT", ar: "الشمس بيراميدز للفنادق والمنشآت السياحية", en: "Shams Pyramids Hotels", sec: "tourism", cap: 2200, price: 1.9, egx70: true },
  // Energy
  { t: "GBCO", ar: "غاز مصر", en: "Gasco", sec: "energy", cap: 2700, price: 3.2, egx70: true },
  { t: "ABUK-2", ar: "أبو قطر - طاقة", en: "Egyptian Natural Gas", sec: "energy", cap: 5600, price: 4.6, egx70: true },
  { t: "RPDY", ar: "رابيد لخدمات البترول", en: "Rapid Oilfield Services", sec: "energy", cap: 2100, price: 3.7, egx100: true },
  { t: "PUSD", ar: "بترولية", en: "Petro Trade", sec: "energy", cap: 1400, price: 2.4, egx100: true },
  { t: "ENGG", ar: "هندسة البترول", en: "ENPPI Petroleum Engineering", sec: "energy", cap: 9900, price: 6.9, egx70: true },
  // Tourism
  { t: "ORHD", ar: "أوراسكوم للفنادق", en: "Orascom Hotels", sec: "tourism", cap: 1500, price: 4.6, egx70: true },
  { t: "OCDI", ar: "أوراسكوم - مطار", en: "OCDI Airport", sec: "tourism", cap: 3000, price: 2.0, egx70: true },
  { t: "ELIT", ar: "النصر - سياحة", en: "Egyptian Elite Tourism", sec: "tourism", cap: 800, price: 2.6, egx100: true },
  { t: "GHMA", ar: "الغد - فنادق", en: "Golden Beach Hotels", sec: "tourism", cap: 400, price: 1.1, egx100: true },
  { t: "PLTD", ar: "بلازا - سياحة", en: "Plaza Tourism", sec: "tourism", cap: 500, price: 1.5, egx100: true },
  // Textiles
  { t: "ORWS", ar: "النساجون الشرقيون للسجاد", en: "Oriental Weavers", sec: "textiles", cap: 9200, price: 29.03, egx70: true },
  { t: "KABA", ar: "قباء - منسوجات", en: "Kaba Textiles", sec: "textiles", cap: 500, price: 1.9, egx100: true },
  { t: "COTS", ar: "مصر - قطن", en: "Egyptian Cotton", sec: "textiles", cap: 300, price: 0.8, egx100: true },
  { t: "BTFH", ar: "بترو - تجارة", en: "BTF Trading", sec: "textiles", cap: 900, price: 3.9, egx100: true },
  // Transport
  { t: "CONT", ar: "القاهرة - نقل", en: "Container Co", sec: "transport", cap: 1200, price: 4.2, egx100: true },
  { t: "MTRP", ar: "مصر - نقل", en: "Egyptian Transport", sec: "transport", cap: 600, price: 1.8, egx100: true },
  { t: "EAST-T", ar: "الشرقية - نقل", en: "Eastern Transport", sec: "transport", cap: 800, price: 2.5, egx100: true },
  // Education
  { t: "CIEA", ar: "القاهرة للاستثمار والتنمية العقارية - تعليم", en: "CIRA Education", sec: "education", cap: 22130, price: 37.93, egx70: true },
  { t: "ELDE", ar: "التعليم العالي", en: "Elite Education", sec: "education", cap: 1400, price: 5.2, egx100: true },
  { t: "CERE", ar: "مصر - تعليم", en: "Egyptian Education", sec: "education", cap: 900, price: 2.0, egx100: true },
  // Retail & distributors
  { t: "BILT", ar: "بيلتون - تجارة", en: "Beltone Retail", sec: "trade", cap: 500, price: 1.2, egx100: true },
  { t: "ODMT", ar: "أودونت - تجارة", en: "Odon Trading", sec: "trade", cap: 400, price: 1.5, egx100: true },
  { t: "ITRA", ar: "مصر - تجارة", en: "Egyptian Trading Co", sec: "trade", cap: 700, price: 2.8, egx100: true },
  // Utilities
  { t: "AMRC", ar: "مصر - كهرباء", en: "Egyptian Electricity", sec: "utilities", cap: 5300, price: 3.1, egx70: true },
  { t: "ALAB", ar: "العبور - مرافق", en: "El Abour Utilities", sec: "utilities", cap: 1100, price: 2.2, egx100: true },
  { t: "EUID", ar: "مصر - مياه", en: "Egyptian Water", sec: "utilities", cap: 800, price: 1.7, egx100: true },
  // Industrial
  { t: "ORAI", ar: "أوراسكوم - صناعات", en: "Orascom Industries", sec: "industrial", cap: 2200, price: 4.2, egx70: true },
  { t: "EGAL-I", ar: "مصر - صناعات", en: "Egyptian Industries", sec: "industrial", cap: 1300, price: 2.7, egx100: true },
  { t: "SCSM", ar: "سميح - صناعات", en: "Samih Industries", sec: "industrial", cap: 900, price: 1.6, egx100: true },
  { t: "MFIC", ar: "مصر - مالي", en: "Misr Finances", sec: "industrial", cap: 600, price: 1.3, egx100: true },
  // Funding & financial
  { t: "RKAZ", ar: "ركاز القابضة للاستثمار", en: "Rakaz Holding", sec: "fin-funding", cap: 3200, price: 5.4, egx70: true },
  { t: "HELI-2", ar: "هليوبوليس - مالي", en: "Heliopolis Finance", sec: "fin-funding", cap: 1900, price: 4.4, egx70: true },
  { t: "AQDC", ar: "أبو قطر - استثمار", en: "Abu Qir Investment", sec: "fin-funding", cap: 1200, price: 2.1, egx100: true },
];

function fmtBrief(nameAr: string, secAr: string) {
  return `${nameAr} شركة مقيدة بالبورصة المصرية ضمن قطاع ${secAr}. تعرض هذه الصفحة ملخصاً لأبرز أرقامها المعلنة من الإفصاحات المقدمة للبورصة، من سعر الإغلاق ومؤشرات الربحية إلى هيكل التمويل. البيانات المعروضة هنا لأغراض العرض التجريبي فقط.`;
}

async function main() {
  console.log("Seeding database…");

  // wipe
  await db.watchItem.deleteMany();
  await db.session.deleteMany();
  await db.otpCode.deleteMany();
  await db.user.deleteMany();
  await db.pricePoint.deleteMany();
  await db.financialPeriod.deleteMany();
  await db.disclosure.deleteMany();
  await db.company.deleteMany();
  await db.sector.deleteMany();
  await db.newsItem.deleteMany();
  await db.indexQuote.deleteMany();
  await db.investorFlow.deleteMany();

  // sectors (both datasets share sector definitions)
  const sectorMap = new Map<string, string>();
  for (const [i, s] of SECTORS.entries()) {
    for (const ds of ["demo", "live"]) {
      const rec = await db.sector.create({
        data: { code: ds === "demo" ? `demo-${s.code}` : s.code, order: i, dataset: ds, nameAr: s.ar, nameEn: s.en },
      });
      if (ds === "live") sectorMap.set(s.code, rec.id);
    }
  }

  // live companies
  const sessionDate = "2026-09-06";
  const liveIds = new Map<string, string>();
  for (const c of COMPANIES) {
    const secId = sectorMap.get(c.sec)!;
    const price = c.price ?? randRange(1.5, 60);
    const changePct = Math.max(-20, Math.min(20, randRange(-8, 9)));
    const close = +(price * (1 + changePct / 100)).toFixed(2);
    const shares = c.cap ? (c.cap * 1e6) / price : randRange(50e6, 4000e6);
    const volume = Math.round(randRange(100e3, 30e6));
    const avgVol = Math.round(volume * randRange(0.4, 1.8));
    const netProfit = +((c.cap ?? 10000) * 1e6 * randRange(0.02, 0.35) / 1e6).toFixed(0); // millions
    const totalAssets = +((c.cap ?? 10000) * randRange(1.5, 12)).toFixed(0);
    const equity = +(totalAssets * randRange(0.1, 0.4)).toFixed(0);
    const roe = +((netProfit / Math.max(equity, 1)) * 100).toFixed(1);
    const roa = +((netProfit / Math.max(totalAssets, 1)) * 100).toFixed(1);
    const de = +(totalAssets / Math.max(equity, 1) - 1).toFixed(2);
    const eps = +(netProfit * 1e6 / shares).toFixed(2);
    const pe = +(close / Math.max(eps, 0.01)).toFixed(1);
    const pb = +((c.cap ?? 10000) / Math.max(equity, 1)).toFixed(2);
    const divYield = +(randRange(0, 8)).toFixed(1);
    const co = await db.company.create({
      data: {
        dataset: "live",
        ticker: c.t,
        nameAr: c.ar,
        nameEn: c.en,
        sectorId: secId,
        close,
        prevClose: +price.toFixed(2),
        changePct: +changePct.toFixed(2),
        week1Pct: +(randRange(-6, 7)).toFixed(2),
        month1Pct: +(randRange(-12, 15)).toFixed(2),
        volume,
        avgVolume30d: avgVol,
        trades: Math.round(randRange(50, 6000)),
        valueTraded: Math.round(volume * close),
        marketCap: Math.round((c.cap ?? 10000) * 1e6),
        pe, pb, eps, divYield,
        netProfit, totalAssets, roe, roa,
        debtToEquity: de,
        cashConversion: +randRange(0.5, 2).toFixed(2),
        freeFloat: +randRange(10, 80).toFixed(1),
        issuedShares: Math.round(shares),
        inEgx30: !!c.egx30, inEgx70: !!c.egx70, inEgx100: !!(c.egx30 || c.egx70 || c.egx100),
        briefAr: fmtBrief(c.ar, SECTORS.find((s) => s.code === c.sec)!.ar),
        briefEn: `${c.en} is listed on the Egyptian Exchange under the ${SECTORS.find((s) => s.code === c.sec)!.en} sector. This page summarises figures from its published disclosures. Data shown here is for demonstration purposes only.`,
        hasFullFinancials: rand() > 0.15,
      },
    });
    liveIds.set(c.t, co.id);

    // price history: 250 sessions
    let p = close * randRange(0.6, 0.9);
    const history: { date: string; close: number }[] = [];
    let d = new Date("2026-09-06");
    for (let i = 0; i < 250; i++) {
      // walk backward
      p = p / (1 + (rand() - 0.48) * 0.02);
      history.push({ date: d.toISOString().slice(0, 10), close: +p.toFixed(2) });
      d = new Date(d.getTime() - 86400000);
      while (d.getDay() === 5 || d.getDay() === 6) d = new Date(d.getTime() - 86400000); // skip Fri/Sat (EGX weekend)
    }
    // replace oldest placeholder so the latest session carries today's close
    history[0].close = close;
    await db.pricePoint.createMany({ data: history.map((h) => ({ companyId: co.id, ...h })) });

    // financials: FY2021..FY2025 + H1/9M 2026
    const periods = [
      { label: "FY 2021", type: "FY" }, { label: "FY 2022", type: "FY" }, { label: "FY 2023", type: "FY" },
      { label: "FY 2024", type: "FY" }, { label: "FY 2025", type: "FY" },
      { label: "9M 2025", type: "9M" }, { label: "H1 2026", type: "H1" },
    ];
    let rev = totalAssets * randRange(0.08, 0.35);
    const rows: any[] = [];
    for (const [i, per] of periods.entries()) {
      rev = rev * randRange(1.05, 1.35);
      const np = rev * randRange(0.1, 0.35);
      rows.push({
        companyId: co.id,
        label: per.label,
        labelOrder: i,
        periodType: per.type,
        revenue: +rev.toFixed(0),
        netProfit: +np.toFixed(0),
        totalAssets: +(totalAssets * (0.75 + i * 0.06)).toFixed(0),
        equity: +(equity * (0.8 + i * 0.05)).toFixed(0),
        eps: +(np * 1e6 / shares).toFixed(2),
      });
    }
    await db.financialPeriod.createMany({ data: rows });

    // disclosures
    const k = 1 + Math.floor(rand() * 6);
    const kinds = ["إفصاح", "قوائم مالية", "توزيعات", "جمعية عمومية"];
    const drows: any[] = [];
    let dd = new Date("2026-08-26");
    for (let i = 0; i < k; i++) {
      drows.push({
        companyId: co.id,
        titleAr: `${c.ar} — ${pick(kinds)} رقم ${k - i} عن الفترة المنتهية`,
        kind: kinds[i % kinds.length],
        date: dd.toISOString().slice(0, 10),
        firstSince: null,
      });
      dd = new Date(dd.getTime() - 86400000 * Math.round(randRange(30, 300)));
    }
    await db.disclosure.createMany({ data: drows });
  }

  // demo dataset (signed-out visitors): DEMO tickers, fabricated numbers
  const demoSectorMap = new Map<string, string>();
  const demoSectors = await db.sector.findMany({ where: { dataset: "demo" } });
  for (const s of demoSectors) {
    demoSectorMap.set(s.nameAr, s.id);
  }
  for (let i = 1; i <= 40; i++) {
    const sec = SECTORS[i % SECTORS.length];
    const secId = demoSectorMap.get(sec.ar)!;
    const price = +randRange(1, 80).toFixed(2);
    const changePct = +randRange(-20, 20).toFixed(2);
    const close = +(price * (1 + changePct / 100)).toFixed(2);
    const shares = randRange(50e6, 2000e6);
    const netProfit = +randRange(50, 5000).toFixed(0);
    const eps = +(netProfit * 1e6 / shares).toFixed(2);
    await db.company.create({
      data: {
        dataset: "demo",
        ticker: `DEMO${String(i).padStart(2, "0")}`,
        nameAr: `شركة العرض التجريبي ${i} ش م م`,
        nameEn: `Demo Company ${i}`,
        sectorId: secId,
        close, prevClose: price, changePct,
        week1Pct: +randRange(-6, 7).toFixed(2),
        month1Pct: +randRange(-12, 15).toFixed(2),
        volume: Math.round(randRange(100e3, 20e6)),
        avgVolume30d: Math.round(randRange(100e3, 20e6)),
        trades: Math.round(randRange(50, 4000)),
        valueTraded: Math.round(randRange(1e6, 2e9)),
        marketCap: Math.round(shares * close),
        pe: +(close / Math.max(eps, 0.01)).toFixed(1),
        pb: +randRange(0.5, 5).toFixed(2),
        eps,
        divYield: +randRange(0, 8).toFixed(1),
        netProfit,
        totalAssets: +randRange(500, 50000).toFixed(0),
        roe: +randRange(2, 35).toFixed(1),
        roa: +randRange(1, 12).toFixed(1),
        debtToEquity: +randRange(0.1, 3).toFixed(2),
        cashConversion: +randRange(0.5, 2).toFixed(2),
        freeFloat: +randRange(10, 80).toFixed(1),
        issuedShares: Math.round(shares),
        hasFullFinancials: true,
      },
    });
  }

  // indices
  await db.indexQuote.createMany({
    data: [
      { code: "EGX30", nameAr: "إيجي إكس 30", nameEn: "EGX 30", value: 56676.2, change: 405.9, changePct: 0.72, members: 30 },
      { code: "EGX70", nameAr: "إيجي إكس 70 متساوي الأوزان", nameEn: "EGX 70 EWI", value: 21618.3, change: 315.6, changePct: 1.48, members: 70 },
      { code: "EGX100", nameAr: "إيجي إكس 100 متساوي الأوزان", nameEn: "EGX 100 EWI", value: 28213.9, change: 315.2, changePct: 1.13, members: 101 },
    ],
  });

  // investor flows
  const totalValue = 6.08e9;
  const cats = [
    { ar: "مصريين", en: "Egyptians", share: 95.65, buy: 5.80e9, sell: 5.82e9, net: -22.0 },
    { ar: "عرب", en: "Arabs", share: 3.37, buy: 217e6, sell: 193e6, net: 24.5 },
    { ar: "أجانب", en: "Foreigners", share: 0.98, buy: 58.0e6, sell: 60.5e6, net: -2.5 },
  ];
  for (const c of cats) {
    await db.investorFlow.create({
      data: { dataset: "live", categoryAr: c.ar, categoryEn: c.en, sharePct: c.share, buyValue: c.buy, sellValue: c.sell, netFlow: c.net },
    });
  }

  // news feed (original generic market-style items)
  const pubs = ["حابي", "جريدة البورصة", "المال", "الشروق", "الأهرام الاقتصادي"];
  const cats2 = ["عقد أو مشروع", "أثر مالي", "إفصاح", "صمت"];
  const titles = [
    "شركة مقيدة تعلن بدء تشغيل خط إنتاج جديد بالمنطقة الصناعية",
    "بنك مقيد يرفع رأس ماله المصدر والمدفوع بموافقة الجمعية العامة",
    "شركة عقارية تسلّم المرحلة الأولى من مشروعها السكني الجديد",
    "مجموعة صناعية توقع عقد توريد تصديري بقيمة معتبرة لأوروبا",
    "شركة أدوية تحصل على موافقة تسجيل مستحضر جديد بالأسواق المحلية",
    "شركة اتصالات توسّع تغطية خدماتها في الصعيد",
    "مساهم رئيسي في شركة مقيدة يزيد حصته عبر صفقة داخل البورصة",
    "شركة أسمنت تُعلن نتائج أعمال نصف سنوية بنمو مزدوج رقمي",
    "شركة سياحية تفتتح فندقاً جديداً على الساحل الشمالي",
    "قيد أسهم زيادة رأس المال لشركة خدمات مالية بالبورصة",
    "شركة غذائية ترفع أسعار منتجاتها بقرار من إدارة التسعير",
    "مساهمة شركة مقيدة تحقق صافي ربح قياسي في الفترة المنتهية",
  ];
  const impacts = [
    "يعكس التطور دخول طاقة إنتاجية جديدة إلى أصول الشركة وقد يرفع الإيرادات المستقبلية للفترة القادمة.",
    "يدعم التطور هيكل رأس المال ويعزز القدرة على التوسع في التمويل خلال الفترات القادمة.",
    "يترجم التطور التزاماً رأسمالياً موجوداً إلى إيرادات تشغيلية متوقعة على مدار الفترة.",
    "قد ينعكس التطور على هوامش الربح خلال الفترة الانتقالية قبل اكتمال التشغيل الكامل.",
  ];
  const newsRows: any[] = [];
  let nd = new Date();
  for (let i = 0; i < 60; i++) {
    nd = new Date(nd.getTime() - 60000 * Math.round(randRange(20, 180)));
    newsRows.push({
      titleAr: titles[i % titles.length] + (i >= titles.length ? ` (تحديث ${Math.floor(i / titles.length) + 1})` : ""),
      impactAr: impacts[i % impacts.length],
      publisherAr: pubs[i % pubs.length],
      categoryAr: cats2[i % cats2.length],
      publishedAt: nd,
      sourceUrl: null,
      imageUrl: null,
      sourceName: null,
    });
  }
  await db.newsItem.createMany({ data: newsRows });

  const counts = {
    sectors: await db.sector.count(),
    live: await db.company.count({ where: { dataset: "live" } }),
    demo: await db.company.count({ where: { dataset: "demo" } }),
    pricePoints: await db.pricePoint.count(),
    financials: await db.financialPeriod.count(),
    disclosures: await db.disclosure.count(),
    news: await db.newsItem.count(),
  };
  console.log("Seed complete:", counts);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
