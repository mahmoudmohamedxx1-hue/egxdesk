/** T60 — the esthmr-grade multi-outlet news pipeline.
 *
 *  WHAT THIS IS
 *  The Updates section's news screen reads the SAME Egyptian financial
 *  outlets esthmr.com's own pipeline reads (their /data/v1/news/latest.json
 *  names them openly): Al Borsa, Hapi Journal, Arab Finance, Al Mal News and
 *  Enterprise — plus Amwal Al Ghad which we already carried. Every item is
 *  attributed to the outlet that ran it and links out to the original
 *  article ("اقرأ في المصدر").
 *
 *  HONESTY RULES CLONED FROM THE SOURCE MODEL (esthmr):
 *   - duplicates the outlets run on the same story are MERGED into one card
 *     carrying every source link — counted, never silent;
 *   - items whose headline carries a buy/sell RECOMMENDATION are WITHHELD
 *     (the publisher is not licensed to give advice) — counted too;
 *   - an outlet that cannot be reached today is listed in the provenance
 *     line as "تعذّر الوصول اليوم" instead of pretending to cover it;
 *   - when a matched EGX ticker traded an unusual multiple of its normal
 *     volume in the last completed session, the card SAYS SO (and only when
 *     it crossed 2× — the same threshold the source model uses) — but never
 *     claims the news caused the volume.
 *   - the "financial impact" line under each headline is a per-EVENT-TYPE
 *     explainer written for education, not a prediction about any stock. */

import { AR_ALIASES } from "./ar-search";

// ── attribution-grade ticker matching ───────────────────────────────────
// A ticker pill on a news card is an ATTRIBUTION CLAIM ("this story is
// about this listed company"), so precision outranks recall. The generic
// matcher's hamza-folding makes common nouns collide with brand aliases
// (أعمار "ages" ↔ إعمار "Emaar", راية "flag" ↔ راية "Raya") — for short
// brand aliases we therefore also require a CORPORATE CONTEXT word within
// ±2 tokens, the way a financial editor reads the sentence.

const normAr = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0649/g, "\u064A")
    .replace(/\s+/g, " ")
    .trim();

const CORPORATE_CONTEXT = new Set(
  [
    "قابضة", "قابضه", "بنك", "شركة", "شركه", "مجموعة", "مجموعه", "جروب", "هولدينج",
    "مصر", "المصرية", "المصريه", "المصري", "للتنمية", "للتطوير", "للاستثمار", "للاستثمارات",
    "للتأمين", "للتامين", "للصناعات", "للتجارة", "للتجاره", "للمقاولات", "للاسمنت", "للأسمنت",
    "للصحة", "للصحه", "للتعليم", "للسياحة", "للسياحه", "للإسكان", "للاسكان", "مول", "مدينة",
    "مدينه", "للادوية", "للأدوية", "للطباعة", "للتغليف", "للنقل", "للبترول", "للغاز",
    "للكهرباء", "للائتمان", "لاكتتاب", "للاكتتاب", "للتمويل", "للتمويلات", "للاستشارات",
"المتحدة", "الوطنية", "الوطنيه", "الدولية", "الدوليه", "العالمية", "العالميه",
    "القابضة", "القابضه", "القومية", "القوميه", "الإقليمية", "للاغذية", "للأغذية", "للمشروبات",
  ].map(normAr),
);

function tickerMatchGuarded(
  text: string,
  universe: { ticker: string; name: string }[],
): string[] {
  const out: string[] = [];
  const normText = normAr(text);
  const tokens = normText.split(/[^؀-ۿa-z0-9]+/).filter(Boolean);
  for (const s of universe) {
    const t = s.ticker.replace(/[^A-Z0-9]/gi, "");
    if (t.length >= 3 && new RegExp(`\\b${t}\\b`, "i").test(text)) {
      out.push(s.ticker);
      continue;
    }
    // English name words: TWO distinctive words (one very long one) —
    // the same precision rule the generic matcher uses.
    const words = s.name
      .split(/[^A-Za-z]+/)
      .filter(
        (w) =>
          w.length > 4 &&
          !["Egypt", "Egyptian", "Company", "Holding", "Limited", "Corporation", "General", "Middle"].includes(w),
      )
      .slice(0, 3);
    if (words.length >= 2) {
      const matched = words.filter((w) => new RegExp(`\\b${w}\\b`, "i").test(text)).length;
      if (matched >= 2) {
        out.push(s.ticker);
        continue;
      }
    } else if (words.length === 1 && words[0].length >= 6 && new RegExp(`\\b${words[0]}\\b`, "i").test(text)) {
      out.push(s.ticker);
      continue;
    }
    const aliases = AR_ALIASES[s.ticker];
    if (aliases) {
      const hit = aliases.some((a) => {
        const na = normAr(a);
        if (!na) return false;
        if (na.length >= 6) return normText.includes(na); // distinctive phrase
        // SHORT brand word: standalone token AND a corporate context word
        // within ±2 tokens ("راية القابضة" ✓, a flag in the wind ✗)
        const idx = tokens.indexOf(na);
        if (idx < 0) return false;
        const near = tokens.slice(Math.max(0, idx - 2), idx + 3);
        return near.some((w) => CORPORATE_CONTEXT.has(w));
      });
      if (hit) out.push(s.ticker);
    }
  }
  return out.slice(0, 4);
}

