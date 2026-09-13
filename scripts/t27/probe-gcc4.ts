const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
async function main() {
  // find DFM prefix in uae scan + confirm top movers work with full column set
  const res = await fetch("https://scanner.tradingview.com/uae/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, Accept: "text/plain" },
    body: JSON.stringify({ filter: [{ left: "type", operation: "equal", right: "stock" }], options: { lang: "en" }, markets: ["uae"], symbols: { query: { types: [] }, tickers: [] }, columns: ["name", "description", "close", "change", "volume", "market_cap_basic"], sort: { sortBy: "value_traded", sortOrder: "desc" }, range: [0, 12] }),
    signal: AbortSignal.timeout(12000),
  });
  const j = await res.json() as any;
  console.log("=== UAE top value traded ===");
  for (const r of j.data ?? []) console.log(`${r.s}: ${r.d[1]} close=${r.d[2]} chg=${Number(r.d[3]).toFixed(2)}% vol=${r.d[4]}`);
  // indices via ksa+uae markets
  for (const [mkts, tks] of [
    [["ksa"], ["TADAWUL:TASI", "TADAWUL:MT30", "TADAWUL:TWSE"]],
    [["uae"], ["DFM:DFMGI", "ADX:ADI", "ADX:FTSEADXI"]],
    [["ksa", "uae"], ["TADAWUL:TASI", "DFM:DFMGI", "ADX:ADI"]],
  ] as [string[], string[]][]) {
    try {
      const r = await fetch("https://scanner.tradingview.com/global/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA, Accept: "text/plain" },
        body: JSON.stringify({ filter: [{ left: "type", operation: "equal", right: "index" }], options: { lang: "en" }, markets: mkts, symbols: { query: { types: [] }, tickers: tks }, columns: ["name", "description", "close", "change", "change_abs", "Perf.YTD", "Perf.1M", "Perf.Y"], sort: { sortBy: "name", sortOrder: "asc" }, range: [0, 30] }),
        signal: AbortSignal.timeout(12000),
      });
      const jj = await r.json() as any;
      console.log(`\n=== indices markets=${mkts} count=${jj?.totalCount} ===`);
      for (const row of jj.data ?? []) console.log(`${row.s}: ${row.d[1]} close=${row.d[2]} chg=${Number(row.d[3]).toFixed(2)}% ytd=${row.d[5]}`);
    } catch (e: any) { console.log(`indices ${mkts} FAIL ${e.message}`); }
  }
}
main().catch(e => console.error(e.message));
