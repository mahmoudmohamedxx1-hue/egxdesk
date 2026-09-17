// T40 — Third-pass audit: freshness + EN-mode + cross-endpoint consistency (new angles)
const B = 'http://localhost:3000';
const today = '2026-09-17';
const lastSession = '2026-09-16';
let fails = [], warns = [], passes = 0;
const ok = (m) => { passes++; };
const fail = (m) => { fails.push(m); };
const warn = (m) => { warns.push(m); };

async function j(p) { const r = await fetch(B + p); return { code: r.status, body: await r.json().catch(() => null) }; }

(async () => {
  // ===== 1. FRESHNESS SWEEP =====
  const ov = await j('/api/overview');
  if (ov.body.session.lastSession !== lastSession) fail(`overview lastSession ${ov.body.session.lastSession} != ${lastSession}`);
  else ok();

  // news freshness — newest item should be within ~48h
  const news = await j('/api/news?limit=20');
  if (news.body.items && news.body.items[0]) {
    const age = (Date.now() - new Date(news.body.items[0].publishedAt).getTime()) / 36e5;
    if (age > 48) fail(`AR news stale: newest ${age.toFixed(1)}h old`);
    else ok();
  }

  const newsEn = await j('/api/news-en?limit=20');
  if (newsEn.body.items && newsEn.body.items[0]) {
    const age = (Date.now() - new Date(newsEn.body.items[0].publishedAt).getTime()) / 36e5;
    if (age > 48) fail(`EN news stale: newest ${age.toFixed(1)}h old`);
    else ok();
    // EN news should be in ENGLISH
    const t = newsEn.body.items.map(i => i.title).join(' ');
    if (/[\u0600-\u06FF]/.test(t)) fail('EN news contains Arabic titles!');
    else ok();
  } else fail('news-en returned no items');

  // signals asOf
  const sig = await j('/api/signals');
  const sigDate = sig.body.asOf || (sig.body.latest && sig.body.latest.asOf) || (sig.body.set && sig.body.set.asOf);
  if (!sigDate) warn(`signals has no asOf (keys: ${Object.keys(sig.body).slice(0,8).join(',')})`);
  else if (sigDate < '2026-09-15') fail(`signals asOf ${sigDate} is stale`);
  else ok();

  // reports freshness
  const rep = await j('/api/reports');
  const rows = rep.body.rows || rep.body.reports || [];
  if (rows.length) {
    const newest = rows[0].createdAt || rows[0].asOf || rows[0].date;
    if (newest && String(newest).slice(0, 10) < '2026-09-15') fail(`newest report ${newest} is stale`);
    else ok();
  }

  // ===== 2. EN NARRATIVE (new angle — T39 fixed AR, is EN clean?) =====
  const comp = await j('/api/companies');
  const uni = comp.body.companies || comp.body.rows || comp.body;
  console.log('universe size:', Array.isArray(uni) ? uni.length : typeof uni);

  // ===== 3. CROSS-CHECKS: valueTraded == volume x close (top 5 by volume) =====
  if (Array.isArray(uni) && uni.length) {
    const top = [...uni].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 5);
    for (const c of top) {
      if (c.volume && c.close && c.valueTraded) {
        const calc = c.volume * c.close;
        const diff = Math.abs(calc - c.valueTraded) / c.valueTraded;
        if (diff > 0.02) warn(`${c.ticker}: valueTraded mismatch ${(diff * 100).toFixed(1)}% (calc ${calc.toFixed(0)} vs ${c.valueTraded.toFixed(0)}) — could be avg-price basis`);
        else ok();
      }
    }
    // every company must have non-null name + nameAr + close + sector
    let bad = uni.filter(c => !c.name || !c.nameAr || !c.close || (!c.sectorEn && !c.sectorAr));
    if (bad.length) fail(`${bad.length} companies missing name/nameAr/close/sector: ${bad.slice(0, 5).map(c => c.ticker).join(',')}`);
    else ok();
    // changePct math: changeAbs / (close - changeAbs)
    let badMath = uni.filter(c => c.changePct != null && c.changeAbs != null && c.close && Math.abs((c.changeAbs / (c.close - c.changeAbs)) - c.changePct) > 0.05 && (c.close - c.changeAbs) !== 0);
    if (badMath.length) fail(`changePct math wrong for ${badMath.length}: ${badMath.slice(0, 3).map(c => c.ticker + ' pct=' + c.changePct.toFixed(3) + ' calc=' + (c.changeAbs / (c.close - c.changeAbs)).toFixed(3)).join(' | ')}`);
    else ok();
    // 52w band: low <= close <= high
    let badBand = uni.filter(c => c.low52 && c.high52 && (c.close < c.low52 * 0.98 || c.close > c.high52 * 1.02));
    if (badBand.length) fail(`close outside 52w band for ${badBand.length}: ${badBand.slice(0, 3).map(c => c.ticker + ' close=' + c.close + ' band=' + c.low52 + '-' + c.high52).join(' | ')}`);
    else ok();
    // EN names: no ISIN junk, no nominal-value junk
    let badName = uni.filter(c => /EGS[0-9A-Z]{8,}|Egp\d|Npv|& Egp/i.test(c.name || ''));
    if (badName.length) fail(`junk EN names: ${badName.slice(0, 5).map(c => c.ticker + '=' + c.name).join(' | ')}`);
    else ok();
  }

  // ===== 4. GCC endpoint honesty =====
  const gcc = await j('/api/gcc');
  for (const idx of (gcc.body.indices || [])) {
    if (idx.points != null && idx.points < 2 && idx.changePct === 0 && !idx.note) warn(`GCC ${idx.code}: 1-point series with changePct 0`);
  }

  // ===== 5. Calendar: upcoming events should exist or empty state be honest =====
  const cal = await j('/api/calendar');
  const evts = cal.body.events || cal.body.days || [];
  console.log('calendar events:', Array.isArray(evts) ? evts.length : typeof evts, cal.body.asOf || '');

  // ===== 6. rates / economy / funds asOf =====
  for (const [p, name] of [['/api/rates', 'rates'], ['/api/economy', 'economy'], ['/api/funds', 'funds'], ['/api/investors', 'investors'], ['/api/insiders', 'insiders']]) {
    const r = await j(p);
    if (r.code !== 200) fail(`${name} HTTP ${r.code}`);
    else ok();
    const asOf = r.body.asOf || r.body.as_of || (r.body.latest && (r.body.latest.asOf || r.body.latest.date));
    if (asOf) {
      const s = String(asOf).slice(0, 10);
      if (s < '2026-09-10') fail(`${name} asOf ${s} stale (>7d)`);
      else ok();
    }
  }

  // ===== 7. Search: EN + AR parity =====
  const sEn = await j('/api/search?q=comi');
  const sAr = await j('/api/search?q=' + encodeURIComponent('كومي'));
  if (!sEn.body.results || !sEn.body.results.some(r => r.ticker === 'COMI')) fail('EN search "comi" missing COMI');
  else ok();
  if (!sAr.body.results || !sAr.body.results.some(r => r.ticker === 'COMI')) fail('AR search كومي missing COMI');
  else ok();

  // ===== 8. Agent tools route =====
  const tools = await j('/api/agent/tools');
  if (tools.code !== 200) fail(`agent/tools HTTP ${tools.code}`);
  else ok();

  console.log(`\n=== T40 PART 1: ${passes} pass, ${fails.length} FAIL, ${warns.length} warn ===`);
  fails.forEach(f => console.log('FAIL:', f));
  warns.forEach(w => console.log('WARN:', w));
})();
