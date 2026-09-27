const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
async function main() {
  // tickers-only global scan (no markets field) with correct prefixes
  const r = await fetch("https://scanner.tradingview.com/global/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, Accept: "text/plain" },
    body: JSON.stringify({ filter: [{ left: "type", operation: "equal", right: "index" }], options: { lang: "en" }, symbols: { query: { types: [] }, tickers: ["TADAWUL:TASI", "TADAWUL:MT30", "DFM:DFMGI", "ADX:ADI", "ADX:FTSEADXI"] }, columns: ["name", "description", "close", "change", "Perf.YTD", "Perf.Y"], sort: { sortBy: "name", sortOrder: "asc" }, range: [0, 30] }),
    signal: AbortSignal.timeout(12000),
  });
  const j = await r.json() as any;
  console.log(`tickers-only count=${j?.totalCount}`);
  for (const row of j.data ?? []) console.log(`${row.s}: ${row.d[1]} close=${row.d[2]} chg=${Number(row.d[3]).toFixed(2)}% ytd=${Number(row.d[4]).toFixed(1)}% 1y=${Number(row.d[5]).toFixed(1)}%`);
}
main().catch(e => console.error(e.message));
