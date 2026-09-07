/**
 * Arabic search support — normalization + curated brand-alias map.
 *
 * The quote source provides English names only, so Arabic queries used to
 * return nothing. This module lets users type the Arabic brand names used by
 * Egyptian financial press ("التجاري الدولي", "طلعت مصطفى", "السويدي"…)
 * and still find the company.
 *
 * The alias map is factual public naming (no invented data). Spelling
 * variants are handled by normalization: diacritics, tatweel, alef forms,
 * taa-marbuta and final-yaa are unified before matching, so "أبو قير",
 * "ابو قير" and "أبوقير" all match.
 */

/** Normalize a mixed Arabic/Latin string for tolerant matching. */
export function normalizeAr(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "") // harakat + superscript alef
    .replace(/\u0640/g, "") // tatweel
    .replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627") // alef variants -> ا
    .replace(/\u0629/g, "\u0647") // taa marbuta -> ه
    .replace(/\u0649/g, "\u064A") // alef maqsura -> ي
    .replace(/\s+/g, " ")
    .trim();
}

/** Ticker -> common Arabic brand names (Egyptian financial-press usage). */
export const AR_ALIASES: Record<string, string[]> = {
  COMI: ["التجاري الدولي", "البنك التجاري الدولي", "سي آي بي", "سي اي بي"],
  TMGH: ["طلعت مصطفى"],
  HRHO: ["إي إف جي", "هيرميس"],
  ETEL: ["المصرية للاتصالات", "اتصالات مصر"],
  EAST: ["الشرق للدخان", "الشرقية للدخان"],
  ABUK: ["أبو قير"],
  QALA: ["قلعة"],
  SWDY: ["السويدي", "سويسي"],
  ORWE: ["أورينتال ويفرز", "النسيج الشرقي"],
  ORAS: ["أوراسكوم للإنشاء", "أوراسكوم"],
  ORHD: ["أوراسكوم للتطوير العقاري", "أوراسكوم للتطوير"],
  MFPC: ["مصر لإنتاج الأسمدة", "مصر للأسمدة", "موبكو"],
  ESRS: ["حديد عز"],
  ADIB: ["أبو ظبي الإسلامي"],
  FWRY: ["فوري"],
  AMOC: ["الإسكندرية للزيوت"],
  EFID: ["إيديتا"],
  GBCO: ["غبور"],
  DOMY: ["دومتي"],
  EMFD: ["إعمار مصر", "إعمار"],
  PHDC: ["بالم هيلز", "بالم هيلز للتعمير"],
  EGAL: ["مصر للألومنيوم", "الألومنيوم"],
  HDBK: ["بنك التعمير", "بنك التعمير والإسكان"],
  QNBE: ["قطر الوطني"],
  ALCN: ["الإسكندرية للحاويات", "الحاويات"],
  EFIH: ["إي فاينانس", "اي فاينانس"],
  OCDI: ["ساديك", "السادس من أكتوبر"],
  CANA: ["بنك قناة السويس"],
  JUFO: ["جهينة", "جهينة للصناعات الغذائية"],
  HELI: ["هليوبوليس للإسكان", "هليوبوليس"],
  BTFH: ["بلتون"],
  RAYA: ["راية"],
  CIEB: ["كريدي أجريكول", "بنك كريدي أجريكول"],
  FAIT: ["فيصل الإسلامي", "بنك فيصل الإسلامي"],
  FAITA: ["فيصل الإسلامي", "بنك فيصل الإسلامي"],
  VLMR: ["فالمور"],
  IRON: ["الحديد والصلب", "مصر للحديد والصلب"],
  ARCC: ["أسمنت العربية", "الأسمنت العربية"],
  EGCH: ["الكيماويات المصرية"],
  BIOC: ["جلاكسو"],
  SCEM: ["أسمنت سيناء", "سيناء للأسمنت"],
  CLHO: ["كليوباترا", "مستشفيات كليوباترا"],
  IRAX: ["عز الدخيلة", "حديد عز الدخيلة"],
  MCQE: ["أسمنت قنا"],
  VALU: ["فالو", "فال يو"],
  MBSC: ["أسمنت بني سويف", "بني سويف للأسمنت"],
  PHAR: ["إيبيكو"],
  SKPC: ["سيدي كرير", "سيدي كرير للبتروكيماويات"],
  CIRA: ["القاهرة للاستثمار", "القاهرة للاستثمار والتطوير العقاري"],
  POUL: ["القاهرة للدواجن"],
  SAUD: ["البركة", "بنك البركة"],
  ISPH: ["ابن سينا", "ابن سينا فارما"],
  // The 14 listings the exchange directory carries without an Arabic name —
  // press-standard renderings so no row ever shows Latin-only in Arabic mode.
  ANCC: ["النهضة للصناعات"],
  CID: ["الصناعات الكيماوية للتنمية"],
  EEP: ["منصة مصر للتعليم"],
  EGOTH: ["صندوق المصرية للسياحة إيجي إكس 100"],
  GOUR: ["جورميه مصر للأغذية"],
  GROV: ["جروفا للاستحواذ ذات غرض خاص"],
  KNGC: ["النصر للزجاج والكريستال"],
  LKGP: ["مجموعة لاكه القابضة للاستثمار المالي"],
  MITR: ["صندوق مصر للسفر والسياحة"],
  MMHC: ["المعمورة للتعمير والتنمية السياحية"],
  NFCI: ["النصر للأسمدة والصناعات الكيماوية"],
  NMIN: ["صندوق النصر للتعدين"],
  OCAP: ["أو جي كابيتال للاستثمار"],
  YAYT: ["الينابيع لصناعة احتياجات النقل"],
};

/** Best Arabic display name for a ticker (first alias) or null. */
export function arabicName(ticker: string): string | null {
  return AR_ALIASES[ticker]?.[0] ?? null;
}

export type ArMatch = { ticker: string; alias: string; score: number };

/**
 * Score Arabic matches for a query against the alias map.
 * Returns matches sorted best-first.
 */
export function matchArabic(q: string): ArMatch[] {
  const nq = normalizeAr(q);
  if (!nq) return [];
  const out: ArMatch[] = [];
  for (const [ticker, aliases] of Object.entries(AR_ALIASES)) {
    for (const alias of aliases) {
      const na = normalizeAr(alias);
      if (!na) continue;
      let score = 0;
      if (na === nq) score = 100;
      else if (na.startsWith(nq)) score = 85;
      else if (na.includes(nq)) score = 70;
      else if (nq.includes(na) && na.length >= 3) score = 60;
      if (score > 0) {
        out.push({ ticker, alias, score });
        break;
      }
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** True when the (possibly Arabic) query matches a row's Arabic aliases. */
export function rowMatchesArabic(ticker: string, q: string): boolean {
  const nq = normalizeAr(q);
  if (!nq) return false;
  const aliases = AR_ALIASES[ticker];
  if (!aliases) return false;
  return aliases.some((a) => {
    const na = normalizeAr(a);
    return na.includes(nq) || (nq.includes(na) && na.length >= 3);
  });
}
