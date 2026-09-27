const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
async function main() {
  for (const s of ["DFMGI.AE", "FADGI.FGI", "^DFMGI", "ADI.AE"]) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=1y&interval=1d`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
      const j = await r.json() as any;
      const res0 = j?.chart?.result?.[0];
      const n = res0?.timestamp?.length ?? 0;
      const first = n ? new Date(res0.timestamp[0] * 1000).toISOString().slice(0, 10) : "—";
      console.log(`${s} → HTTP ${r.status} bars=${n} [${first}→] last=${res0?.meta?.regularMarketPrice}`);
    } catch { console.log(`${s} → FAIL`); }
  }
  // UAE market top by value traded (with sector for the view)
  const r = await fetch("https://scanner.tradingview.com/uae/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, Accept: "text/plain" },
    body: JSON.stringify({ filter: [{ left: "type", operation: "equal", right: "stock" }], options: { lang: "en" }, markets: ["uae"], symbols: { query: { types: [] }, tickers: [] }, columns: ["name", "description", "close", "change", "volume", "value_traded", "market_cap_basic"], sort: { sortBy: "value_traded", sortOrder: "desc" }, range: [0, 6] }),
    signal: AbortSignal.timeout(12000),
  });
  const j = await r.json() as any;
  console.log("UAE top value:", (j.data ?? []).map((x: any) => `${x.s} vt=${x.d[5]}`).join(", "));
}
main().catch(e => console.error(e.message));
