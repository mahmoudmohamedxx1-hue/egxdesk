const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
async function main() {
  for (const q of ["Abu Dhabi Securities Exchange index", "FTSE ADX", "ADSM index"]) {
    try {
      const r = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`, {
        headers: { "User-Agent": UA, Accept: "application/json,text/plain,*/*", "Accept-Language": "en-US,en;q=0.9", Referer: "https://finance.yahoo.com/" },
        signal: AbortSignal.timeout(10000),
      });
      const j = await r.json() as any;
      const qs = (j?.quotes ?? []).map((x: any) => `${x.symbol}(${x.exchange ?? "?"}) "${x.shortname ?? ""}"`).join(" | ");
      console.log(`"${q}" → ${qs || "EMPTY"}`);
    } catch (e: any) { console.log(`"${q}" FAIL ${e.message}`); }
  }
}
main().catch(e => console.error(e.message));