// ── the outlets ─────────────────────────────────────────────────────────────

export type NewsOutlet = {
  id: string;
  name: string;
  nameAr: string;
  home: string;
};

export const OUTLETS: NewsOutlet[] = [
  { id: "alborsa", name: "Al Borsa", nameAr: "جريدة البورصة", home: "https://www.alborsaanews.com" },
  { id: "hapi", name: "Hapi Journal", nameAr: "حابي", home: "https://hapijournal.com" },
  { id: "arabfinance", name: "Arab Finance", nameAr: "عرب فاينانس", home: "https://www.arabfinance.com" },
  { id: "almal", name: "Al Mal News", nameAr: "المال", home: "https://almalnews.com" },
  { id: "enterprise", name: "Enterprise", nameAr: "إنتربرايز", home: "https://enterpriseam.com" },
  { id: "amwal", name: "Amwal Al Ghad", nameAr: "أموال الغد", home: "https://www.amwalalghad.com" },
];

const outletName = (id: string): string => OUTLETS.find((o) => o.id === id)?.nameAr ?? id;

// ── raw item shape (per outlet, before merge) ───────────────────────────────

type RawItem = {
  outlet: string;
  title: string;
  link: string;
  published: string; // ISO
  image?: string | null;
  snippet?: string | null;
};

// ── the enriched, client-facing item ────────────────────────────────────────

export type FeedItem = {
  id: string;
  headline: string;
  link: string;
  published: string;
  image: string | null;
  snippet: string | null;
  /** every outlet that ran this story, each with its own article link */
  sources: { id: string; name: string; link: string }[];
  /** rule-based event classification (esthmr-style kind badge) */
  event: string;
  eventLabelAr: string;
  eventLabelEn: string;
  /** per-event-type educational impact line (الأثر المالي) */
  meaningAr: string;
  meaningEn: string;
  /** EGX tickers plausibly mentioned (clickable → company page) */
  tickers: string[];
  /** "named" when a ticker matched, "check" when volume crossed 2× */
  weight: "named" | "check" | null;
  /** why this ticker is flagged: last-session volume vs its 10-session mean */
  volumeNoteAr: string | null;
  volumeNoteEn: string | null;
  volumeRatio: number | null;
};

export type FeedProvenance = {
  generatedAt: string;
  outlets: NewsOutlet[];
  unreachable: { id: string; nameAr: string; note: string }[];
  mergedCount: number;
  withheldCount: number;
  itemCount: number;
};

export type EnrichedFeed = { items: FeedItem[]; provenance: FeedProvenance };

// ── event classification (rule-based, Arabic keywords) ──────────────────────

type EventRule = {
  event: string;
  labelAr: string;
  labelEn: string;
  meaningAr: string;
  meaningEn: string;
  keywords: string[];
};

/** Ordered: the first rule whose keywords hit wins. The last entry is the
 *  fallback. Meanings are per-EVENT-TYPE education in the source model's
 *  spirit — what this kind of event mechanically changes, never a call. */
