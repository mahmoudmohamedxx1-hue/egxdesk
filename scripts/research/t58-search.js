/** T58-R1 research: web_search + page_reader for esthmr عدسة الملكية and foudalens.com catalog.
 *  Writes JSON results next to this script. Read-only research; no project code touched.
 */
const fs = require("fs");

async function main() {
  const ZAI = (await import("z-ai-web-dev-sdk")).default;
  const zai = await ZAI.create();
  const out = {};

  const searches = {
    adasa_esthmr: '«عدسة الملكية» esthmr',
    esthmr_adasa: '"esthmr" "عدسة الملكية"',
    esthmr_ownership_lens: 'esthmr.com "ownership lens"',
    esthmr_site: 'esthmr.com البورصة المصرية موقع',
    esthmr_twitter: 'esthmr.com twitter OR facebook OR x.com عدسة',
    foudalens: 'foudalens.com',
    foudalens_features: 'foudalens Egypt stock market features',
  };
  out.searches = {};
  for (const [k, query] of Object.entries(searches)) {
    try {
      const r = await zai.functions.invoke("web_search", { query, num: 8 });
      out.searches[k] = (r && (r.data || r.results || r)) || null;
    } catch (e) {
      out.searches[k] = { error: String(e).slice(0, 300) };
    }
  }

  const pages = {
    esthmr_home: "https://esthmr.com",
    foudalens_home: "https://foudalens.com",
    foudalens_llms: "https://foudalens.com/llms.txt",
  };
  out.pages = {};
  for (const [k, url] of Object.entries(pages)) {
    try {
      const r = await zai.functions.invoke("page_reader", { url });
      const d = (r && r.data) || r || {};
      out.pages[k] = {
        title: d.title, url: d.url, publishedTime: d.publishedTime,
        html: typeof d.html === "string" ? d.html.slice(0, 12000) : null,
      };
    } catch (e) {
      out.pages[k] = { error: String(e).slice(0, 300) };
    }
  }

  fs.writeFileSync("/home/z/my-project/scripts/research/t58-search.json", JSON.stringify(out, null, 2));
  const summary = {
    searchKeys: Object.fromEntries(Object.entries(out.searches).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v])),
    pageTitles: Object.fromEntries(Object.entries(out.pages).map(([k, v]) => [k, v.title || v.error])),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error("t58-search failed", e); process.exit(1); });
