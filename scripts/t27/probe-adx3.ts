const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
async function main() {
  // list ALL indices in the uae market (no tickers filter)
  const r = await fetch("https://scanner.tradingview.com/uae/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, Accept: "text/plain" },
    body: JSON.stringify({ filter: [{ left: "type", operation: "equal", right: "index" }], options: { lang: "en" }, markets: ["uae"], symbols: { query: { types: [] }, tickers: [] }, columns: ["name", "description", "close", "change", "Perf.YTD"], sort: { sortBy: "name", sortOrder: "asc" }, range: [0, 40] }),
    signal: AbortSignal.timeout(12000),
  });
  const j = await r.json() as any;
  console.log(`uae market indices count=${j?.totalCount}`);
  for (const row of j.data ?? []) console.log(`${row.s}: ${row.d[1]} close=${row.d[2]} chg=${Number(row.d[3]).toFixed(2)}%`);
}
main().catch(e => console.error(e.message));