const EVENT_RULES: EventRule[] = [
  {
    event: "results",
    labelAr: "نتائج أعمال",
    labelEn: "Earnings",
    meaningAr: "أرباح الشركة المعلنة هي ما تقيسه كل مضاعفات التقييم — والمقارنة الصحيحة لنفس الفترة من العام السابق، لا الرقم وحده.",
    meaningEn: "Declared earnings are what every valuation multiple measures — and the honest comparison is the same period last year, not the raw number.",
    keywords: ["نتائج أعمال", "أرباح", "خسائر", "صافي الربح", "قوائم مالية", "القوائم المالية", "خسارة", "أرباحها", "حققت", " تراجعت أرباح", "ارتفعت أرباح", "نتائج", "الربع", "ربع سنوي", "نصف سنوي", "مرحلية"],
  },
  {
    event: "assembly",
    labelAr: "جمعيات عمومية",
    labelEn: "AGM",
    meaningAr: "الجمعية العامة هي صاحب القرار في التوزيعات وزيادة رأس المال وعضوية المجالس — وما يُقرّ فيها يُنفَّذ بصرف النظر عن رأي السوق.",
    meaningEn: "The general assembly owns the dividend, capital-increase and board decisions — what it passes is executed regardless of what the market thinks.",
    keywords: ["جمعية عمومية", "جمعية عامة", "الجمعية العامة", "جمعية غير عادية", "دعوة عمومية"],
  },
  {
    event: "board",
    labelAr: "قرارات مجالس",
    labelEn: "Board",
    meaningAr: "مجلس الإدارة يدير الشركة بين الجمعيات — قراراته في التعيينات والاستثمارات والتمويل تُفصح عنها للبورصة كما هي.",
    meaningEn: "The board runs the company between assemblies — its appointments, investments and financing decisions are disclosed to the exchange as filed.",
    keywords: ["مجلس الإدارة", "مجلس ادارة", "قرارات مجلس", "محضر اجتماع", "لجنة القيد", "يعين", "تعيين عضو", "استقالة"],
  },
  {
    event: "dividend",
    labelAr: "توزيعات",
    labelEn: "Dividend",
    meaningAr: "التوزيع النقدي يخرج من فائض الشركة إلى حامل السهم في تاريخ الحقوق — وعائده يُحسب من سعر السهم يوم الإفصاح، لا من نوايا الإدارة.",
    meaningEn: "A cash dividend moves the company's surplus to whoever holds the share on the record date — its yield is struck off the price at disclosure, not off intent.",
    keywords: ["توزيعات", "توزيع نقدية", "كوبون", "توزيع أرباح", "توزيعات نقدية", "أرباح موزعة", "سهم مجاني", "أسهم مجانية"],
  },
  {
    event: "capital",
    labelAr: "رأس المال",
    labelEn: "Capital change",
    meaningAr: "تغيير رأس المال يغيّر عدد الأسهم القائمة، فيصبح كل سهم مملوك يمثل حصة مختلفة من الشركة نفسها.",
    meaningEn: "A capital change alters how many shares exist, so each share already held comes to represent a different slice of the same company.",
    keywords: ["زيادة رأس المال", "زيادة رأس المال المُصدر", "خفض رأس المال", "رأس المال المدفوع", "المُصدر والمدفوع", "حق أولوية", "اكتتاب", "تجزئة الأسهم", "دمج الأسهم"],
  },
  {
    event: "debt",
    labelAr: "تمويل أو دين",
    labelEn: "Financing",
    meaningAr: "الاقتراض يضخّم ما تملكه من أصول وكذلك ما عليك من التزامات — والفائدة تُدفع قبل أي توزيع، فتكلفة الدين تسبق المكسب.",
    meaningEn: "Borrowing amplifies what you own and what you owe — and interest is paid before any dividend, so the cost of debt precedes the gain.",
    keywords: ["قرض", "قروض", "تمويل", "تسهيلات ائتمانية", "صكوك", "سندات", "استدانة", "اتفاقية تمويل", "تسهيلات بنكية"],
  },
  {
    event: "deal",
    labelAr: "صفقة أو عقد",
    labelEn: "Deal",
    meaningAr: "العقود الجديدة تدخل الإيرادات على مدار التنفيذ لا يوم التوقيع — وقيمتها المعلنة للبورصة هي المرجع، لا عناوين الأخبار.",
    meaningEn: "New contracts enter revenue over their execution, not on signing day — the value filed with the exchange is the reference, not the headline.",
    keywords: ["عقد", "اتفاقية", "استحواذ", "صفقة", "توقيع", "تعاقد", "شراء شركة", "بيع حصة", "اندماج", "استثمارات في", "استثمار", "مشروع", "توسعات", "افتتاح", "خط إنتاج", "توريد"],
  },
  {
    event: "macro",
    labelAr: "الاقتصاد والسياسة",
    labelEn: "Economy & policy",
    meaningAr: "قرارات الفائدة والعملة والتضخم تُعيد تسعير كل الأصول في الاقتصاد دفعة واحدة — والشركات المقترضة والمصدِّرة أسرع تأثراً بها.",
    meaningEn: "Rate, currency and inflation decisions reprice every asset in the economy at once — leveraged borrowers and exporters feel them first.",
    keywords: ["البنك المركزي", "الفائدة", "أسعار الفائدة", "التضخم", "الدولار", "الجنيه", "الاحتياطي", "الناتج المحلي", "الموازنة", "الحكومة", "وزير", "رئيس", "صندوق النقد", "تصنيف ائتماني", "العملة", "بترول", "البترول", "الذهب", "الأسواق العالمية", "الخزانة", "أذون", "البورصة", "المؤشر", "الجلسة", "التعاملات", "السوق", "الأسهم", "التدفقات", "الأجانب", "العرب في", "سيولة", "الاقتصاد", "مصري", "مصر "],
  },
  {
    event: "general",
    labelAr: "عام",
    labelEn: "General",
    meaningAr: "خبر عام عن السوق أو الشركات — لا يتضمن رقماً مالياً بعينه، وإنما سياقاً يقرأه المستثمر ضمن الصورة الأوسع.",
    meaningEn: "A general market or corporate story — no single financial figure in it, just context for the wider picture.",
    keywords: [],
  },
];

