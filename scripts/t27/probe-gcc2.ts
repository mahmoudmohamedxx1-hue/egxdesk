const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
async function main() {
  // 1. Try TV scanner with different market slugs
  for (const m of ["saudi", "saudiarabia", "sa", "dubai", "uae", "abudhabi", "adsm", "dse"]) {
    try {
      const res = await fetch(`https://scanner.tradingview.com/${m}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA, Accept: "text/plain" },
        body: JSON.stringify({
          filter: [{ left: "type", operation: "equal", right: "stock" }],
          options: { lang: "en" },
          markets: [m],
          symbols: { query: { types: [] }, tickers: [] },
          columns: ["name", "description", "close", "change", "market_cap_basic"],
          sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
          range: [0, 3],
        }),
        signal: AbortSignal.timeout(8000),
      });
      const txt = await res.text();
      console.log(`${m} → HTTP ${res.status}: ${txt.slice(0, 160).replace(/\n/g, " ")}`);
    } catch (e: any) { console.log(`${m} → FAIL ${e.message}`); }
  }
  // 2. Global scanner with explicit index tickers only (like our EGX30 code path)
  const tickers = ["SASE:TASI", "SASE:TWSE", "DSE:DFMGI", "ADSM:ADI", "ADSM:FTSEADXI", "SASE:MT30"];
  try {
    const res = await fetch("https://scanner.tradingview.com/global/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA, Accept: "text/plain" },
      body: JSON.stringify({
        filter: [{ left: "type", operation: "equal", right: "index" }],
        options: { lang: "en" },
        symbols: { query: { types: [] }, tickers },
        columns: ["name", "description", "close", "change", "change_abs", "Perf.YTD", "Perf.1M", "Perf.Y"],
        sort: { sortBy: "name", sortOrder: "asc" },
        range: [0, 30],
      }),
      signal: AbortSignal.timeout(12000),
    });
    const j = await res.json() as any;
    console.log("\n=== global scan (tickers only) ===");
    for (const r of j.data ?? []) console.log(`${r.s}: ${r.d[1]} close=${r.d[2]} chg=${r.d[3]}% ytd=${r.d[5]}%`);
  } catch (e: any) { console.log("global FAIL " + e.message); }
  // 3. Yahoo variants for DFM/ADX indices
  for (const s of ["^DFMGI", "DFMGI.DU", "^DJSI", "^FTSEADI", "^ADI", "0#.DFMGI", "^ADIADU"]) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=1mo&interval=1d`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
      const j = await r.json() as any;
      const res0 = j?.chart?.result?.[0];
      const n = res0?.timestamp?.length ?? 0;
      console.log(`yahoo ${s} → HTTP ${r.status} bars=${n} ${res0?.meta?.shortName ?? ""}`);
    } catch { console.log(`yahoo ${s} → FAIL`); }
  }
}
main().catch(e => console.error(e.message));
