/** T39 — deep cross-endpoint consistency audit.
 *  Hunts for DATA-LEVEL bugs shape tests can't see:
 *   - same fact (ticker price, index close) disagreeing across endpoints
 *   - math errors (changePct vs close/prev, breadth sums, sector aggregates)
 *   - staleness (quotes older than session, calendar showing past events as future)
 *   - sorting/ranking contradictions (home narrative vs tables)
 */
const BASE = "http://localhost:3000";
let fails = 0, checks = 0;
const ok = (name, cond, detail = "") => {
  checks++;
  if (!cond) { fails++; console.log(`  ✗ ${name} ${detail}`); }
  else console.log(`  ✓ ${name}`);
};
const j = async (p) => (await fetch(BASE + p)).json();
const n = (x) => typeof x === "number" && Number.isFinite(x);

(async () => {
  console.log("── 1. Universe consistency (companies ↔ overview ↔ search ↔ company) ──");
  const [companies, overview, search, sectors] = await Promise.all([
    j("/api/companies"), j("/api/overview"), j("/api/search?q=COMI"), j("/api/sectors"),
  ]);
  const uni = companies.rows ?? companies.companies ?? [];
  ok("universe non-empty", uni.length > 200, `got ${uni.length}`);
  const comi = uni.find(s => s.ticker === "COMI");
  ok("COMI in universe", !!comi);
  const comiDetail = await j("/api/company/COMI");
  ok("COMI detail price == universe price",
    Math.abs((comiDetail.quote?.close ?? comiDetail.stock?.close ?? comiDetail.close ?? 0) - comi.close) < 0.01,
    `${comiDetail.quote?.close ?? comiDetail.stock?.close ?? comiDetail.close} vs ${comi.close}`);
  const sRes = search.results ?? search.items ?? [];
  const comiS = sRes.find(r => (r.ticker ?? "").includes("COMI"));
  ok("search COMI price == universe price",
    !comiS || Math.abs((comiS.close ?? comiS.price ?? comi.close) - comi.close) < 0.01,
    `${comiS?.close ?? comiS?.price} vs ${comi.close}`);

  console.log("── 2. Math integrity across the universe ──");
  let badPct = 0, badAbs = 0, badValue = 0, bad52 = 0, negPrice = 0;
  for (const s of uni) {
    if (n(s.close) && s.close <= 0) negPrice++;
    // prevClose = close - changeAbs ; changePct = changeAbs/prev*100
    if (n(s.close) && n(s.changeAbs) && n(s.changePct)) {
      const prev = s.close - s.changeAbs;
      if (prev > 0) {
        const pct = (s.changeAbs / prev) * 100;
        if (Math.abs(pct - s.changePct) > 0.06) badPct++;
      }
    } else badAbs++;
    if (n(s.volume) && n(s.close) && n(s.valueTraded) && s.volume > 0) {
      if (Math.abs(s.valueTraded - s.volume * s.close) / Math.max(1, s.valueTraded) > 0.25) badValue++;
    }
    if (n(s.high52) && n(s.low52) && n(s.close)) {
      if (s.high52 < s.low52 || s.close > s.high52 * 1.02 || s.close < s.low52 * 0.98) bad52++;
    }
  }
  ok("changePct math consistent (±0.06pp)", badPct === 0, `${badPct}/${uni.length} bad`);
  ok("valueTraded ≈ volume×close (±25%)", badValue === 0, `${badValue} bad`);
  ok("close within 52w band (±2%)", bad52 === 0, `${bad52} bad`);
  ok("no negative/zero prices", negPrice === 0, `${negPrice} bad`);

  console.log("── 3. Breadth / sector aggregates == universe ──");
  const adv = overview.breadth?.up ?? overview.breadth?.advancers ?? 0;
  const dec = overview.breadth?.down ?? overview.breadth?.decliners ?? 0;
  const unc = overview.breadth?.flat ?? overview.breadth?.unchanged ?? 0;
  const tot = adv + dec + unc;
  ok("breadth sums to universe size", tot === uni.length, `${tot} vs ${uni.length}`);
  ok("breadth.total field == universe", (overview.breadth?.total ?? -1) === uni.length, `${overview.breadth?.total} vs ${uni.length}`);
  const sectorRows = sectors.sectors ?? [];
  const sectorTotal = sectorRows.reduce((a, s) => a + (s.count ?? s.stocks ?? 0), 0);
  ok("sector counts sum to universe", sectorTotal === uni.length, `${sectorTotal} vs ${uni.length}`);
  // sector changePct should be cap/value-weighted from members — check each sector has members summing to count
  let badSector = 0;
  for (const sr of sectorRows) {
    const members = uni.filter(s => s.sector === sr.key || s.sector === sr.name || s.sector === sr.sector);
    if ((sr.count ?? 0) > 0 && members.length !== (sr.count ?? members.length)) badSector++;
  }
  ok("sector membership matches count", badSector === 0, `${badSector} mismatched`);

  console.log("── 3b. Sector up/down/flat == universe by sectorCode ──");
  let secBreadthBad = 0;
  for (const sr of sectorRows) {
    const members = uni.filter(s => s.sectorCode === sr.code);
    const up = members.filter(s => (s.changePct ?? 0) > 0).length;
    const down = members.filter(s => (s.changePct ?? 0) < 0).length;
    const flat = members.length - up - down;
    if (up !== (sr.up ?? -1) || down !== (sr.down ?? -1) || flat !== (sr.flat ?? -1)) secBreadthBad++;
  }
  ok("sector up/down/flat match members", secBreadthBad === 0, `${secBreadthBad} mismatched`);

  console.log("── 4. Index quotes internal math ──");
  const indices = overview.indices ?? [];
  for (const ix of indices) {
    if (n(ix.close) && n(ix.changeAbs) && n(ix.changePct)) {
      const prev = ix.close - ix.changeAbs;
      if (prev > 0) {
        const pct = (ix.changeAbs / prev) * 100;
        ok(`index ${ix.code} changePct math`, Math.abs(pct - ix.changePct) < 0.06, `${pct.toFixed(3)} vs ${ix.changePct}`);
      }
    }
  }

  console.log("── 5. Calendar — past events must not be 'upcoming' ──");
  const cal = await j("/api/calendar");
  const events = cal.events ?? cal.items ?? [];
  const now = Date.now();
  const today = new Date(); today.setHours(0,0,0,0);
  const future = events.filter(e => new Date(e.date) >= today);
  const past = events.filter(e => new Date(e.date) < today);
  ok("calendar has events", events.length > 0, `${events.length}`);
  ok("calendar has upcoming events", future.length > 0, `${future.length} upcoming, ${past.length} past`);
  // if API serves past events mixed with future, check flagging
  const unflaggedPast = events.filter(e => new Date(e.date) < today && !e.past && e.upcoming !== false).length;
  ok("past events flagged or excluded", unflaggedPast === 0 || cal.servePast === true, `${unflaggedPast} unflagged past`);

  console.log("── 6. Signals ↔ universe consistency ──");
  const signals = await j("/api/signals");
  const sigRows = signals.signals ?? signals.rows ?? [];
  ok("signals rows exist", sigRows.length > 0, `${sigRows.length}`);
  let sigTickerMissing = 0, sigPriceMismatch = 0;
  const uniMap = new Map(uni.map(s => [s.ticker, s]));
  for (const r of sigRows.slice(0, 60)) {
    const t = (r.ticker ?? "").split(":").pop();
    const u = uniMap.get(t);
    if (!u) sigTickerMissing++;
    else if (n(r.close) && n(u.close) && Math.abs(r.close - u.close) / u.close > 0.02) sigPriceMismatch++;
  }
  ok("signal tickers all in universe", sigTickerMissing === 0, `${sigTickerMissing} missing`);
  ok("signal prices == universe (±2%)", sigPriceMismatch === 0, `${sigPriceMismatch} mismatch`);

  console.log("── 7. AI-signals ↔ universe ──");
  try {
    const ai = await j("/api/ai-signals");
    const aiRows = ai.signals ?? ai.items ?? [];
    ok("ai-signals rows exist", aiRows.length > 0, `${aiRows.length}`);
    let aiBad = 0;
    for (const r of aiRows.slice(0, 30)) {
      const u = uniMap.get((r.ticker ?? "").split(":").pop());
      if (!u) aiBad++;
    }
    ok("ai-signal tickers in universe", aiBad === 0, `${aiBad} missing`);
  } catch (e) { ok("ai-signals endpoint", false, String(e).slice(0, 80)); }

  console.log("── 8. Reports levels sanity (R:R 1.5, price bands) ──");
  try {
    const rep = await j("/api/reports");
    const rows = rep.reports ?? rep.rows ?? [];
    ok("reports rows exist", rows.length > 0, `${rows.length}`);
    let rrBad = 0, entryBad = 0;
    for (const r of rows) {
      const e = r.entry ?? r.levels?.entry, s = r.stop ?? r.levels?.stop, t = r.target ?? r.levels?.target;
      if (n(e) && n(s) && n(t)) {
        const rr = (t - e) / (e - s);
        if (Math.abs(rr - 1.5) > 0.03) rrBad++;
        const u = uniMap.get(r.ticker);
        if (u && n(u.close) && Math.abs(e - u.close) / u.close > 0.12) entryBad++;
      }
    }
    ok("report R:R ≈ 1.5", rrBad === 0, `${rrBad} bad`);
    ok("report entries near live price (±12%)", entryBad === 0, `${entryBad} bad`);
  } catch (e) { ok("reports endpoint", false, String(e).slice(0, 80)); }

  console.log("── 9. GCC / rates / economy sanity ──");
  try {
    const gcc = await j("/api/gcc");
    for (const ix of gcc.indices ?? []) {
      ok(`GCC ${ix.code} close positive`, n(ix.close) && ix.close > 0, `${ix.close}`);
      if (n(ix.changePct)) ok(`GCC ${ix.code} changePct range`, Math.abs(ix.changePct) < 12, `${ix.changePct}`);
    }
  } catch (e) { ok("gcc endpoint", false, String(e).slice(0, 80)); }
  try {
    const rates = await j("/api/rates");
    const rows = rates.rows ?? [];
    ok("rates policy 15-30%", rows.some(r => r.key === "policy" && r.value >= 15 && r.value <= 30), JSON.stringify(rows.map(r => r.value)));
  } catch (e) { ok("rates endpoint", false, String(e).slice(0, 80)); }
  try {
    const eco = await j("/api/economy");
    const usd = (eco.fx ?? []).find(f => f.code === "USD");
    ok("USD/EGP plausible 40-60", usd && n(usd.egpPer) && usd.egpPer > 40 && usd.egpPer < 60, `${usd?.egpPer}`);
    const g = eco.gold ?? {};
    ok("gold EGP/g 21k plausible 3000-8000", n(g.egpPerGram21) && g.egpPerGram21 > 3000 && g.egpPerGram21 < 8000, `${g.egpPerGram21}`);
    const g24 = g.egpPerGram, g21 = g.egpPerGram21, g18 = g.egpPerGram18;
    if (n(g24) && n(g21)) ok("21k = 24k × 0.875", Math.abs(g21 - g24 * 0.875) < 1, `${g21} vs ${g24 * 0.875}`);
    if (n(g24) && n(g18)) ok("18k = 24k × 0.75", Math.abs(g18 - g24 * 0.75) < 1, `${g18} vs ${g24 * 0.75}`);
  } catch (e) { ok("economy endpoint", false, String(e).slice(0, 80)); }

  console.log("── 10. Dividends & statements sanity (real companies) ──");
  try {
    const div = await j("/api/dividends/COMI");
    const rows = div.rows ?? [];
    ok("COMI dividends exist", rows.length > 0, `${rows.length}`);
    const badAmt = rows.filter(r => !n(r.amount) || r.amount <= 0 || r.amount > 100).length;
    ok("dividend amounts plausible EGP/share", badAmt === 0, `${badAmt} bad`);
    // newest first
    let sorted = true;
    for (let i = 1; i < rows.length; i++) if (rows[i].exDate > rows[i-1].exDate) { sorted = false; break; }
    ok("dividends newest-first", sorted);
  } catch (e) { ok("dividends endpoint", false, String(e).slice(0, 80)); }
  try {
    const st = await j("/api/statements/COMI");
    ok("COMI statements has data", st.hasData !== false && (st.annual?.income ?? st.annual?.balance) !== null, JSON.stringify(st.hasData));
  } catch (e) { ok("statements endpoint", false, String(e).slice(0, 80)); }

  console.log("── 11. Search ranking sanity ──");
  try {
    const s2 = await j("/api/search?q=" + encodeURIComponent("مطاحن"));
    const r2 = s2.results ?? s2.items ?? [];
    ok("Arabic search مطاحن ≥ 5", r2.length >= 5, `${r2.length}`);
    const s3 = await j("/api/search?q=" + encodeURIComponent("كومي"));
    const r3 = s3.results ?? s3.items ?? [];
    ok("Arabic search كومي finds COMI first-ish", r3.length > 0 && r3[0].ticker?.includes("COMI"), r3.map(r => r.ticker).slice(0, 3).join(","));
  } catch (e) { ok("search endpoint", false, String(e).slice(0, 80)); }

  console.log("── 12. News freshness ──");
  try {
    const news = await j("/api/news?page=1&limit=10");
    const items = news.items ?? [];
    ok("news items exist", items.length > 0, `${items.length}`);
    const newest = items[0]?.publishedAt ?? items[0]?.date;
    if (newest) {
      const ageH = (Date.now() - new Date(newest).getTime()) / 3600_000;
      ok("newest news < 48h old", ageH < 48, `${ageH.toFixed(1)}h old (${newest})`);
    }
    let badLink = 0;
    for (const it of items) if (!/^https?:\/\//.test(it.link ?? "")) badLink++;
    ok("news links absolute", badLink === 0, `${badLink} bad`);
  } catch (e) { ok("news endpoint", false, String(e).slice(0, 80)); }

  console.log("── 13. Insiders sanity ──");
  try {
    const ins = await j("/api/insiders");
    const rows = ins.items ?? ins.rows ?? [];
    ok("insiders rows exist", rows.length > 0, `${rows.length}`);
    const asOf = ins.asOf;
    if (asOf) {
      const ageD = (Date.now() - new Date(asOf).getTime()) / 86400_000;
      ok("insiders data < 30 days old", ageD < 30, `${ageD.toFixed(1)}d old (${asOf})`);
    }
    const badShares = rows.filter(r => n(r.shares) === false || (r.shares ?? 0) < 0).length;
    ok("insider shares non-negative", badShares === 0, `${badShares}`);
  } catch (e) { ok("insiders endpoint", false, String(e).slice(0, 80)); }

  console.log("── 14. Chart history continuity ──");
  try {
    const ch = await j("/api/chart?symbol=COMI&range=1y");
    const pts = ch.points ?? ch.candles ?? [];
    ok("COMI 1y points ≥ 200", pts.length >= 200, `${pts.length}`);
    let badOrder = 0, badClose = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i].t <= pts[i-1].t) badOrder++;
    for (const p of pts) if (!n(p.c) || p.c <= 0 || p.c > 5000) badClose++;
    ok("chart timestamps strictly ascending", badOrder === 0, `${badOrder} bad`);
    ok("chart closes plausible", badClose === 0, `${badClose} bad`);
    const lastC = pts[pts.length-1]?.c, liveC = comi.close;
    if (n(lastC) && n(liveC)) ok("chart last close == live close (±3%)", Math.abs(lastC - liveC) / liveC < 0.03, `${lastC} vs ${liveC}`);
  } catch (e) { ok("chart endpoint", false, String(e).slice(0, 80)); }

  console.log("── 15. Funds view sanity ──");
  try {
    const f = await j("/api/funds");
    ok("funds ETF snapshot labeled with date", !!f.etf?.date || !!f.snapshot?.date, "no date");
    const listed = f.listedFunds ?? [];
    for (const lf of listed.slice(0, 10)) {
      ok(`fund ${lf.ticker} close positive`, n(lf.close) && lf.close > 0, `${lf.close}`);
    }
  } catch (e) { ok("funds endpoint", false, String(e).slice(0, 80)); }

  console.log("── 16. Overview movers/actives ↔ universe ──");
  try {
    const movers = overview.movers ?? [];
    ok("movers non-empty", movers.length >= 4, `${movers.length}`);
    // top gainer in universe must be movers[0]
    const topG = [...uni].filter(s => n(s.changePct)).sort((a, b) => b.changePct - a.changePct)[0];
    ok("movers[0] == universe top gainer", movers[0] && movers[0].ticker === topG.ticker,
      `${movers[0]?.ticker} ${movers[0]?.changePct?.toFixed(2)} vs ${topG.ticker} ${topG.changePct.toFixed(2)}`);
    // actives sorted by valueTraded
    const actives = overview.actives ?? [];
    const topActive = [...uni].filter(s => n(s.valueTraded)).sort((a, b) => b.valueTraded - a.valueTraded)[0];
    ok("actives[0] == universe top valueTraded", actives[0] && actives[0].ticker === topActive.ticker,
      `${actives[0]?.ticker} vs ${topActive.ticker}`);
    // totals.valueTraded == sum of universe
    const sumVal = uni.reduce((a, s) => a + (s.valueTraded ?? 0), 0);
    const totVal = overview.totals?.valueTraded;
    if (n(totVal)) ok("totals.valueTraded == Σ universe (±0.5%)", Math.abs(totVal - sumVal) / sumVal < 0.005,
      `${(totVal/1e9).toFixed(3)}bn vs ${(sumVal/1e9).toFixed(3)}bn`);
    // movers prices must match universe
    let moverPriceBad = 0;
    for (const m of movers) {
      const u = uni.find(s => s.ticker === m.ticker);
      if (u && n(m.close) && n(u.close) && Math.abs(m.close - u.close) > 0.005) moverPriceBad++;
    }
    ok("movers prices == universe", moverPriceBad === 0, `${moverPriceBad} bad`);
  } catch (e) { console.log("  (overview cross-check skipped: " + String(e).slice(0, 60) + ")"); }

  console.log("\n════════ CROSS-CONSISTENCY AUDIT ════════");
  console.log(`TOTAL: ${checks}  PASS: ${checks - fails}  FAIL: ${fails}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error("FATAL", e); process.exit(2); });