function classify(headline: string): EventRule {
  for (const rule of EVENT_RULES) {
    if (rule.keywords.some((k) => headline.includes(k))) return rule;
  }
  return EVENT_RULES[EVENT_RULES.length - 1];
}

// ── recommendation-withholding (the source model's advice filter) ──────────

/** Headlines that tell the reader to buy/sell/hold a security are withheld:
 *  this app is a publisher, not a licensed adviser (Capital Market Law
 *  95/1992 art. 8 territory — the same footer the source site carries). */
const ADVICE_RE = /(توصية|اشتر[ِي]? الآن|بيع الآن|جني أرباح|هدف سعري|سعر مستهدف|لا تفوّت|فرصة شراء|بيع سهم|accumulat\w* now|buy now|sell now|price target)/i;

// ── duplicate merging ────────────────────────────────────────────────────────

const normTitle = (s: string): string =>
  s
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "") // Arabic diacritics + tatweel
    .replace(/[«»"'’“”()\[\]{}:،,.!؟?؛\-–—_/\\|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Two headlines are the same story when their normalized forms overlap by
 *  ≥ 78% of the shorter one's words — the outlets run near-identical copy on
 *  agency wires. A stricter exact match would miss "عاجل:" prefixes. */
function sameStory(a: string, b: string): boolean {
  const wa = normTitle(a).split(" ").filter((w) => w.length > 1);
  const wb = normTitle(b).split(" ").filter((w) => w.length > 1);
  if (!wa.length || !wb.length) return false;
  const sa = new Set(wa);
  const sb = new Set(wb);
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared++;
  const need = Math.ceil(Math.min(sa.size, sb.size) * 0.78);
  return shared >= need && shared >= 4;
}

// ── per-outlet fetchers (direct network strategies) ─────────────────────────

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const TIMEOUT = 9000;

async function getText(url: string, accept: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "ar,en;q=0.9" },
    signal: AbortSignal.timeout(TIMEOUT),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

// — RSS (Al Borsa / Hapi / Enterprise / Amwal Al Ghad) —

function parseRss(xml: string, outlet: string): RawItem[] {
  const out: RawItem[] = [];
  // <item> blocks (RSS 2.0); fields via lenient regex — feeds are simple.
  const items = xml.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/g) ?? [];
  for (const block of items.slice(0, 60)) {
    const title =
      block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() ??
      block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]?.trim();
    const link =
      block.match(/<link[^>]*href="([^"]+)"/)?.[1] ??
      block.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/)?.[1]?.trim() ??
      block.match(/<guid[^>]*>(?:<!\[CDATA\[)?(https?:\/\/[\s\S]*?)(?:\]\]>)?<\/guid>/)?.[1]?.trim();
    const date =
      block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ??
      block.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.trim() ??
      block.match(/<updated>([\s\S]*?)<\/updated>/)?.[1]?.trim();
    const image =
      block.match(/<enclosure[^>]*url="([^"]+)"/)?.[1] ??
      block.match(/<media:content[^>]*url="([^"]+)"/)?.[1] ??
      block.match(/<media:thumbnail[^>]*url="([^"]+)"/)?.[1] ??
      block.match(/<image><url>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/url>/)?.[1] ??
      null;
    const snippet =
      block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ??
      block.match(/<summary>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ??
      null;
    if (!title || !link || !/^https?:\/\//.test(link)) continue;
    const published = date ? new Date(date).toISOString() : new Date().toISOString();
    if (Number.isNaN(Date.parse(published))) continue;
    out.push({ outlet, title, link, published, image, snippet });
  }
  return out;
}

