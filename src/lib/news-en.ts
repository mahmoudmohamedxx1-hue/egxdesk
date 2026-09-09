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

const QUERY = "EGX Egyptian stock market";
const FEED_URL = `https://news.google.com/rss/search?q=${encodeURIComponent(
  QUERY
)}&hl=en-US&gl=US&ceid=US:en`;

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

function parseFeed(xml: string): NewsItemEn[] {
  const items: NewsItemEn[] = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const b of blocks.slice(0, 60)) {
    const title = decodeXml(/<title>([\s\S]*?)<\/title>/.exec(b)?.[1] ?? "");
    const link = decodeXml(/<link>([\s\S]*?)<\/link>/.exec(b)?.[1] ?? "");
    const pub = decodeXml(/<pubDate>([\s\S]*?)<\/pubDate>/.exec(b)?.[1] ?? "");
    const source = decodeXml(/<source[^>]*>([\s\S]*?)<\/source>/.exec(b)?.[1] ?? "");
    if (!title || !link) continue;
    const iso = pub ? new Date(pub).toISOString() : null;
    if (!iso || Number.isNaN(Date.parse(iso))) continue;
    items.push({ title, link, publishedAt: iso, source: source || "Google News" });
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
    try {
      const res = await fetch(FEED_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          Accept: "application/rss+xml, application/xml, text/xml",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`news-en ${res.status}`);
      const xml = await res.text();
      const items = parseFeed(xml);
      if (!items.length) throw new Error("news-en empty");
      const data: NewsEnData = {
        items,
        total: items.length,
        query: QUERY,
        fetchedAt: new Date().toISOString(),
      };
      cache[0] = { data, at: Date.now() };
      staleData = data;
      return data;
    } finally {
      // cleanup handled by caller
    }
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
