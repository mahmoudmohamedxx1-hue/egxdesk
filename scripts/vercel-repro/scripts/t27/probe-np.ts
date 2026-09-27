// Probe: which EGX tickers relate to "National Printing" and does Yahoo have history for them?
async function main() {
  // 1. TradingView universe — find printing stocks
  const res = await fetch("https://scanner.tradingview.com/egypt/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0", Accept: "text/plain" },
    body: JSON.stringify({
      filter: [{ left: "type", operation: "equal", right: "stock" }, { left: "subtype", operation: "in_range", right: ["common"] }],
      options: { lang: "en" },
      markets: ["egypt"],
      symbols: { query: { types: [] }, tickers: [] },
      columns: ["name", "description", "close", "volume", "market_cap_basic"],
      sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
      range: [0, 500],
    }),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json() as { data?: { s: string; d: unknown[] }[] };
  const rows = (json.data ?? []).map((r) => ({ t: r.s, name: String(r.d[1] ?? ""), close: r.d[2], vol: r.d[3] }));
  const printing = rows.filter((r) => /print|طباع/i.test(r.name) || r.t.includes("NP"));
  console.log("Printing-related in TV universe:", JSON.stringify(printing, null, 1));

  // 2. For each, try Yahoo .CA history
  for (const p of printing) {
    const t = p.t.split(":")[1];
    try {
      const yres = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t + ".CA")}?range=1mo&interval=1d`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(10000),
      });
      const yjson = await yres.json() as any;
      const err = yjson?.chart?.error;
      const count = yjson?.chart?.result?.[0]?.timestamp?.length ?? 0;
      console.log(`${t}.CA → HTTP ${yres.status}, bars=${count}, err=${err ? JSON.stringify(err) : "none"}`);
    } catch (e: any) {
      console.log(`${t}.CA → FETCH FAIL ${e.message}`);
    }
  }

  // 3. Also test known thin tickers that might be broken — sample 15 lowest-volume names
  const thin = rows.filter(r => Number(r.vol) === 0).slice(0, 15);
  console.log("\nZero-volume names:", thin.map(t => t.t.split(":")[1]).join(", "));
}
main().catch(e => console.error(e.message));