async function fetchRss(url: string, outlet: string): Promise<RawItem[]> {
  return parseRss(await getText(url, "application/rss+xml, application/xml, text/xml, */*"), outlet);
}

// — Arab Finance: HTML list scrape —

function parseArabFinance(html: string, outlet: string): RawItem[] {
  const out: RawItem[] = [];
  const seen = new Set<string>();
  // cards: <a href="/ar/news/newdetails/<slug>" …> with title= attr or inner h2/h3
  const re = /<a[^>]*href="(\/ar\/news\/newdetails\/[^"]+)"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1];
    if (seen.has(href)) continue;
    seen.add(href);
    // find the nearest title: look ahead 400 chars for an <h2|3|4> or title=""
    const after = html.slice(m.index, m.index + 700);
    const title =
      after.match(/title="([^"]{12,180})"/)?.[1]?.trim() ??
      after.match(/<h[234][^>]*>\s*<a[^>]*>([\s\S]{12,180}?)<\/a>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ??
      null;
    if (!title) continue;
    // relative time "منذ 2س10د" or absolute "26/09 01:32"
    const rel = after.match(/منذ\s*(\d+)س\s*(\d+)د/);
    let published = new Date().toISOString();
    if (rel) {
      published = new Date(Date.now() - (Number(rel[1]) * 60 + Number(rel[2])) * 60_000).toISOString();
    } else {
      const abs = after.match(/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
      if (abs) {
        const now = new Date();
        const d = new Date(now.getFullYear(), Number(abs[2]) - 1, Number(abs[1]), Number(abs[3]), Number(abs[4]));
        if (d.getTime() > now.getTime() + 86_400_000) d.setFullYear(d.getFullYear() - 1);
        published = d.toISOString();
      }
    }
    // image may sit inside the same card
    const img = after.match(/src="(\/Gallery\/[^"]+)"/)?.[1];
    out.push({
      outlet,
      title,
      link: `https://www.arabfinance.com${decodeURIComponent(href)}`,
      published,
      image: img ? `https://www.arabfinance.com${img}` : null,
      snippet: null,
    });
    if (out.length >= 50) break;
  }
  return out;
}

// — Al Mal: category pages (relative /<id>/<slug>/ article hrefs + Arabic
//    long-date stamps + excerpts) —

const ALMAL_CATEGORIES = ["الاقتصاد", "أسواق-المال", "شركات", "الاقتصاد-السياسي"];

const AR_MONTHS: Record<string, number> = {
  "يناير": 1, "فبراير": 2, "مارس": 3, "أبريل": 4, "مايو": 5, "يونيو": 6,
  "يوليو": 7, "أغسطس": 8, "سبتمبر": 9, "أكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12,
};

/** "الإثنين، ٢١ سبتمبر ٢٠٢٦ ٠٥:٢٥ م" → ISO (Cairo ≈ UTC+3; exact enough
 *  for feed ordering — the card shows the outlet's own stamp text anyway). */
