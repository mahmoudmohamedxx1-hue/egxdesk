const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
async function main() {
  for (const m of ["saudi_arabia", "tadawul", "tasi", "saudistockmarket", "ksa", "arabian", "saudi-english", "saudiarabia_stocks"]) {
    try {
      const res = await fetch(`https://scanner.tradingview.com/${m}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA, Accept: "text/plain" },
        body: JSON.stringify({ filter: [{ left: "type", operation: "equal", right: "stock" }], options: { lang: "en" }, markets: [m], symbols: { query: { types: [] }, tickers: [] }, columns: ["name", "description", "close", "change", "market_cap_basic"], sort: { sortBy: "market_cap_basic", sortOrder: "desc" }, range: [0, 3] }),
        signal: AbortSignal.timeout(8000),
      });
      const txt = await res.text();
      console.log(`${m} → HTTP ${res.status}: ${txt.slice(0, 120).replace(/\n/g, " ")}`);
    } catch (e: any) { console.log(`${m} → FAIL ${e.message}`); }
  }
  console.log("\n=== global scan retry ===");
  try {
    const res = await fetch("https://scanner.tradingview.com/global/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA, Accept: "text/plain" },
      body: JSON.stringify({
        filter: [{ left: "type", operation: "equal", right: "index" }],
        options: { lang: "en" },
        symbols: { query: { types: [] }, tickers: ["SASE:TASI", "SASE:TWSE", "DSE:DFMGI", "ADX:ADI", "SASE:MT30"] },
        columns: ["name", "description", "close", "change", "change_abs", "Perf.YTD", "Perf.1M", "Perf.Y"],
        sort: { sortBy: "name", sortOrder: "asc" },
        range: [0, 30],
      }),
      signal: AbortSignal.timeout(12000),
    });
    console.log(`HTTP ${res.status}`);
    const txt = await res.text();
    console.log(txt.slice(0, 800));
  } catch (e: any) { console.log("global FAIL " + e.message); }
}
main().catch(e => console.error(e.message));
