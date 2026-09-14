/** Server-side news archive — REAL posts from the two Egyptian business
 *  newspapers already powering the live feed:
 *    - Alborsaanews  (جريدة البورصة)
 *    - Amwal Alghad  (أموال الغد)
 *  Their WordPress REST APIs are public (no auth): they serve the full post
 *  history (title, date, link, excerpt, category ids) newest-first, so we
 *  backfill ~1,000 real articles once, persist them in SQLite, and afterwards
 *  only keep the archive fresh:
 *    - every /api/news call upserts the live RSS items (minute-level freshness)
 *    - page 1 of the REST API is re-synced periodically (process-level guard)
 *  The news view then pages through the whole archive, newest → oldest.
 */

import { db } from "./db";
import type { NewsItem } from "./market";

// ─────────────────────────────────────────────────────────── types ───

type Site = { base: string; source: string };

const SITES: Site[] = [
  { base: "https://www.alborsaanews.com", source: "جريدة البورصة" },
  { base: "https://www.amwalalghad.com", source: "أموال الغد" },
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

type WpPost = {
  id: number;
  date: string; // site-local (Cairo) ISO without offset
  link: string;
  title?: { rendered?: string };
  excerpt?: { rendered?: string };
  categories?: number[];
};

// ───────────────────────────────────────────────────────── helpers ───

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–", lsquo: "'", rsquo: "'",
  ldquo: "\u201c", rdquo: "\u201d", laquo: "«", raquo: "»",
  deg: "°", euro: "€", pound: "£", rlm: "", lrm: "",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

function clean(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** WordPress publishes Cairo-local dates ("2026-09-06T20:06:23"). */
function wpDate(s: string): Date | null {
  const d = new Date(`${s}+03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// per-process category id → name maps (sites rarely change categories)
const catMaps = new Map<string, Map<number, string>>();

async function categoryMap(site: Site): Promise<Map<number, string>> {
  const hit = catMaps.get(site.base);
  if (hit) return hit;
  const map = new Map<number, string>();
  try {
    const res = await fetch(`${site.base}/wp-json/wp/v2/categories?per_page=100&_fields=id,name`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const cats = (await res.json()) as { id: number; name: string }[];
      for (const c of cats) map.set(c.id, clean(c.name));
    }
  } catch {
    // names optional — posts still stored, just without category chips
  }
  catMaps.set(site.base, map);
  return map;
}

async function fetchWpPage(site: Site, page: number, attempt = 0): Promise<WpPost[]> {
  try {
    const res = await fetch(
      `${site.base}/wp-json/wp/v2/posts?per_page=100&page=${page}&_fields=id,date,link,title,excerpt,categories`,
      {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      }
    );
    if (!res.ok) {
      if (res.status === 400 || res.status === 404) return []; // past the last page
      throw new Error(`wp ${site.base} p${page} ${res.status}`);
    }
    return (await res.json()) as WpPost[];
  } catch (err) {
    if (attempt < 2) {
      // sites occasionally throttle — back off and retry the same page
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      return fetchWpPage(site, page, attempt + 1);
    }
    throw err;
  }
}

async function storePosts(site: Site, posts: WpPost[]): Promise<number> {
  if (!posts.length) return 0;
  const cats = await categoryMap(site);
  const rows = posts
    .map((p) => {
      const title = clean(p.title?.rendered ?? "");
      const date = wpDate(p.date);
      if (!title || !p.link || !date) return null;
      const snippetFull = clean(p.excerpt?.rendered ?? "");
      const names = (p.categories ?? [])
        .map((id) => cats.get(id))
        .filter((x): x is string => !!x)
        .slice(0, 2);
      return {
        link: p.link,
        title,
        snippet: snippetFull ? snippetFull.slice(0, 260) : null,
        source: site.source,
        categories: names.join("،"),
        publishedAt: date,
      };
    })
    .filter((r): r is NonNullable<typeof r> => !!r);
  if (!rows.length) return 0;
  return insertNewPosts(rows);
}

/** SQLite does not support Prisma's skipDuplicates, so we dedupe in memory
 *  against the existing links before bulk-inserting. */
async function insertNewPosts(rows: { link: string; title: string; snippet: string | null; source: string; categories: string; publishedAt: Date }[]): Promise<number> {
  if (!rows.length) return 0;
  const existing = new Set(
    (await db.newsPost.findMany({ where: { link: { in: rows.map((r) => r.link) } }, select: { link: true } })).map((r) => r.link)
  );
  const fresh = rows.filter((r) => !existing.has(r.link));
  if (!fresh.length) return 0;
  await db.newsPost.createMany({ data: fresh });
  return fresh.length;
}

// ─────────────────────────────────────────────── backfill & sync ───

let archiveEnsured = false;

/** Deep backfill: keep fetching pages until the archive reaches ~90 days
 *  back (or a 30-page cap ≈ 3,000 posts per publisher); afterwards only the
 *  newest page is refreshed on later process starts. Each site is isolated —
 *  one slow publisher never blocks the other — and a failed site simply
 *  retries on the next process start (its row count stays low). */
const NEWS_BACKFILL_DAYS = 90;
const NEWS_MAX_PAGES = 45;
const NEWS_INCREMENTAL_THRESHOLD = 4000;

export async function ensureNewsArchive(): Promise<void> {
  if (archiveEnsured) return;
  archiveEnsured = true;
  const cutoff = new Date(Date.now() - NEWS_BACKFILL_DAYS * 86_400_000);
  await Promise.all(
    SITES.map(async (site) => {
      try {
        const mine = await db.newsPost.count({ where: { source: site.source } });
        if (mine > NEWS_INCREMENTAL_THRESHOLD) {
          const posts = await fetchWpPage(site, 1);
          if (posts.length) await storePosts(site, posts);
          return;
        }
        // resume where the previous backfill left off (≈ mine/100 pages in)
        const startPage = Math.max(1, Math.ceil(mine / 100));
        for (let page = startPage; page <= NEWS_MAX_PAGES; page++) {
          const posts = await fetchWpPage(site, page);
          if (!posts.length) break;
          const stored = await storePosts(site, posts);
          const oldestDate = wpDate(posts[posts.length - 1]?.date ?? "");
          if (oldestDate && oldestDate < cutoff) break; // reached the coverage target
          if (page > startPage + 2 && stored === 0) break; // deep in already-known territory
          await new Promise((r) => setTimeout(r, 400)); // be gentle with the publisher
        }
      } catch (err) {
        console.error(`news-archive: ${site.source} backfill failed`, err);
      }
    })
  );
}

/** Upsert live RSS items so the archive's newest edge stays minute-fresh. */
export async function syncLiveNews(items: NewsItem[]): Promise<void> {
  if (!items.length) return;
  try {
    const rows = items.map((i) => ({
      link: i.link,
      title: i.title,
      snippet: i.snippet,
      source: i.source,
      categories: i.categories.join("،"),
      publishedAt: new Date(i.publishedAt),
    }));
    await insertNewPosts(rows);
  } catch (err) {
    console.error("news-archive: live sync failed", err);
  }
}

// ───────────────────────────────────────────────────────── queries ───

export type ArchivedNews = {
  id: string;
  title: string;
  link: string;
  publishedAt: string; // ISO
  snippet: string | null;
  source: string;
  categories: string[];
};

function toRow(r: { id: string; title: string; link: string; publishedAt: Date; snippet: string | null; source: string; categories: string }) {
  return {
    id: r.id,
    title: r.title,
    link: r.link,
    publishedAt: r.publishedAt.toISOString(),
    snippet: r.snippet,
    source: r.source,
    categories: r.categories ? r.categories.split("،").filter(Boolean) : [],
  };
}

/** Newest-first page of the whole archive. */
export async function queryNews(page: number, limit: number): Promise<{ total: number; items: ArchivedNews[] }> {
  const [total, rows] = await Promise.all([
    db.newsPost.count(),
    db.newsPost.findMany({
      orderBy: { publishedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return { total, items: rows.map(toRow) };
}

/** Egyptian publishers write company names in Arabic — map the most
 *  talked-about EGX tickers to their common Arabic names/brands so
 *  related-news matching works across languages. Factual public names.
 *  (Exported for the T32 news-signal scorer, which reuses the same map.) */
export const AR_ALIASES: Record<string, string[]> = {
  COMI: ["التجاري الدولي", "CIB"],
  TMGH: ["طلعت مصطفى"],
  HRHO: ["إي إف جي", "هيرميس", "EFG"],
  ETEL: ["المصرية للاتصالات"],
  EAST: ["الشرق للدخان"],
  ABUK: ["أبو قير", "أبوقير"],
  QALA: ["قلعة"],
  SWDY: ["السويدي"],
  ORWE: ["أورينتال ويفرز", "النسيج الشرقي"],
  ORAS: ["أوراسكوم للإنشاء"],
  ORHD: ["أوراسكوم للتطوير العقاري"],
  MFPC: ["مصر لإنتاج الأسمدة", "مصر للأسمدة"],
  ESRS: ["حديد عز", "عز للدخان"],
  ADIB: ["أبو ظبي الإسلامي"],
  FWRY: ["فوري"],
  AMOC: ["الإسكندرية للزيوت", "إسكندرية للزيوت"],
  EFID: ["إيديتا"],
  GBCO: ["GB"],
  DOMY: ["دومتي"],
  EMAAR: ["إعمار"],
  PHDC: ["بالم هيلز", "بالم هيلز للتعمير"],
};

/** Related news for a company: ticker / English name words / Arabic brand
 *  aliases matched against the recent archive, newest first. */
export async function relatedNewsArchive(ticker: string, name: string, limit = 6): Promise<ArchivedNews[]> {
  const t = ticker.toUpperCase();
  const tickerRe = new RegExp(`\\b${t.replace(/[^A-Z0-9]/g, "")}\\b`, "i");
  const words = name
    .split(/[^A-Za-z]+/)
    .filter((w) => w.length > 3 && !["Egypt", "Egyptian", "Company", "S.A.E", "Holding", "Limited", "Corporation"].includes(w))
    .slice(0, 2)
    .map((w) => new RegExp(`\\b${w}\\b`, "i"));
  const aliases = (AR_ALIASES[t] ?? []).map((a) => new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  if (!tickerRe.source && words.length === 0 && aliases.length === 0) return [];
  // scan the full archive (9k rows — regex matching stays in the low milliseconds)
  const recent = await db.newsPost.findMany({ orderBy: { publishedAt: "desc" } });
  const hit = (s: string) =>
    tickerRe.test(s) ||
    aliases.some((re) => re.test(s)) ||
    (words.length > 0 && words.every((re) => re.test(s)));
  return recent
    .filter((r) => hit(`${r.title} ${r.snippet ?? ""}`))
    .slice(0, limit)
    .map(toRow);
}

/** Oldest archived article date (for the coverage note), ISO or null. */
export async function archiveOldest(): Promise<string | null> {
  const r = await db.newsPost.findFirst({ orderBy: { publishedAt: "asc" }, select: { publishedAt: true } });
  return r ? r.publishedAt.toISOString() : null;
}

/** Disclosure log for one company: archived articles that mention the
 *  company (aliases) AND disclosure-type keywords (filings, dividends,
 *  AGMs, results). Real press coverage — not the official EGX archive. */
export async function companyDisclosures(ticker: string, name: string, limit = 12): Promise<ArchivedNews[]> {
  const t = ticker.toUpperCase();
  const tickerRe = new RegExp(`\\b${t.replace(/[^A-Z0-9]/g, "")}\\b`, "i");
  const words = name
    .split(/[^A-Za-z]+/)
    .filter((w) => w.length > 3 && !["Egypt", "Egyptian", "Company", "S.A.E", "Holding", "Limited", "Corporation"].includes(w))
    .slice(0, 2)
    .map((w) => new RegExp(`\\b${w}\\b`, "i"));
  const aliases = (AR_ALIASES[t] ?? []).map((a) => new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  if (!tickerRe.source && words.length === 0 && aliases.length === 0) return [];
  const recent = await db.newsPost.findMany({ orderBy: { publishedAt: "desc" } });
  const companyHit = (s: string) =>
    tickerRe.test(s) ||
    aliases.some((re) => re.test(s)) ||
    (words.length > 0 && words.every((re) => re.test(s)));
  const kw = /إفصاح|إفصاحات|العمومية|عمومية|توزيعات|كوبون|القوائم المالية|قوائم مالية|نتائج|أرباح|نصف سنوي|ربع سنوي|زيادة رأس المال|اكتتاب|إدراج|شطب|تغيرات جوهرية|مجلس الإدارة|صفقة|استحواذ|توقيع|عقد/i;
  return recent
    .filter((r) => companyHit(`${r.title} ${r.snippet ?? ""}`) && kw.test(`${r.title} ${r.snippet ?? ""}`))
    .slice(0, limit)
    .map(toRow);
}

/** Market-wide disclosure press log (Task 23): newest archived articles
 *  matching disclosure-type keywords — filings, dividends, AGMs, insider /
 *  treasury coverage. Serves the insiders section's "fresh since the
 *  snapshot" strip so the view keeps updating daily even while the official
 *  EGX filings harvest (which needs authenticated re-harvesting) is between
 *  snapshots. Real press coverage — labeled as such, never mixed into the
 *  official filing rows. */
export async function disclosureNews(limit = 12): Promise<ArchivedNews[]> {
  const kw =
    /إفصاح|إفصاحات|العمومية|عمومية|توزيعات|كوبون|القوائم المالية|قوائم مالية|نتائج أعمال|أرباح|نصف سنوية|ربع سنوية|زيادة رأس المال|اكتتاب|إدراج|شطب|تغيرات جوهرية|أسهم الخزينة|صفقات|استحواذ|مجلس الإدارة|insider|disclosure|dividend|AGM|earnings/i;
  const recent = await db.newsPost.findMany({ orderBy: { publishedAt: "desc" }, take: 600 });
  return recent
    .filter((r) => kw.test(`${r.title} ${r.snippet ?? ""}`))
    .slice(0, limit)
    .map(toRow);
}
