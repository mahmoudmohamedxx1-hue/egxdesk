// Probe GCC market data: TradingView scanners for saudi/dubai/abudhabi + Yahoo index symbols
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
async function scan(market: string) {
  try {
    const res = await fetch(`https://scanner.tradingview.com/${market}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA, Accept: "text/plain" },
      body: JSON.stringify({
        filter: [{ left: "type", operation: "equal", right: "stock" }, { left: "subtype", operation: "in_range", right: ["common", "adr"] }],
        options: { lang: "en" },
        markets: [market],
        symbols: { query: { types: [] }, tickers: [] },
        columns: ["name", "description", "close", "change", "volume", "market_cap_basic", "Perf.YTD", "Perf.1M", "sector"],
        sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
        range: [0, 8],
      }),
      signal: AbortSignal.timeout(12000),
    });
    const j = await res.json() as any;
    return (j.data ?? []).map((r: any) => `${r.s}: ${r.d[1]} close=${r.d[2]} chg=${r.d[3]}% cap=${r.d[5]}`);
  } catch (e: any) { return ["FAIL " + e.message]; }
}
async function yahooIdx(sym: string) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=6mo&interval=1d`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
    const j = await r.json() as any;
    const res0 = j?.chart?.result?.[0];
    const n = res0?.timestamp?.length ?? 0;
    const meta = res0?.meta;
    return `HTTP ${r.status} bars=${n} last=${meta?.regularMarketPrice} prevClose=${meta?.chartPreviousClose} name=${meta?.shortName ?? meta?.symbol}`;
  } catch (e: any) { return "FAIL " + e.message; }
}
async function main() {
  // TV indices via global scanner
  const idxRes = await fetch("https://scanner.tradingview.com/global/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, Accept: "text/plain" },
    body: JSON.stringify({
      filter: [{ left: "type", operation: "equal", right: "index" }],
      options: { lang: "en" },
      markets: ["saudi", "dubai", "abudhabi"],
      symbols: { query: { types: [] }, tickers: ["SASE:TASI", "SASE:TWSE", "DSE:DFMGI", "ADSM:ADI", "ADSM:FTSEMIB50", "SASE:MT30"] },
      columns: ["name", "description", "close", "change", "change_abs", "Perf.YTD", "Perf.1M", "Perf.Y"],
      sort: { sortBy: "name", sortOrder: "asc" },
      range: [0, 20],
    }),
    signal: AbortSignal.timeout(12000),
  });
  const j = await idxRes.json() as any;
  console.log("=== TV global scanner GCC indices ===");
  for (const r of j.data ?? []) console.log(`${r.s}: ${r.d[1]} close=${r.d[2]} chg=${r.d[3]}% ytd=${r.d[5]}%`);
  for (const m of ["saudi", "dubai", "abudhabi"]) {
    console.log(`\n=== TV ${m} top caps ===`);
    for (const row of await scan(m)) console.log(row);
  }
  console.log("\n=== Yahoo indices ===");
  for (const s of ["^TASI.SR", "^DFMGI", "^ADI", "2222.SR", "1120.SR"]) console.log(`${s} → ${await yahooIdx(s)}`);
}
main().catch(e => console.error(e.message));
