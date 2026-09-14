const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
async function main() {
  // Yahoo search with full browser headers
  for (const q of ["TAQA Arabia", "Suez Cement Egypt", "Tourah Cement", "Qatar National Bank Egypt", "Global Telecom Holding"]) {
    try {
      const r = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&enableFuzzyQuery=false&quotesQueryId=tss_match_phrase_query`, {
        headers: { "User-Agent": UA, Accept: "application/json,text/plain,*/*", "Accept-Language": "en-US,en;q=0.9", Referer: "https://finance.yahoo.com/" },
        signal: AbortSignal.timeout(10000),
      });
      const j = await r.json() as any;
      const qs = (j?.quotes ?? []) as { symbol?: string; shortname?: string; exchange?: string; quoteType?: string }[];
      console.log(`${q} → HTTP ${r.status}: ${qs.map(x => `${x.symbol}(${x.exchange ?? "?"})`).join(", ") || "EMPTY"}`);
    } catch (e: any) { console.log(`${q} → FAIL ${e.message}`); }
    await new Promise(r2 => setTimeout(r2, 300));
  }
  // Direct symbol guesses for TAQA + Tourah + QNB Egypt
  for (const sym of ["TAQA.CA", "TAQAARABIA.CA", "TORA.CA", "TOURAH.CA", "QNBE.CA", "QNB.CA", "QNBA.CA", "GTHE.CA", "GTCH.CA", "ORWE.CA"]) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=1mo&interval=1d`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
      const j = await r.json() as any;
      const n = j?.chart?.result?.[0]?.timestamp?.length ?? 0;
      console.log(`${sym} → HTTP ${r.status} bars=${n}`);
    } catch (e: any) { console.log(`${sym} → FAIL`); }
  }
}
main().catch(e => console.error(e.message));