function parseAlmalDate(s: string): string | null {
  const m = s.match(/(\d{1,2})\s+([\u0600-\u06FF]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*([صم])/);
  if (!m) return null;
  const month = AR_MONTHS[m[2]];
  if (!month) return null;
  let hour = Number(m[4]) % 12;
  if (m[6] === "م") hour += 12;
  const d = new Date(Date.UTC(Number(m[3]), month - 1, Number(m[1]), hour - 3, Number(m[5])));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseAlmalCategory(html: string, outlet: string): RawItem[] {
  const out: RawItem[] = [];
  // each card: an anchor with /<id>/<slug>/ + title=, then an excerpt and a
  // news-time span inside the same card block
  const cards = html.match(/<a[^>]*href="\/(\d{5,})\/([^"]+)"[^>]*title="([^"]{12,180})"[\s\S]{0,900}?<span class="news-time">([\s\S]*?)<\/span>/g) ?? [];
  for (const card of cards) {
    const id = card.match(/href="\/(\d{5,})\//)?.[1];
    const slug = card.match(/href="\/\d{5,}\/([^"]+)"/)?.[1];
    const title = card.match(/title="([^"]{12,180})"/)?.[1]?.trim();
    const timeText = card.match(/<span class="news-time">([\s\S]*?)<\/span>/)?.[1]?.trim() ?? "";
    const excerpt = card.match(/<p class="card-excerpt">([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? null;
    const img = card.match(/<img[^>]*src="(https:\/\/media\.almalnews\.com[^"]+)"/)?.[1];
    if (!id || !slug || !title) continue;
    const published = parseAlmalDate(timeText) ?? new Date().toISOString();
    out.push({
      outlet,
      title,
      link: `https://almalnews.com/${id}/${slug}`,
      published,
      image: img ?? null,
      snippet: excerpt,
    });
    if (out.length >= 30) break;
  }
  return out;
}

// — reader-service fallback (sandbox/dev only) —
// Cloudflare walls hapijournal/almalnews/arabfinance against datacenter IPs.
// In the sandbox a reader service exists that CAN reach them; on Vercel the
// dynamic import throws (no config) and the outlet simply reports
// unreachable — the honest degradation the source model itself ships
// (their feed lists Mubasher and Zawya as unreachable today).

async function readerGetHtml(url: string): Promise<string | null> {
  try {
    const mod = (await import("z-ai-web-dev-sdk")) as unknown as {
      default: { create: () => Promise<{ functions: { invoke: (n: string, a: unknown) => Promise<unknown> } }> };
    };
    const zai = await mod.default.create();
    // the gateway rate-limits bursts — serialize every reader call through a
    // one-at-a-time queue with a short breath, and retry once on 429.
    const run = () => zai.functions.invoke("page_reader", { url });
    let r: unknown;
    try {
      r = await READER_QUEUE(run);
    } catch (e) {
      if (!/429|many requests/i.test(String((e as Error)?.message ?? e))) throw e;
      await new Promise((res) => setTimeout(res, 1500));
      r = await READER_QUEUE(run);
    }
    const d = ((r as { data?: { html?: unknown }; html?: unknown } | null) && ((r as { data?: unknown }).data || r)) || {};
    return typeof (d as { html?: unknown }).html === "string" ? (d as { html: string }).html : null;
  } catch {
    return null;
  }
}

/** one reader request at a time, 350ms apart — the gateway 429s bursts. */
const READER_QUEUE = (() => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(
      () => new Promise<T>((resolve, reject) => {
        setTimeout(() => job().then(resolve, reject), 350);
      }),
    );
    tail = run.catch(() => undefined);
    return run;
  };
})();

/** The reader renders an RSS feed as a list of blocks:
 *  <div><h3><a href="URL">TITLE</a></h3>…<time>DATE</time></div> */
function parseReaderRss(html: string, outlet: string): RawItem[] {
  const out: RawItem[] = [];
  const blocks = html.match(/<div>\s*<h3><a href="(https?:\/\/[^"]+)">([\s\S]*?)<\/a><\/h3>[\s\S]*?<time>([\s\S]*?)<\/time>/g) ?? [];
  for (const b of blocks.slice(0, 60)) {
    const link = b.match(/<a href="(https?:\/\/[^"]+)">/)![1];
    const title = b.match(/<a href="[^"]+">([\s\S]*?)<\/a>/)![1].trim();
    const date = b.match(/<time>([\s\S]*?)<\/time>/)?.[1]?.trim() ?? "";
    const t = Date.parse(date);
    if (!title || !link) continue;
    out.push({ outlet, title, link, published: Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString(), image: null, snippet: null });
  }
  return out;
}

// ── the fetch step with honest per-outlet failure tracking ─────────────────

type FetchOutcome = { outlet: string; items: RawItem[] } | { outlet: string; failed: string };

async function fetchOutlet(id: string): Promise<FetchOutcome> {
  try {
    switch (id) {
      case "alborsa":
        return { outlet: id, items: await fetchRss("https://www.alborsaanews.com/feed", id) };
      case "hapi": {
        try {
          return { outlet: id, items: await fetchRss("https://hapijournal.com/feed", id) };
        } catch {
          const html = await readerGetHtml("https://hapijournal.com/feed");
          if (!html) throw new Error("hapi unreachable (direct + reader)");
          return { outlet: id, items: parseReaderRss(html, id) };
        }
      }
      case "enterprise":
        return { outlet: id, items: await fetchRss("https://enterpriseam.com/rss", id) };
      case "amwal":
        return { outlet: id, items: await fetchRss("https://www.amwalalghad.com/feed", id) };
      case "arabfinance": {
        try {
          const html = await getText("https://www.arabfinance.com/ar/news/newscategory", "text/html");
          return { outlet: id, items: parseArabFinance(html, id) };
        } catch {
          const html = await readerGetHtml("https://www.arabfinance.com/ar/news/newscategory");
          if (!html) throw new Error("arabfinance unreachable (direct + reader)");
          return { outlet: id, items: parseArabFinance(html, id) };
        }
      }
      case "almal": {
        const cats = ALMAL_CATEGORIES.map((c) => `https://almalnews.com/category/${encodeURIComponent(c)}/`);
        const parsePages = (pages: string[]) => pages.flatMap((h) => parseAlmalCategory(h, id));
        try {
          const pages = await Promise.all(cats.map((u) => getText(u, "text/html")));
          const items = parsePages(pages);
          if (!items.length) throw new Error("almal categories empty");
          return { outlet: id, items };
        } catch {
          const pages = await Promise.all(cats.map((u) => readerGetHtml(u)));
          const htmls = pages.filter((h): h is string => Boolean(h));
          const items = parsePages(htmls);
          if (!items.length) throw new Error("almal unreachable (direct + reader)");
          return { outlet: id, items };
        }
      }
      default:
        return { outlet: id, failed: "unknown outlet" };
    }
  } catch (e) {
    return { outlet: id, failed: String((e as Error)?.message ?? e).slice(0, 90) };
  }
}

