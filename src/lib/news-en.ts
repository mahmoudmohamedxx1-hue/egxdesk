/** Server-side English news layer (G11) — Egyptian-market coverage from
 *  English-language publishers, aggregated by Google News' public RSS feed
 *  (no key, no auth). This exists so the English interface serves a real
 *  English reading experience instead of an empty news view; the Arabic
 *  archive (9k+ items) stays the depth layer in Arabic mode.
 *
 *  Items are attributed to their original publisher; links go to the
 *  publisher's article. 10-minute cache, in-flight dedup, stale fallback. */

export type NewsItemEn = {
  title: string;
  link: string;
  publishedAt: string; // ISO
  source: string; // publisher name from the feed
};

export type NewsEnData = {
  items: NewsItemEn[];
  total: number;
  query: string;
  fetchedAt: string;
};

// Task 23 fix — a single narrow query ("EGX Egyptian stock market") let the
// English feed go days without a matching article while the Arabic archive
// updated hourly. Multiple complementary queries are fetched in parallel and
// merged (dedup by link AND by normalized title) so the EN view stays as
// fresh as the publishers' coverage of Egypt's market.
const QUERIES = [
  "EGX Egyptian stock market",
  "EGX30 index",
  "Egypt stock exchange",
  "Egyptian stocks market",
  "Egypt capital market EGX",
];
const FEED_URL_FOR = (q: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

const TTL = 10 * 60_000;
type Entry = { data: NewsEnData; at: number };
const cache: Entry[] = [];
let inflight: Promise<NewsEnData> | null = null;
let staleData: NewsEnData | null = null;

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

/* T40 — the English feed is aggregated from Google News' en-US edition, but
 * Arabic-language publishers sometimes appear in it with an English article
 * title and an ARABIC source name (آراب فاينانس = Arab Finance). Showing an
 * Arabic-script publisher inside the English reading experience looked like
 * broken data, so known brands are mapped to their official English name and
 * anything unmapped falls back to the article's hostname (still the real
 * publisher, just in Latin script). The publisher's identity is never
 * invented or dropped. */
const SOURCE_BRANDS_EN: Record<string, string> = {
  "آراب فاينانس": "Arab Finance",
  "أراب فاينانس": "Arab Finance",
};

function latinizeSource(source: string, link: string): string {
  if (!/[\u0600-\u06FF]/.test(source)) return source;
  const brand = SOURCE_BRANDS_EN[source.trim()];
  if (brand) return brand;
  try {
    const host = new URL(link).hostname.replace(/^www\./, "");
    if (host && !/[\u0600-\u06FF]/.test(host)) return host;
  } catch {
    /* Google News redirect links always parse; keep the real name otherwise */
  }
  return source;
}

function parseFeed(xml: string): NewsItemEn[] {
  const items: NewsItemEn[] = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const b of blocks.slice(0, 60)) {
    const rawTitle = decodeXml(/<title>([\s\S]*?)<\/title>/.exec(b)?.[1] ?? "");
    const link = decodeXml(/<link>([\s\S]*?)<\/link>/.exec(b)?.[1] ?? "");
    const pub = decodeXml(/<pubDate>([\s\S]*?)<\/pubDate>/.exec(b)?.[1] ?? "");
    const source = decodeXml(/<source[^>]*>([\s\S]*?)<\/source>/.exec(b)?.[1] ?? "");
    if (!rawTitle || !link) continue;
    const iso = pub ? new Date(pub).toISOString() : null;
    if (!iso || Number.isNaN(Date.parse(iso))) continue;
    // T40 — Google News appends " - Publisher" to every title; when that
    // trailing segment is the publisher itself (in any script — e.g. an
    // Arabic "… - آراب فاينانس"), drop it: the source chip already shows
    // the latinized publisher, and an Arabic suffix inside an English
    // headline reads as broken mixed-script data.
    const title = rawTitle.replace(/\s+-\s+[^-]{2,40}$|‏?\s+[-–—]\s+[\u0600-\u06FF][^-]{1,40}$/, (m) => {
      const tail = m.replace(/^\s+[-–—]\s+/, "").trim();
      const srcLatin = latinizeSource(source, link);
      return tail === source || tail === srcLatin || /[\u0600-\u06FF]/.test(tail) ? "" : m;
    }).trim();
    items.push({ title: title || rawTitle, link, publishedAt: iso, source: latinizeSource(source || "Google News", link) });
  }
  // feeds can interleave slightly out of order — enforce newest-first
  items.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0));
  return items;
}

export async function fetchNewsEn(): Promise<NewsEnData> {
  const hit = cache[0];
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  if (inflight) return inflight;
  const p = (async (): Promise<NewsEnData> => {
    // parallel per-query fetches; each may fail without sinking the merge
    const perQuery = await Promise.allSettled(
      QUERIES.map(async (q) => {
        const res = await fetch(FEED_URL_FOR(q), {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
            Accept: "application/rss+xml, application/xml, text/xml",
          },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`news-en ${res.status}`);
        return parseFeed(await res.text());
      })
    );
    const merged = new Map<string, NewsItemEn>();
    const normTitle = (t: string) =>
      t
        .toLowerCase()
        .replace(/\s+-\s+[^-]+$/, "") // strip trailing " - Publisher" suffixes
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    for (const r of perQuery) {
      if (r.status !== "fulfilled") continue;
      for (const it of r.value) {
        if (merged.has(it.link)) continue; // same article via two queries
        const key = `t:${normTitle(it.title)}`;
        if ([...merged.values()].some((x) => normTitle(x.title) === normTitle(it.title) && key.length > 8)) {
          continue; // same story syndicated under a different link
        }
        merged.set(it.link, it);
      }
    }
    const items = [...merged.values()]
      .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0))
      .slice(0, 90);
    if (!items.length) throw new Error("news-en empty");
    const data: NewsEnData = {
      items,
      total: items.length,
      query: QUERIES.join(" · "),
      fetchedAt: new Date().toISOString(),
    };
    cache[0] = { data, at: Date.now() };
    staleData = data;
    return data;
  })();
  inflight = p;
  try {
    return await p;
  } catch {
    if (staleData) return staleData;
    throw new Error("english news unavailable");
  } finally {
    inflight = null;
  }
}
