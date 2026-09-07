/** Probe candidate public sources for:
 *  1) EGX per-stock / per-index price history (for real price charts)
 *  2) News archive access (WordPress REST API) for full newest->oldest news
 *  3) Sanity check that the flows source (Sigma Capital) is still reachable
 */
import * as fs from "fs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function j(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  return { status: res.status, text };
}

function chartSummary(text: string) {
  try {
    const j = JSON.parse(text);
    const r = j?.chart?.result?.[0];
    if (!r) return { ok: false, why: "no result", meta: j?.chart?.error };
    const ts: number[] = r.timestamp ?? [];
    const q = r.indicators?.quote?.[0] ?? {};
    const closes: (number | null)[] = q.close ?? [];
    const first = ts.length ? new Date(ts[0] * 1000).toISOString().slice(0, 10) : null;
    const last = ts.length ? new Date(ts[ts.length - 1] * 1000).toISOString().slice(0, 10) : null;
    const nonNull = closes.filter((c) => typeof c === "number").length;
    return {
      ok: true,
      symbol: r.meta?.symbol,
      currency: r.meta?.currency,
      first,
      last,
      points: ts.length,
      nonNullCloses: nonNull,
      sampleClose: closes[closes.length - 1],
      timezone: r.meta?.exchangeTimezoneName,
      gmtoffset: r.meta?.gmtoffset,
    };
  } catch (e) {
    return { ok: false, why: String(e).slice(0, 120) };
  }
}

async function main() {
  const out: Record<string, unknown> = {};

  // 1) Yahoo chart API — EGX stocks (.CA suffix)
  const tickers = ["COMI.CA", "HRHO.CA", "TMGH.CA", "SWDY.CA", "ETEL.CA", "ABUK.CA", "ISPH.CA", "MFPC.CA", "ORWE.CA", "EKHO.CA"];
  out.yahooStocks = {};
  for (const t of tickers) {
    try {
      const { status, text } = await j(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=1y&interval=1d`);
      out.yahooStocks[t] = { status, ...chartSummary(text.slice(0, 2_000_000)) };
    } catch (e) {
      out.yahooStocks[t] = { error: String(e).slice(0, 120) };
    }
  }

  // 2) Yahoo index candidates
  const idxCandidates = ["%5EEGX30", "EGX30", "%5EEGX70", "%5EEGX100", "EGX100.CA"];
  out.yahooIndices = {};
  for (const s of idxCandidates) {
    try {
      const { status, text } = await j(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?range=1y&interval=1d`);
      out.yahooIndices[s] = { status, ...chartSummary(text.slice(0, 2_000_000)) };
    } catch (e) {
      out.yahooIndices[s] = { error: String(e).slice(0, 120) };
    }
  }

  // 2b) Yahoo search to discover the right EGX index symbol
  try {
    const { status, text } = await j("https://query1.finance.yahoo.com/v1/finance/search?q=EGX&quotesCount=20&newsCount=0");
    const j2 = JSON.parse(text);
    out.yahooSearchEGX = {
      status,
      quotes: (j2.quotes ?? []).slice(0, 20).map((q: { symbol?: string; shortname?: string; exchange?: string; type?: string }) => ({
        symbol: q.symbol, name: q.shortname, exch: q.exchange, type: q.type,
      })),
    };
  } catch (e) {
    out.yahooSearchEGX = { error: String(e).slice(0, 120) };
  }

  // 3) WordPress REST API for news archives
  out.wpJson = {};
  const sites = ["https://www.alborsaanews.com", "https://www.amwalalghad.com"];
  for (const site of sites) {
    try {
      const { status, text } = await j(`${site}/wp-json/wp/v2/posts?per_page=5&_fields=id,date,link,title,excerpt,modified`);
      let info: unknown;
      try {
        const posts = JSON.parse(text);
        info = {
          status,
          count: Array.isArray(posts) ? posts.length : null,
          sample: Array.isArray(posts)
            ? posts.slice(0, 3).map((p: { date?: string; link?: string; title?: { rendered?: string } }) => ({
                date: p.date, link: p.link, title: (p.title?.rendered ?? "").slice(0, 80),
              }))
            : String(text).slice(0, 200),
        };
      } catch {
        info = { status, parseError: String(text).slice(0, 200) };
      }
      (out.wpJson as Record<string, unknown>)[site] = info;
    } catch (e) {
      (out.wpJson as Record<string, unknown>)[site] = { error: String(e).slice(0, 120) };
    }
    // total count via headers (X-WP-Total) — need per_page=1 trick
    try {
      const { status, text } = await j(`${site}/wp-json/wp/v2/posts?per_page=1&_fields=id`);
      out.wpJson[site + "_head"] = status;
    } catch {}
  }

  // 3b) try wp-json categories to find an EGX/bourse category id on amwalalghad
  try {
    const { status, text } = await j("https://www.amwalalghad.com/wp-json/wp/v2/categories?per_page=50&_fields=id,name,count");
    out.amwalCats = { status, cats: JSON.parse(text).map((c: { id: number; name: string; count: number }) => c).slice(0, 30) };
  } catch (e) {
    out.amwalCats = { error: String(e).slice(0, 120) };
  }
  try {
    const { status, text } = await j("https://www.alborsaanews.com/wp-json/wp/v2/categories?per_page=50&_fields=id,name,count");
    out.borsaCats = { status, cats: JSON.parse(text).map((c: { id: number; name: string; count: number }) => c).slice(0, 30) };
  } catch (e) {
    out.borsaCats = { error: String(e).slice(0, 120) };
  }

  // 4) Sigma Capital flows page still reachable?
  try {
    const { status, text } = await j("https://www.sigmaborsa.com/");
    out.sigma = { status, hasFlowTable: /investors|Investors|مستثمر|مستثمرين/.test(text.slice(0, 60_000)), len: text.length };
  } catch (e) {
    out.sigma = { error: String(e).slice(0, 120) };
  }

  fs.writeFileSync("/home/z/my-project/scripts/research/probe2.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ yahooStocks: out.yahooStocks, yahooIndices: out.yahooIndices, yahooSearchEGX: out.yahooSearchEGX, wpKeys: Object.keys(out.wpJson ?? {}), sigma: out.sigma }, null, 2));
}

main().catch((e) => {
  console.error("probe failed", e);
  process.exit(1);
});