// ── enrichment: merge → withhold → classify → match → volume context ───────

export type VolumeLookup = {
  ticker: string;
  volume: number | null;
  avgVolume10d: number | null;
};

/** esthmr's weight semantics: 'named' = a listed company matched; 'check' =
 *  that company's last completed session traded ≥ 2× its normal volume. */
const VOLUME_THRESHOLD = 2.0;

function volumeNote(ticker: string, vols: Map<string, VolumeLookup>): {
  ratio: number | null;
  noteAr: string | null;
  noteEn: string | null;
  check: boolean;
} {
  const v = vols.get(ticker);
  if (!v || !v.volume || !v.avgVolume10d) return { ratio: null, noteAr: null, noteEn: null, check: false };
  const ratio = v.volume / v.avgVolume10d;
  const check = ratio >= VOLUME_THRESHOLD;
  const r = ratio >= 10 ? ratio.toFixed(1) : ratio.toFixed(2);
  return {
    ratio,
    check,
    noteAr: check
      ? `هذا الخبر عن ${ticker}، وتداول سهمها ${r}× حجمه المعتاد في آخر جلسة مكتملة.`
      : `هذا الخبر عن ${ticker}. وتداول سهمها في آخر جلسة مكتملة كالمعتاد تقريبًا — ${r}× من المعتاد، ولا ننبّه إلا لما يتجاوز ${VOLUME_THRESHOLD}×.`,
    noteEn: check
      ? `This is about ${ticker}, whose shares traded ${r}× their usual volume in the last completed session.`
      : `This is about ${ticker}. Its shares traded about as much as usual in the last completed session — ${r}× their normal; we only flag anything above ${VOLUME_THRESHOLD}×.`,
  };
}

export function enrichFeed(
  raw: RawItem[],
  universe: { ticker: string; name: string }[],
  vols: Map<string, VolumeLookup>,
): EnrichedFeed {
  // 1) newest first
  const sorted = [...raw].sort((a, b) => b.published.localeCompare(a.published));
  // 2) merge duplicates the outlets run on the same story
  type Cluster = { head: RawItem; all: RawItem[] };
  const clusters: Cluster[] = [];
  for (const item of sorted) {
    const hit = clusters.find((c) => sameStory(c.head.title, item.title));
    if (hit) hit.all.push(item);
    else clusters.push({ head: item, all: [item] });
  }
  const mergedCount = raw.length - clusters.length;
  // 3) withhold recommendation-carrying headlines
  const kept: Cluster[] = [];
  let withheldCount = 0;
  for (const c of clusters) {
    if (ADVICE_RE.test(c.head.title)) withheldCount++;
    else kept.push(c);
  }
  // 4) build items
  const items: FeedItem[] = kept.slice(0, 240).map((c) => {
    const head = c.head;
    const rule = classify(head.title);
    const text = `${head.title} ${head.snippet ?? ""}`;
    const tickers = universe.length ? tickerMatchGuarded(text, universe) : [];
    let weight: FeedItem["weight"] = null;
    let vNote = { ratio: null as number | null, noteAr: null as string | null, noteEn: null as string | null, check: false };
    if (tickers.length) {
      weight = "named";
      vNote = volumeNote(tickers[0], vols);
      if (vNote.check) weight = "check";
    }
    // earliest first: who ran it first — and one link per outlet (the same
    // story appearing in two of an outlet's sections is still one source)
    const sources = [...c.all]
      .sort((a, b) => a.published.localeCompare(b.published))
      .reduce<{ id: string; name: string; link: string }[]>((acc, r) => {
        if (!acc.some((x) => x.id === r.outlet)) acc.push({ id: r.outlet, name: outletName(r.outlet), link: r.link });
        return acc;
      }, []);
    return {
      id: `${head.outlet}-${head.link.slice(-64)}`,
      headline: head.title,
      link: head.link,
      published: head.published,
      image: head.image ?? c.all.find((r) => r.image)?.image ?? null,
      snippet: head.snippet ?? null,
      sources,
      event: rule.event,
      eventLabelAr: rule.labelAr,
      eventLabelEn: rule.labelEn,
      meaningAr: rule.meaningAr,
      meaningEn: rule.meaningEn,
      tickers,
      weight,
      volumeNoteAr: vNote.noteAr,
      volumeNoteEn: vNote.noteEn,
      volumeRatio: vNote.ratio,
    };
  });

  return {
    items,
    provenance: {
      generatedAt: new Date().toISOString(),
      outlets: OUTLETS,
      unreachable: [],
      mergedCount,
      withheldCount,
      itemCount: items.length,
    },
  };
}

