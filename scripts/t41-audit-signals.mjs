/** T41 audit — AI signals set integrity: every number the LLM wrote must
 *  trace to live data. Checks:
 *   1. picks' close == live scanner close (±1%)
 *   2. entry/stop/target == charter ATR math recomputed from live candles
 *   3. R:R ≈ 1.5
 *   4. thesisAr/En: every number ≥4 significant digits must appear in the
 *     evidence/levels/close pack (same discipline as the agent gate)
 *   5. market bias summary numbers vs live breadth
 *   6. earningsRisk dates are strictly future
 *   7. stance/conviction discipline vs charterScore
 */
const BASE = "http://localhost:3000";

const sig = await (await fetch(`${BASE}/api/ai-signals`)).json();
console.log("status:", sig.status, "| generatedAt:", sig.set?.generatedAt, "| model:", sig.set?.model, "| llmMs:", sig.set?.llmMs);
if (!sig.set) { console.log("NO SET — abort"); process.exit(1); }

const uni = await (await fetch(`${BASE}/api/companies`)).json();
const byTicker = new Map(uni.rows.map((r) => [r.ticker, r]));
console.log(`picks: ${sig.set.picks.length} | scanned: ${sig.set.scanned}`);

let issues = 0;
const bad = (msg) => { issues++; console.log("  ✗ " + msg); };

for (const p of sig.set.picks) {
  const live = byTicker.get(p.ticker);
  console.log(`\n— ${p.ticker} [${p.stance}] conv=${p.conviction} charterScore=${p.charterScore}`);
  if (!live) { bad(`${p.ticker} not in live universe!`); continue; }
  // 1. close
  const dClose = Math.abs(p.close - live.close) / live.close;
  if (dClose > 0.01) bad(`close drift ${p.close} vs live ${live.close} (${(dClose*100).toFixed(2)}%)`);
  else console.log(`  ✓ close ${p.close} == live ${live.close}`);
  // 2. levels math: fetch candles, recompute
  const ch = await (await fetch(`${BASE}/api/chart?symbol=${p.ticker}&range=1Y`)).json();
  const pts = ch.points ?? [];
  if (p.stance === "long" && p.entry != null) {
    // recompute ATR from points
    const n = 14;
    if (pts.length >= n + 1) {
      let sum = 0, cnt = 0;
      for (let i = pts.length - n; i < pts.length; i++) {
        const h = pts[i].high ?? pts[i].close, l = pts[i].low ?? pts[i].close, pc = pts[i-1].close;
        sum += Math.max(h-l, Math.abs(h-pc), Math.abs(l-pc)); cnt++;
      }
      const atr = sum / cnt;
      const atrAbs = (atr / p.close) * p.close; // % of close → abs
      const stopExpect = p.entry - 2 * (atr / p.close) * p.close;
      const targetExpect = p.entry + 3 * (atr / p.close) * p.close;
      const dStop = Math.abs(p.stop - stopExpect) / Math.max(1e-9, stopExpect);
      const dTarget = Math.abs(p.target - targetExpect) / Math.max(1e-9, targetExpect);
      if (dStop > 0.02) bad(`stop mismatch: served ${p.stop} vs recomputed ${stopExpect.toFixed(3)}`);
      else console.log(`  ✓ stop ${p.stop} ~ ${stopExpect.toFixed(3)}`);
      if (dTarget > 0.02) bad(`target mismatch: served ${p.target} vs recomputed ${targetExpect.toFixed(3)}`);
      else console.log(`  ✓ target ${p.target} ~ ${targetExpect.toFixed(3)}`);
      if (p.rr != null && (p.rr < 1.3 || p.rr > 1.7)) bad(`R:R ${p.rr} outside charter 1.5 band`);
      else console.log(`  ✓ rr ${p.rr}`);
    }
  }
  // 4. thesis numbers traceable
  const pack = [p.close, p.entry, p.stop, p.target, live.changePct, ...(p.evidence ?? [])].join(" ");
  const packNums = (pack.match(/\d[\d.,]*%?/g) ?? []).map((s) => s.replace(/[,.%]/g, ""));
  const packSet = new Set(packNums.map(Number).filter(Number.isFinite));
  for (const thesis of [p.thesisAr, p.thesisEn]) {
    const nums = (thesis.match(/\d[\d.,]*%?/g) ?? []).map((s) => s.replace(/[,.%]/g, ""));
    for (const raw of nums) {
      const v = Number(raw);
      if (!Number.isFinite(v)) continue;
      const sigd = raw.replace(/^0+/, "").replace(/\./, "").length;
      if (sigd < 4) continue; // small ints/horizons ok
      // allow ±1% of any pack number or of pack numbers scaled by 100 (pct vs decimal)
      const near = [...packSet].some((x) => Math.abs(x - v) / Math.max(1, Math.abs(x)) < 0.011)
        || [...packSet].some((x) => Math.abs(x * 100 - v) / Math.max(1, Math.abs(x * 100)) < 0.011)
        || [...packSet].some((x) => Math.abs(x / 100 - v) / Math.max(1e-9, Math.abs(x / 100)) < 0.011);
      if (!near) { bad(`${p.ticker} thesis number ${raw} not traceable to evidence pack`); console.log(`    thesis: ${thesis.slice(0, 120)}`); break; }
    }
  }
  // 6. earnings future
  if (p.earningsRisk) {
    const d = Date.parse(`${p.earningsRisk}T00:00:00Z`);
    if (!(d > Date.now())) bad(`${p.ticker} earningsRisk ${p.earningsRisk} is PAST`);
    else console.log(`  ✓ earningsRisk future ${p.earningsRisk}`);
  }
  // 7. discipline
  if (p.stance === "long" && p.charterScore != null && p.charterScore < 0.35) bad(`${p.ticker} long with weak charterScore ${p.charterScore}`);
  if (p.stance === "avoid" && p.charterScore != null && p.charterScore > 0.35) bad(`${p.ticker} avoid with strong charterScore ${p.charterScore}`);
  if (p.conviction < 1 || p.conviction > 5) bad(`${p.ticker} conviction ${p.conviction} out of range`);
}

