/** T60 — news snapshot refresh (المستجدات → الأخبار baseline).
 *
 *  Fetches the five Egyptian financial outlets DIRECTLY (no SDK) and writes
 *  src/data/news-snapshot.json — the baseline the deployed /api/news-feed
 *  merges for any outlet the runtime network cannot reach (Cloudflare walls
 *  datacenter IPs; the runtime may lose hapi/almal/arabfinance while the
 *  GitHub runner passes, or vice versa — the union of the two is the feed).
 *
 *  Modes:
 *    node scripts/refresh-news.mjs              → direct fetches only (the
 *                                                  GitHub Action path)
 *    node scripts/refresh-news.mjs --via-reader → in the sandbox only: fall
 *                                                  back to the reader service
 *                                                  for Cloudflare-blocked
 *                                                  outlets (never on Vercel)
 *
 *  Fails SAFE: on error the shipped snapshot stays untouched. */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "src/data/news-snapshot.json");
const FRESH_HOURS = 96; // keep items up to 4 days old in the snapshot

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const viaReader = process.argv.includes("--via-reader");

async function getText(url, accept) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "ar,en;q=0.9" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

/** one reader request at a time, 350ms apart — the gateway 429s bursts. */
let READER_QUEUE = Promise.resolve();

async function readerGetHtml(url) {
  if (!viaReader) return null;
  const job = READER_QUEUE.then(async () => {
    await new Promise((res) => setTimeout(res, 350));
    return doRead(url);
  });
  READER_QUEUE = job.catch(() => undefined);
  return job;
}

async function doRead(url, retried = false) {
  try {
    const mod = await import("z-ai-web-dev-sdk");
    const zai = await mod.default.create();
    const r = await zai.functions.invoke("page_reader", { url });
    const d = (r && (r.data || r)) || {};
    return typeof d.html === "string" ? d.html : null;
  } catch (e) {
    if (!retried && /429|many requests/i.test(String(e))) {
      await new Promise((res) => setTimeout(res, 2500));
      return doRead(url, true);
    }
    return null;
  }
}

// — RSS (alborsa / hapi / enterprise / amwal) —

function parseRss(xml, outlet) {
  const out = [];
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
      null;
    const snippet =
      block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ??
      null;
    if (!title || !link || !/^https?:\/\//.test(link)) continue;
    const t = date ? Date.parse(date) : Date.now();
    if (!Number.isFinite(t)) continue;
    out.push({ outlet, title, link, published: new Date(t).toISOString(), image, snippet });
  }
  return out;
}

// — the reader's RSS rendering (h3 > a + time blocks) —

function parseReaderRss(html, outlet) {
  const out = [];
  const blocks =
    html.match(/<div>\s*<h3><a href="(https?:\/\/[^"]+)">([\s\S]*?)<\/a><\/h3>[\s\S]*?<time>([\s\S]*?)<\/time>/g) ?? [];
  for (const b of blocks.slice(0, 60)) {
    const link = b.match(/<a href="(https?:\/\/[^"]+)">/)[1];
    const title = b.match(/<a href="[^"]+">([\s\S]*?)<\/a>/)[1].trim();
    const t = Date.parse(b.match(/<time>([\s\S]*?)<\/time>/)?.[1]?.trim() ?? "");
    if (!title || !link) continue;
    out.push({ outlet, title, link, published: Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString(), image: null, snippet: null });
  }
  return out;
}

// — Arab Finance HTML list —

function parseArabFinance(html, outlet) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]*href="(\/ar\/news\/newdetails\/[^"]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    if (seen.has(href)) continue;
    seen.add(href);
    const after = html.slice(m.index, m.index + 700);
    const title =
      after.match(/title="([^"]{12,180})"/)?.[1]?.trim() ??
      after.match(/<h[234][^>]*>\s*<a[^>]*>([\s\S]{12,180}?)<\/a>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ??
      null;
    if (!title) continue;
    const rel = after.match(/منذ\s*(\d+)س\s*(\d+)د/);
    let published = new Date().toISOString();
    if (rel) {
      published = new Date(Date.now() - (Number(rel[1]) * 60 + Number(rel[2])) * 60000).toISOString();
    } else {
      const abs = after.match(/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
      if (abs) {
        const now = new Date();
        const d = new Date(now.getFullYear(), Number(abs[2]) - 1, Number(abs[1]), Number(abs[3]), Number(abs[4]));
        if (d.getTime() > now.getTime() + 86400000) d.setFullYear(d.getFullYear() - 1);
        published = d.toISOString();
      }
    }
    const img = after.match(/src="(\/Gallery\/[^"]+)"/)?.[1];
    out.push({ outlet, title, link: `https://www.arabfinance.com${decodeURIComponent(href)}`, published, image: img ? `https://www.arabfinance.com${img}` : null, snippet: null });
    if (out.length >= 50) break;
  }
  return out;
}

// — Al Mal category pages (with Arabic long-date stamps + excerpts) —

const ALMAL_CATEGORIES = ["الاقتصاد", "أسواق-المال", "شركات", "الاقتصاد-السياسي"];

