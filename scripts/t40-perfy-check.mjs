// T40 — perfY consistency: scanner perfY vs chart-series 1Y return
const B = 'http://localhost:3000';
(async () => {
  const comp = await (await fetch(B + '/api/companies')).json();
  const uni = comp.companies || comp.rows || comp;
  const tickers = ['COMI', 'HRHO', 'ABUK', 'TMGH', 'Eastern', 'SWDY', 'ORAS', 'EMFD', 'ISPH', 'EFID'];
  // pick 10 with decent liquidity
  const picks = uni.filter(c => c.volume > 1e6).slice(20, 32).map(c => c.ticker);
  const list = [...new Set([...tickers.filter(t => uni.some(c => c.ticker === t)), ...picks.slice(0, 6)])];
  console.log('ticker | scanner perfY | series 1Y | diff');
  let big = 0;
  for (const t of list) {
    const row = uni.find(c => c.ticker === t);
    const ch = await (await fetch(`${B}/api/chart?symbol=${t}&range=1Y`)).json();
    const pts = ch.points || ch.candles || ch.rows || [];
    if (!pts.length || !row) continue;
    const fp = pts[0].close, lp = pts[pts.length - 1].close;
    const seriesRet = (lp / fp - 1) * 100;
    const diff = row.perfY - seriesRet;
    const flag = Math.abs(diff) > 3 ? ' <-- BIG' : '';
    if (Math.abs(diff) > 3) big++;
    console.log(`${t} | ${row.perfY.toFixed(2)}% | ${seriesRet.toFixed(2)}% (${fp.toFixed(2)}→${lp.toFixed(2)}) | ${diff.toFixed(2)}${flag}`);
  }
  console.log(`\n${big}/${list.length} differ by >3pp`);
})();
