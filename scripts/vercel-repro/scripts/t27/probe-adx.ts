const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
async function main() {
  // TV symbol search for ADX index
  for (const q of ["Abu Dhabi index", "FTSE ADX", "ADI index"]) {
    try {
      const r = await fetch(`https://symbol-search.tradingview.com/symbol_search/v3/?text=${encodeURIComponent(q)}&hl=1&exchange=&lang=en&type=&domain=production`, {
        headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.tradingview.com/", Origin: "https://www.tradingview.com" },
        signal: AbortSignal.timeout(10000),
      });
      const j = await r.json() as any;
      const symbols = (j?.symbols ?? []).slice(0, 8).map((s: any) => `${s.symbol}:${s.exchange} "${s.full_name ?? s.description}"`);
      console.log(`search "${q}" → ${symbols.join(" | ")}`);
    } catch (e: any) { console.log(`search "${q}" FAIL ${e.message}`); }
  }
  // Try direct global scan with candidate ADX index tickers
  const cands = ["ADX:ADI", "ADX:FTSEADXI", "ADX:FTSEADX", "ADX:FADI", "ADX:ADXI", "ADSM:ADI"];
  const r = await fetch("https://scanner.tradingview.com/global/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, Accept: "text/plain" },
    body: JSON.stringify({ filter: [{ left: "type", operation: "equal", right: "index" }], options: { lang: "en" }, markets: ["uae"], symbols: { query: { types: [] }, tickers: cands }, columns: ["name", "description", "close", "change", "Perf.YTD"], sort: { sortBy: "name", sortOrder: "asc" }, range: [0, 30] }),
    signal: AbortSignal.timeout(12000),
  });
  const j = await r.json() as any;
  console.log(`\nADX candidates count=${j?.totalCount}`);
  for (const row of j.data ?? []) console.log(`${row.s}: ${row.d[1]} close=${row.d[2]} chg=${Number(row.d[3]).toFixed(2)}%`);
}
main().catch(e => console.error(e.message));