const AR_MONTHS = {
  "يناير": 1, "فبراير": 2, "مارس": 3, "أبريل": 4, "مايو": 5, "يونيو": 6,
  "يوليو": 7, "أغسطس": 8, "سبتمبر": 9, "أكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12,
};

function parseAlmalDate(s) {
  const m = s.match(/(\d{1,2})\s+([\u0600-\u06FF]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*([صم])/);
  if (!m) return null;
  const month = AR_MONTHS[m[2]];
  if (!month) return null;
  let hour = Number(m[4]) % 12;
  if (m[6] === "م") hour += 12;
  const d = new Date(Date.UTC(Number(m[3]), month - 1, Number(m[1]), hour - 3, Number(m[5])));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseAlmalCategory(html, outlet) {
  const out = [];
  const cards =
    html.match(/<a[^>]*href="\/(\d{5,})\/([^"]+)"[^>]*title="([^"]{12,180})"[\s\S]{0,900}?<span class="news-time">([\s\S]*?)<\/span>/g) ?? [];
  for (const card of cards) {
    const id = card.match(/href="\/(\d{5,})\//)?.[1];
    const slug = card.match(/href="\/\d{5,}\/([^"]+)"/)?.[1];
    const title = card.match(/title="([^"]{12,180})"/)?.[1]?.trim();
    const timeText = card.match(/<span class="news-time">([\s\S]*?)<\/span>/)?.[1]?.trim() ?? "";
    const excerpt = card.match(/<p class="card-excerpt">([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? null;
    const img = card.match(/<img[^>]*src="(https:\/\/media\.almalnews\.com[^"]+)"/)?.[1];
    if (!id || !slug || !title) continue;
    out.push({ outlet, title, link: `https://almalnews.com/${id}/${slug}`, published: parseAlmalDate(timeText) ?? new Date().toISOString(), image: img ?? null, snippet: excerpt });
    if (out.length >= 30) break;
  }
  return out;
}

async function fetchOutlet(id) {
  const note = (why) => ({ outlet: id, items: [], why });
  try {
    switch (id) {
      case "alborsa":
        return { outlet: id, items: parseRss(await getText("https://www.alborsaanews.com/feed", "application/rss+xml"), id) };
      case "hapi": {
        try {
          return { outlet: id, items: parseRss(await getText("https://hapijournal.com/feed", "application/rss+xml"), id) };
        } catch (e) {
          const html = await readerGetHtml("https://hapijournal.com/feed");
          if (!html) return note("direct failed; reader unavailable");
          return { outlet: id, items: parseReaderRss(html, id) };
        }
      }
      case "enterprise":
        return { outlet: id, items: parseRss(await getText("https://enterpriseam.com/rss", "application/rss+xml"), id) };
      case "amwal":
        return { outlet: id, items: parseRss(await getText("https://www.amwalalghad.com/feed", "application/rss+xml"), id) };
      case "arabfinance": {
        try {
          return { outlet: id, items: parseArabFinance(await getText("https://www.arabfinance.com/ar/news/newscategory", "text/html"), id) };
        } catch {
          const html = await readerGetHtml("https://www.arabfinance.com/ar/news/newscategory");
          if (!html) return note("direct failed; reader unavailable");
          return { outlet: id, items: parseArabFinance(html, id) };
        }
      }
      case "almal": {
        const cats = ALMAL_CATEGORIES.map((c) => `https://almalnews.com/category/${encodeURIComponent(c)}/`);
        let htmls = [];
        try {
          htmls = await Promise.all(cats.map((u) => getText(u, "text/html")));
        } catch {
          const pages = await Promise.all(cats.map((u) => readerGetHtml(u)));
          htmls = pages.filter(Boolean);
        }
        const items = htmls.flatMap((h) => parseAlmalCategory(h, id));
        if (!items.length) return note("categories unreachable");
        return { outlet: id, items };
      }
      default:
        return note("unknown outlet");
    }
  } catch (e) {
    return note(String(e).slice(0, 90));
  }
}

async function main() {
  const ids = ["alborsa", "hapi", "arabfinance", "almal", "enterprise", "amwal"];
  const outcomes = await Promise.all(ids.map(fetchOutlet));
  const cutoff = Date.now() - FRESH_HOURS * 3600_000;
  const outlets = {};
  const unreachable = [];
  let total = 0;
  for (const o of outcomes) {
    const fresh = o.items.filter((x) => Date.parse(x.published) >= cutoff);
    if (fresh.length) {
      outlets[o.outlet] = fresh;
      total += fresh.length;
    } else {
      unreachable.push({ id: o.outlet, why: o.why ?? "no fresh items" });
    }
  }
  const body = { asOf: new Date().toISOString(), freshHours: FRESH_HOURS, outlets, unreachable, total };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(body));
  console.log(
    `news snapshot: ${total} items across ${Object.keys(outlets).length} outlets` +
      (unreachable.length ? ` · unreachable: ${unreachable.map((u) => u.id).join(",")}` : ""),
  );
}

main().catch((e) => {
  console.error("news snapshot FAILED (shipped snapshot untouched):", String(e).slice(0, 200));
  process.exit(1);
});
