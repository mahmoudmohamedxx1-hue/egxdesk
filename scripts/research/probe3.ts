/** Probe 2nd round: real Sigma URL, Yahoo index symbols, WP archive depth. */
import * as fs from "fs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function j(url: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json, text/html, */*" },
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, text: await res.text() };
}

function chartSummary(text: string) {
  try {
    const j = JSON.parse(text);
    const r = j?.chart?.result?.[0];
    if (!r) return { ok: false, why: j?.chart?.error?.description ?? "no result" };
    const ts: number[] = r.timestamp ?? [];
    const q = r.indicators?.quote?.[0] ?? {};
    const closes: (number | null)[] = q.close ?? [];
    return {
      ok: true,
      name: r.meta?.symbol,
      first: ts.length ? new Date(ts[0] * 1000).toISOString().slice(0, 10) : null,
      last: ts.length ? new Date(ts[ts.length - 1] * 1000).toISOString().slice(0, 10) : null,
      points: ts.length,
      nonNullCloses: closes.filter((c) => typeof c === "number").length,
      lastClose: [...closes].reverse().find((c) => typeof c === "number") ?? null,
    };
  } catch (e) {
    return { ok: false, why: String(e).slice(0, 100) };
  }
}

async function main() {
  const out: Record<string, unknown> = {};

  // 1) Yahoo EGX index symbols (from search + guesses)
  const symbols = [
    "%5ECASE30", "%5EEGX30CAPPED.CA", "%5EEGX70EWI.CA", "%5EEGX100EWI.CA",
    "%5EEGX30EWI.CA", "%5EEGX50EWI.CA", "%5EEGX30.CA", "%5ESHARIAH.CA",
    "EGS69491M015.CA",
  ];
  out.yahooIdx = {};
  for (const s of symbols) {
    try {
      const { status, text } = await j(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?range=1y&interval=1d`);
      out.yahooIdx[s] = { status, ...chartSummary(text) };
    } catch (e) {
      out.yahooIdx[s] = { error: String(e).slice(0, 100) };
    }
  }

  // 2) Real Sigma URL from flows.ts
  out.sigma = {};
  try {
    const { status, text } = await j("https://www.sigma-cap.com/main/x_market_page.overview?u_sess=");
    out.sigma = {
      status,
      len: text.length,
      hasBuyAnchor: /Buy\s*\(M\)/i.test(text),
      hasBlockTrades: /block trades/i.test(text),
      hasEquitiesScope: /equities only/i.test(text),
      dates: (text.match(/(\d{4}-\d{2}-\d{2})/g) ?? []).slice(0, 8),
      euDates: (text.match(/\d{2}[/-]\d{2}[/-]\d{4}/g) ?? []).slice(0, 8),
    };
  } catch (e) {
    out.sigma = { error: String(e).slice(0, 150) };
  }

  // 3) EGXBot market report still fine?
  try {
    const { status, text } = await j("https://egxbot.com/en/market-report");
    out.egxbot = { status, len: text.length, hasParticipation: /مصريون|Egyptians/i.test(text) };
  } catch (e) {
    out.egxbot = { error: String(e).slice(0, 150) };
  }

  // 4) WP archive depth — page 1 and a deep page (page 20) with per_page=100
  out.wpDepth = {};
  for (const [name, base, cat] of [
    ["borsa", "https://www.alborsaanews.com", "10"],
    ["amwal", "https://www.amwalalghad.com", "82015"],
  ] as const) {
    try {
      const p1 = await j(`${base}/wp-json/wp/v2/posts?per_page=100&page=1&categories=${cat}&_fields=id,date,link,title`);
      const p1json = JSON.parse(p1.text);
      const p10 = await j(`${base}/wp-json/wp/v2/posts?per_page=100&page=10&categories=${cat}&_fields=id,date,link,title`);
      let deep: unknown;
      try {
        const p10json = JSON.parse(p10.text);
        deep = { status: p10.status, n: Array.isArray(p10json) ? p10json.length : null, oldest: Array.isArray(p10json) ? p10json[p10json.length - 1]?.date : null };
      } catch {
        deep = { status: p10.status, body: p10.text.slice(0, 150) };
      }
      out.wpDepth[name] = {
        page1: { status: p1.status, n: Array.isArray(p1json) ? p1json.length : null, newest: p1json?.[0]?.date, oldest: p1json?.[p1json.length - 1]?.date },
        page10: deep,
      };
    } catch (e) {
      out.wpDepth[name] = { error: String(e).slice(0, 150) };
    }
  }

  // 5) excerpt/content fields availability
  try {
    const p = await j("https://www.alborsaanews.com/wp-json/wp/v2/posts?per_page=2&_fields=id,date,link,title,excerpt,categories");
    const pj = JSON.parse(p.text);
    out.wpFields = {
      status: p.status,
      sample: pj.map((x: { date: string; title: { rendered: string }; excerpt?: { rendered: string }; categories?: number[] }) => ({
        date: x.date,
        title: x.title?.rendered?.slice(0, 60),
        hasExcerpt: !!x.excerpt?.rendered,
        excerpt: (x.excerpt?.rendered ?? "").replace(/<[^>]+>/g, " ").slice(0, 100),
        catIds: x.categories,
      })),
    };
  } catch (e) {
    out.wpFields = { error: String(e).slice(0, 150) };
  }

  fs.writeFileSync("/home/z/my-project/scripts/research/probe3.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error("probe failed", e); process.exit(1); });