// 5. bias summary vs live breadth
const b = sig.set.marketBias;
console.log(`\nbias: ${b.direction} conv=${b.conviction}`);
const up = uni.rows.filter((r) => r.changePct > 0).length;
const down = uni.rows.filter((r) => r.changePct < 0).length;
console.log(`  live breadth: up=${up} down=${down} of ${uni.rows.length}`);
for (const [k, txt] of [["summaryAr", b.summaryAr], ["summaryEn", b.summaryEn]]) {
  const nums = (txt.match(/\d[\d.,]*%?/g) ?? []);
  for (const raw of nums) {
    const v = Number(raw.replace(/[,.%]/g, ""));
    if (!Number.isFinite(v)) continue;
    const ok = [up, down, uni.rows.length, up - down].some((x) => Math.abs(x - v) <= Math.max(1, x * 0.02))
      || [up, down, uni.rows.length].some((x) => Math.abs(x * 100 - v) < Math.max(2, x));
    if (!ok) { issues++; console.log(`  ✗ bias ${k} number ${raw} not matching live breadth (up=${up} down=${down}) — text: ${txt.slice(0,150)}`); break; }
  }
}
// CJK leak check in Arabic theses
for (const p of sig.set.picks) {
  if (/[\u4e00-\u9fff]/.test(p.thesisAr ?? "")) { issues++; console.log(`  ✗ CJK leak in ${p.ticker} thesisAr`); }
  if (/[\u0600-\u06ff]/.test(p.thesisEn ?? "")) { issues++; console.log(`  ✗ Arabic leak in ${p.ticker} thesisEn`); }
}

console.log(`\n=== ISSUES: ${issues} ===`);
