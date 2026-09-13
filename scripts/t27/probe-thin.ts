// Deep probe: long-range Yahoo for thin names + TradingView history endpoint test
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
async function yahooBars(sym: string, range: string) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return `HTTP ${r.status}`;
    const j = await r.json() as any;
    const res0 = j?.chart?.result?.[0];
    const n = res0?.timestamp?.length ?? 0;
    const first = n ? new Date(res0.timestamp[0] * 1000).toISOString().slice(0, 10) : "—";
    const last = n ? new Date(res0.timestamp[n - 1] * 1000).toISOString().slice(0, 10) : "—";
    return `${n} bars [${first} → ${last}]`;
  } catch (e: any) { return "FAIL " + e.message; }
}

async function main() {
  const tests = ["SUCE.CA", "TORA.CA", "TAQA.CA", "EGS370O1C013.CA", "ALEX.CA", "ENPI.CA", "SMPP.CA", "QNBE.CA", "NCGC.CA", "UTOP.CA"];
  for (const t of tests) {
    const y1 = await yahooBars(t, "1mo");
    const y2y = await yahooBars(t, "2y");
    const yMax = await yahooBars(t, "max");
    console.log(`${t.padEnd(20)} 1mo: ${y1} | 2y: ${y2y} | max: ${yMax}`);
  }

  // TradingView history endpoint (used by their widgets, worth a try)
  console.log("\n=== TradingView history probe ===");
  const to = Math.floor(Date.now() / 1000);
  const from = to - 400 * 86400;
  for (const sym of ["EGX:EGS370O1C013", "EGX:TAQA", "EGX:SMPP"]) {
    try {
      const r = await fetch(`https://api.tradingview.com/history?symbol=${encodeURIComponent(sym)}&resolution=1D&from=${from}&to=${to}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
      const txt = await r.text();
      console.log(`${sym} → HTTP ${r.status}: ${txt.slice(0, 200)}`);
    } catch (e: any) { console.log(`${sym} → FAIL ${e.message}`); }
  }
}
main().catch(e => console.error(e.message));
