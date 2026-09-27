/** T60: probe whether the reader service can reach the Cloudflare-blocked
 *  Egyptian outlets esthmr's news pipeline reads (hapijournal, almalnews,
 *  arabfinance) — and what their article lists look like. Read-only research. */
const fs = require("fs");

async function main() {
  const ZAI = (await import("z-ai-web-dev-sdk")).default;
  const zai = await ZAI.create();
  const out = {};
  const pages = {
    hapi_home: "https://hapijournal.com/",
    hapi_feed: "https://hapijournal.com/feed",
    almal_home: "https://almalnews.com/",
    almal_feed: "https://almalnews.com/feed",
    arabfinance_home: "https://www.arabfinance.com/",
    arabfinance_news: "https://www.arabfinance.com/ar/news",
  };
  for (const [k, url] of Object.entries(pages)) {
    try {
      const r = await zai.functions.invoke("page_reader", { url });
      const d = (r && r.data) || r || {};
      const html = typeof d.html === "string" ? d.html : "";
      out[k] = {
        title: d.title,
        url: d.url,
        len: html.length,
        sample: html.slice(0, 600),
      };
    } catch (e) {
      out[k] = { error: String(e).slice(0, 300) };
    }
  }
  fs.writeFileSync("/home/z/my-project/scripts/research/t60-reader-probe.json", JSON.stringify(out, null, 2));
  for (const [k, v] of Object.entries(out)) {
    console.log(k, v.error ? "ERROR " + v.error.slice(0, 80) : `OK ${v.len} chars · ${v.title}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
