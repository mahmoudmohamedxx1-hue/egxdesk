const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
async function main() {
  for (const q of ["DFM General Index", "Dubai Financial Market index"]) {
    const r = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`, { headers: { "User-Agent": UA, Accept: "application/json,text/plain,*/*", "Accept-Language": "en-US,en;q=0.9", Referer: "https://finance.yahoo.com/" }, signal: AbortSignal.timeout(10000) });
    const j = await r.json() as any;
    console.log(`"${q}" → ${(j?.quotes ?? []).map((x: any) => `${x.symbol}(${x.exchange ?? "?"}) "${x.shortname ?? ""}"`).join(" | ") || "EMPTY"}`);
  }
  for (const s of ["FADGI.FGI", "^TASI.SR", "2222.SR", "1180.SR"]) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=6mo&interval=1d`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
      const j = await r.json() as any;
      const res0 = j?.chart?.result?.[0];
      console.log(`${s} → HTTP ${r.status} bars=${res0?.timestamp?.length ?? 0} last=${res0?.meta?.regularMarketPrice} cur=${res0?.meta?.currency} name="${res0?.meta?.shortName ?? ""}"`);
    } catch { console.log(`${s} → FAIL`); }
  }
}
main().catch(e => console.error(e.message));
