// T40 — scan ALL tickers for broken/discontinued Yahoo history (flat series,
// last-day jumps, stale ends) that makes charts + technicals look fake.
const B = 'http://localhost:3000';
(async () => {
  const comp = await (await fetch(B + '/api/companies')).json();
  const uni = comp.companies || comp.rows || comp;
  const bad = [];
  const results = [];
  for (const c of uni) {
    try {
      const ch = await (await fetch(`${B}/api/chart?symbol=${c.ticker}&range=1Y`)).json();
      const pts = ch.points || [];
      if (pts.length < 10) { bad.push([c.ticker, 'SHORT series: ' + pts.length + ' pts', c.close]); continue; }
      const hist = pts.filter(p => !p.live);
      const lastLive = pts.find(p => p.live);
      // flat history? (all non-live closes within 0.5%)
      const hs = hist.map(p => p.close);
      if (hs.length > 20) {
        const mn = Math.min(...hs), mx = Math.max(...hs);
        if (mx / mn - 1 < 0.005) { bad.push([c.ticker, `FLAT history ${mn.toFixed(2)} (n=${hs.length})`, c.close]); continue; }
      }
      // last-day jump?
      if (lastLive && hist.length) {
        const prev = hist[hist.length - 1].close;
        const jump = lastLive.close / prev - 1;
        if (Math.abs(jump) > 0.25) {
          results.push([c.ticker, `JUMP ${(jump * 100).toFixed(0)}% ${prev.toFixed(2)}→${lastLive.close.toFixed(2)} (scanner close ${c.close})`]);
          if (Math.abs(jump) > 0.35) bad.push([c.ticker, `JUMP ${(jump * 100).toFixed(0)}% ${prev.toFixed(2)}→${lastLive.close.toFixed(2)}`, c.close]);
        }
      }
      // history ends way before today? (splice missing => no live point)
      const lastDate = pts[pts.length - 1].date;
      if (!lastLive && lastDate < '2026-09-10') bad.push([c.ticker, 'STALE end ' + lastDate, c.close]);
    } catch (e) {
      bad.push([c.ticker, 'CHART FAIL: ' + e.message, c.close]);
    }
  }
  console.log('=== BROKEN (' + bad.length + '/296) ===');
  bad.forEach(([t, m, cl]) => console.log(`${t}: ${m} | scanner close ${cl}`));
  console.log('\n=== moderate jumps (25-35%, watch) ===');
  results.filter(r => !bad.some(b => b[0] === r[0])).forEach(r => console.log(r.join(' ')));
})();