/** Fetch every outlet in parallel and enrich. Outlets unreachable by BOTH
 *  the direct network and the reader fallback (when available) are reported
 *  in provenance — never faked.
 *
 *  `snapshot` (optional): raw items per outlet captured by the daily
 *  workflow (src/data/news-snapshot.json). When the runtime network loses
 *  an outlet the snapshot reached, the snapshot's items for THAT outlet
 *  join the merge — the union of the two networks is the feed, and the
 *  provenance notes which outlets came from the archive stamp. */
export type NewsSnapshot = {
  asOf: string;
  freshHours: number;
  outlets: Record<string, RawItem[]>;
  unreachable: { id: string; why: string }[];
  total: number;
};

export async function fetchEnrichedFeed(
  universe: { ticker: string; name: string }[],
  vols: Map<string, VolumeLookup>,
  snapshot?: NewsSnapshot,
): Promise<EnrichedFeed> {
  const outcomes = await Promise.all(OUTLETS.map((o) => fetchOutlet(o.id)));
  const raw: RawItem[] = [];
  const unreachable: FeedProvenance["unreachable"] = [];
  const archived: string[] = [];
  for (const o of outcomes) {
    if ("items" in o && o.items.length) {
      raw.push(...o.items);
      continue;
    }
    // the live network lost this outlet — fall back to the snapshot
    const snap = snapshot?.outlets?.[o.outlet];
    if (snap?.length) {
      raw.push(...snap);
      archived.push(outletName(o.outlet));
      continue;
    }
    unreachable.push({ id: o.outlet, nameAr: outletName(o.outlet), note: "تعذّر الوصول من هذا الخادم الآن" });
  }
  const feed = enrichFeed(raw, universe, vols);
  feed.provenance.unreachable = unreachable;
  if (archived.length) {
    (feed.provenance as FeedProvenance & { archivedFrom?: { outlets: string[]; asOf: string } }).archivedFrom = {
      outlets: archived,
      asOf: snapshot?.asOf ?? "",
    };
  }
  return feed;
}

/** The shared 5-minute feed cache: the news screen AND the crossings screen
 *  read the SAME enriched document, so the outlets are fetched once and the
 *  two screens always agree about what the news said (the same discipline
 *  the source model applies across its screens). */
const FEED_CACHE_MS = 300_000;
let feedCache: { at: number; feed: Promise<EnrichedFeed> } | null = null;

export function getEnrichedFeedCached(
  universe: () => Promise<{ ticker: string; name: string; volume: number; avgVolume: number | null }[]>,
  snapshot?: NewsSnapshot,
): Promise<EnrichedFeed> {
  if (feedCache && Date.now() - feedCache.at < FEED_CACHE_MS) return feedCache.feed;
  const run = (async () => {
    let u: { ticker: string; name: string }[] = [];
    const vols = new Map<string, VolumeLookup>();
    try {
      const stocks = await universe();
      u = stocks.map((s) => ({ ticker: s.ticker, name: s.name }));
      for (const s of stocks) {
        if (s.volume || s.avgVolume) {
          vols.set(s.ticker, { ticker: s.ticker, volume: s.volume, avgVolume10d: s.avgVolume });
        }
      }
    } catch {
      /* feed still ships, ticker pills + volume context degrade to none */
    }
    return fetchEnrichedFeed(u, vols, snapshot);
  })();
  feedCache = { at: Date.now(), feed: run };
  // a failed run must not poison the cache slot for 5 minutes
  run.catch(() => {
    if (feedCache && feedCache.feed === run) feedCache = null;
  });
  return run;
}
