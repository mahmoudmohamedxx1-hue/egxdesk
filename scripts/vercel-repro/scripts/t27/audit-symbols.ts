// Audit: for every EGX universe ticker, does Yahoo .CA have >=2 bars? For failures, try Yahoo search for aliases.
async function main() {
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
  const rows = (json.data ?? []).map((r) => ({ t: String(r.s).split(":")[1], name: String(r.d[1] ?? ""), vol: Number(r.d[3] ?? 0), cap: r.d[4] }));
  console.log(`Universe size: ${rows.length}`);

  const bad: { t: string; name: string }[] = [];
  const CONC = 8;
  for (let i = 0; i < rows.length; i += CONC) {
    const batch = rows.slice(i, i + CONC);
    await Promise.all(batch.map(async (r) => {
      try {
        const yres = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(r.t + ".CA")}?range=1mo&interval=1d`, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(10000),
        });
        const yjson = await yres.json() as any;
        const count = yjson?.chart?.result?.[0]?.timestamp?.length ?? 0;
        if (count < 2) bad.push({ t: r.t, name: r.name });
      } catch {
        bad.push({ t: r.t, name: r.name });
      }
    }));
  }
  console.log(`Broken (<2 bars): ${bad.length}`);
  console.log(JSON.stringify(bad, null, 1));

  // For each broken, try Yahoo search to find the correct .CA symbol
  console.log("\n=== Yahoo search alias hunt ===");
  for (const b of bad) {
    try {
      const sres = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(b.name + " egypt")}&quotesCount=6&newsCount=0`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(10000),
      });
      const sjson = await sres.json() as any;
      const quotes = (sjson?.quotes ?? []) as { symbol?: string; shortname?: string; exchange?: string; quoteType?: string }[];
      const egx = quotes.filter((q) => q.symbol?.endsWith(".CA") || q.exchange === "CAI");
      console.log(`${b.t} "${b.name}" → ${egx.length ? egx.map(q => `${q.symbol} (${q.shortname ?? "?"})`).join(" | ") : "NO .CA MATCH — all: " + quotes.map(q => q.symbol + ":" + (q.exchange ?? "?")).join(",")}`);
    } catch (e: any) {
      console.log(`${b.t} "${b.name}" → SEARCH FAIL ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }
}
main().catch(e => console.error(e.message));
