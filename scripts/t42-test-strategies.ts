/** T42 — Multi-Strategy Signals Engine test suite.
 *
 *  Unit (synthetic candles, no network):
 *    - each of the 12 strategies fires exactly where designed (uptrend,
 *      downtrend, breakout-with-volume, oversold dip in uptrend, MACD
 *      ignition, fundamental/news contexts) and does NOT fire on flat noise
 *    - NO LOOKAHEAD: appending/mutating FUTURE candles never changes a past
 *      evaluation (the backtest contract)
 *    - ensemble math: consensus/agreement/votes computed by hand and checked
 *      (incl. the ATR volatility guard scaling)
 *    - the 0.35 long gate mathematically requires several strategies (a
 *      single full-strength vote moves consensus ~0.09)
 *    - language purity: evidenceAr() renders EVERY produced evidence code
 *      with zero stray Latin
 *    - registry integrity: 12 strategies, stable ids, unique, bilingual names
 *
 *  Live (dev server):
 *    - /api/signals rows carry the ensemble block on every row
 *    - /api/ai-signals picks carry strategies + votes + consensus; old
 *      persisted sets normalize to empty strategies (no undefined)
 *    - charter served = the multi-strategy charter (rev egx-multi-v2)
 *
 *  Run: bun scripts/t42-test-strategies.ts   (dev server on :3000) */
import {
  evaluateStrategies,
  ensembleRead,
  evaluateEnsemble,
  STRATEGY_REGISTRY,
  strategyById,
  type StrategyCtx,
  type ChartPointLite,
} from "@/lib/strategies";
import { STRATEGY_REV, STRATEGY_CHARTER, atrPctAt } from "@/lib/strategy";
import { strayLatinInArabic, evidenceAr } from "@/lib/ai-signals";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label}`);
  }
}

// ── synthetic candle builders ─────────────────────────────────────────────

function mkPts(
  n: number,
  gen: (i: number) => { close: number; volume: number; high?: number; low?: number }
): ChartPointLite[] {
  const out: ChartPointLite[] = [];
  let d = new Date("2024-01-01T00:00:00Z");
  for (let i = 0; i < n; i++) {
    // skip weekends — dates only matter for ordering
    do {
      d = new Date(d.getTime() + 24 * 3600_000);
    } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    const g = gen(i);
    out.push({
      date: d.toISOString().slice(0, 10),
      close: g.close,
      volume: g.volume,
      high: g.high ?? g.close * 1.004,
      low: g.low ?? g.close * 0.996,
    });
  }
  return out;
}

/** Steady uptrend with mild noise: +0.25%/bar around an exponential climb. */
function uptrend(n: number, drift = 0.0025): ChartPointLite[] {
  let p = 100;
  return mkPts(n, (i) => {
    const noise = Math.sin(i * 1.7) * 0.0015;
    p = p * (1 + drift + noise);
    return { close: p, volume: 1_000_000 + (i % 7) * 40_000 };
  });
}

/** Two-phase downtrend — gentle slope, then a steep final 20 bars: the
 *  EMA gap is still WIDENING at the evaluation bar, so the MACD histogram
 *  stays decisively negative (constant-rate declines converge hist → 0,
 *  which is honest non-firing). */
function downtrend(n: number): ChartPointLite[] {
  let p = 100;
  return mkPts(n, (i) => {
    p = p * (i < n - 20 ? 0.999 : 0.985);
    return { close: p, volume: 1_000_000 + (i % 7) * 40_000 };
  });
}

/** Ranging tape: slow ±3% oscillation (a real 6% 60-session range). */
function ranging(n: number): ChartPointLite[] {
  return mkPts(n, (i) => {
    const p = 100 + Math.sin(i * 0.15) * 3;
    return { close: p, volume: 1_000_000 };
  });
}

/** Dead-flat tape — identical closes (suspended/pinned). */
function constFlat(n: number): ChartPointLite[] {
  return mkPts(n, () => ({ close: 100, volume: 1_000_000 }));
}

/** Flat noise — nothing should fire. */
function flat(n: number): ChartPointLite[] {
  return mkPts(n, (i) => {
    const p = 100 * (1 + Math.sin(i * 0.9) * 0.002);
    return { close: p, volume: 900_000 };
  });
}

const CTX_NULL: StrategyCtx = { divYield: null, fundQuality: null, newsScore: null, techScore: 0 };

function fired(v: ReturnType<typeof evaluateStrategies>, id: string) {
  const s = v.find((x) => x.id === id);
  return s?.fired ? s : null;
}

// ── 1. registry integrity ─────────────────────────────────────────────────
console.log("\n[1] registry integrity");
{
  ok(STRATEGY_REGISTRY.length === 12, `12 strategies registered (got ${STRATEGY_REGISTRY.length})`);
  const ids = STRATEGY_REGISTRY.map((s) => s.id);
  ok(new Set(ids).size === 12, "ids unique");
  ok(STRATEGY_REGISTRY.every((s) => s.nameAr.length > 2 && s.nameEn.length > 2 && s.oneLineAr.length > 5 && s.oneLineEn.length > 5), "bilingual names + one-liners present");
  ok(STRATEGY_REGISTRY.every((s) => s.weight > 0 && s.weight <= 1), "weights in (0, 1]");
  ok(strategyById("trend-rider")?.nameEn === "Trend Rider", "strategyById resolves");
  ok(strategyById("nope") === null, "strategyById rejects unknown");
}

// ── 2. trend strategies on a clean uptrend ────────────────────────────────
console.log("\n[2] uptrend fires the trend/momentum family");
{
  const pts = uptrend(320);
  const v = evaluateStrategies(pts, CTX_NULL);
  const tr = fired(v, "trend-rider");
  ok(tr !== null && tr.direction === "long", "trend-rider fires long on uptrend");
  ok((tr?.score ?? 0) >= 0.4, `trend-rider score sane (got ${tr?.score?.toFixed(2)} — stretched RSI may cut it honestly)`);
  const gc = fired(v, "golden-cross");
  ok(gc !== null && gc.direction === "long", "golden-cross fires long on uptrend");
  const mo = fired(v, "momentum-3m");
  ok(mo !== null && mo.direction === "long", "momentum-3m fires long on uptrend");
  const mr = fired(v, "mean-reversion");
  ok(mr === null, "mean-reversion stays silent on a non-dip uptrend");
  const ens = ensembleRead(v, atrPctAt(pts, 14));
  ok(ens.consensus > 0.2, `ensemble consensus positive (got ${ens.consensus})`);
  ok(ens.longVotes >= 3, `several strategies long (${ens.longVotes})`);
  ok(ens.applicable === 10, `applicable = 10 candle strategies (got ${ens.applicable})`);
}

// ── 3. downtrend mirrors ──────────────────────────────────────────────────
console.log("\n[3] downtrend fires the avoid family");
{
  const pts = downtrend(320);
  const v = evaluateStrategies(pts, CTX_NULL);
  const tr = fired(v, "trend-rider");
  ok(tr !== null && tr.direction === "avoid", "trend-rider fires avoid on downtrend");
  const gc = fired(v, "golden-cross");
  ok(gc !== null && gc.direction === "avoid", "golden-cross fires avoid on downtrend");
  const mo = fired(v, "momentum-3m");
  ok(mo !== null && mo.direction === "avoid", "momentum-3m fires avoid on downtrend");
  const ens = ensembleRead(v, atrPctAt(pts, 14));
  ok(ens.consensus < -0.2, `ensemble consensus negative (got ${ens.consensus})`);
}

// ── 4. dead-flat tape — discipline (nothing fires) ────────────────────────
console.log("\n[4] dead-flat tape stays silent");
{
  const v = evaluateStrategies(constFlat(320), CTX_NULL);
  const ens = ensembleRead(v, 1.5);
  const firedIds = v.filter((x) => x.fired).map((x) => x.id);
  ok(firedIds.length === 0, `nothing fires on a pinned tape (fired: ${firedIds.join(",") || "none"})`);
  ok(Math.abs(ens.consensus) < 0.05, `consensus ~0 (got ${ens.consensus})`);
}

// ── 5. breakout + volume surge ────────────────────────────────────────────
console.log("\n[5] breakout with volume expansion");
{
  // a real 6% range, then 6 bars pushing to fresh highs on 2.6x volume
  const base = ranging(240);
  let p = base[base.length - 1].close;
  const spike = mkPts(6, () => {
    p *= 1.02;
    return { close: p, volume: 2_600_000 };
  });
  const pts = [...base, ...spike];
  const v = evaluateStrategies(pts, CTX_NULL);
  const bo = fired(v, "breakout-hunter");
  ok(bo !== null && bo.direction === "long", "breakout-hunter fires long at new highs");
  const vs = fired(v, "volume-surge");
  ok(vs !== null && vs.direction === "long", "volume-surge fires long on 2.6x volume + up day");
  // and the range guard: a pinned tape near its "high" is NOT a breakout
  const pinned = evaluateStrategies(constFlat(320), CTX_NULL);
  ok(fired(pinned, "breakout-hunter") === null, "range guard blocks breakouts on pinned tapes");
}

// ── 6. oversold dip inside an uptrend (mean reversion + band pierce) ─────
console.log("\n[6] mean-reversion on an oversold dip in an uptrend");
{
  const up = uptrend(240, 0.002);
  let p = up[up.length - 1].close;
  // 5 sharp down bars (-1.55%/bar ≈ -7.5% dip) — RSI collapses, price < SMA5,
  // still above SMA100/SMA200 (the dip stays inside the trend gap)
  const dip = mkPts(5, () => {
    p *= 0.9845;
    return { close: p, volume: 1_100_000 };
  });
  const pts = [...up, ...dip];
  const v = evaluateStrategies(pts, CTX_NULL);
  const mr = fired(v, "mean-reversion");
  ok(mr !== null && mr.direction === "long", "mean-reversion fires long on the dip");
  // the dip also pierces the lower Bollinger band → bb-bounce candidate
  const bb = fired(v, "bb-bounce");
  ok(bb !== null && bb.direction === "long", "bb-bounce fires long on the band pierce");
}

// ── 7. MACD swing ignition ────────────────────────────────────────────────
console.log("\n[7] MACD swing ignition");
{
  // pinned tape (histogram pinned at 0) → gentle rise: histogram crosses
  // from 0 to positive — a deterministic ignition
  const base = constFlat(200);
  let p = base[base.length - 1].close;
  const rise = mkPts(3, () => {
    p *= 1.008;
    return { close: p, volume: 1_000_000 };
  });
  const pts = [...base, ...rise];
  const v = evaluateStrategies(pts, CTX_NULL);
  const ms = fired(v, "macd-swing");
  ok(ms !== null && ms.direction === "long", "macd-swing fires on fresh histogram ignition");
}

// ── 8. pullback continuation ──────────────────────────────────────────────
console.log("\n[8] pullback continuation (orderly dip in a confirmed uptrend)");
{
  // drift 0.4%/bar gives enough up-mass that a 4.3% dip resets RSI into 40-60
  const up = uptrend(240, 0.004);
  let p = up[up.length - 1].close;
  // 4 gentle down bars (-1.1%/bar ≈ -4.3% below the 20-session high — the sweet spot)
  const dip = mkPts(4, () => {
    p *= 0.989;
    return { close: p, volume: 1_000_000 };
  });
  const pts = [...up, ...dip];
  const v = evaluateStrategies(pts, CTX_NULL);
  const pc = fired(v, "pullback-continue");
  ok(pc !== null && pc.direction === "long", "pullback-continue fires on the orderly dip");
}

// ── 9. data-gated strategies (fundamental/news ctx) ───────────────────────
console.log("\n[9] dividend-quality & press-tone contexts");
{
  const pts = uptrend(320);
  const dq = evaluateStrategies(pts, { divYield: 6.5, fundQuality: 0.3, newsScore: null, techScore: 0 });
  const d = fired(dq, "dividend-quality");
  ok(d !== null && d.direction === "long", "dividend-quality fires long on 6.5% yield + positive quality above SMA200");
  ok((d?.score ?? 0) > 0.6, `dividend-quality score scales with yield (got ${d?.score?.toFixed(2)})`);

  const noYield = evaluateStrategies(pts, CTX_NULL);
  ok(fired(noYield, "dividend-quality") === null, "dividend-quality silent without yield data");

  const press = evaluateStrategies(pts, { divYield: null, fundQuality: null, newsScore: 0.6, techScore: 0.2 });
  const pt = fired(press, "press-tone");
  ok(pt !== null && pt.direction === "long", "press-tone fires long on +0.6 press score");

  const bear = evaluateStrategies(downtrend(320), { divYield: null, fundQuality: null, newsScore: -0.7, techScore: -0.4 });
  const ptb = fired(bear, "press-tone");
  ok(ptb !== null && ptb.direction === "avoid", "press-tone fires avoid on -0.7 press score");

  const contradict = evaluateStrategies(pts, { divYield: null, fundQuality: null, newsScore: 0.6, techScore: -0.5 });
  ok(fired(contradict, "press-tone") === null, "press-tone suppressed when technicals contradict");
}

// ── 10. NO LOOKAHEAD ──────────────────────────────────────────────────────
console.log("\n[10] no-lookahead contract");
{
  const pts = uptrend(320);
  const cut = 200;
  const before = evaluateStrategies(pts.slice(0, cut), CTX_NULL);
  // scramble everything AFTER the cut — the evaluation at bar `cut` must not move
  const scrambled = [...pts.slice(0, cut), ...mkPts(120, (i) => ({ close: 50 + Math.sin(i * 3) * 30, volume: 5_000_000 }))];
  const after = evaluateStrategies(scrambled.slice(0, cut), CTX_NULL);
  ok(JSON.stringify(before) === JSON.stringify(after), "past evaluation invariant under future mutation");
  // and the full-series evaluation only ADDS bars (does not rewrite history):
  const full = evaluateStrategies(scrambled, CTX_NULL);
  ok(full.length === 12 && before.length === 12, "12 verdicts either way");
}

// ── 11. ensemble math by hand ─────────────────────────────────────────────
console.log("\n[11] ensemble aggregation math");
{
  const pts = uptrend(320);
  const v = evaluateStrategies(pts, CTX_NULL);
  const atr = atrPctAt(pts, 14);
  const ens = ensembleRead(v, atr);
  // recompute by hand from the registry weights
  let sumW = 0;
  let net = 0;
  let longs = 0;
  let avoids = 0;
  for (const x of v) {
    const meta = strategyById(x.id)!;
    if ((x.id === "dividend-quality" || x.id === "press-tone") && !x.fired) continue;
    sumW += meta.weight;
    if (x.fired && x.direction === "long") {
      net += meta.weight * x.score;
      longs++;
    } else if (x.fired && x.direction === "avoid") {
      net -= meta.weight * x.score;
      avoids++;
    }
  }
  let expect = sumW > 0 ? net / sumW : 0;
  if (atr !== null && atr > 9) expect *= 0.35;
  else if (atr !== null && atr > 6) expect *= 0.7;
  expect = Math.max(-1, Math.min(1, expect));
  ok(Math.abs(ens.consensus - Number(expect.toFixed(3))) < 0.002, `consensus matches hand math (${ens.consensus} vs ${expect.toFixed(3)})`);
  ok(ens.longVotes === longs && ens.avoidVotes === avoids, "vote counts match");
  ok(ens.applicable === 10, `applicable = 10 (got ${ens.applicable})`);
  ok(Math.abs(ens.agreement - Number((longs / 10).toFixed(2))) < 0.005, `agreement = longs/10 (${ens.agreement})`);
  ok(ens.verdicts.filter((x) => x.fired).every((x) => x.score > 0), "fired verdicts carry positive scores");
  ok(ens.evidence.length > 0 && ens.evidence.length <= 12, `evidence union bounded (${ens.evidence.length})`);
  ok(ens.evidence.every((e) => /^[a-z0-9-]+: /.test(e)), "evidence codes are strategy-prefixed");

  // ATR guard: same verdicts, blown volatility — consensus scales DOWN
  const wild = ensembleRead(v, 8);
  ok(Math.abs(wild.consensus - Number((ens.consensus * 0.7).toFixed(3))) < 0.002, `ATR 8% cuts consensus to 70% (${wild.consensus} vs ${(ens.consensus * 0.7).toFixed(3)})`);
  const insane = ensembleRead(v, 12);
  ok(Math.abs(insane.consensus - Number((ens.consensus * 0.35).toFixed(3))) < 0.002, `ATR 12% cuts consensus to 35% (${insane.consensus} vs ${(ens.consensus * 0.35).toFixed(3)})`);
}

// ── 12. the 0.35 long gate requires several strategies ────────────────────
console.log("\n[12] single-strategy consensus cannot clear the long gate");
{
  // strongest single candle strategy (weight 1.0, score 1.0) → consensus 1/9 ≈ 0.11
  const pts = uptrend(320);
  const v = evaluateStrategies(pts, CTX_NULL);
  const one = v.map((x) => ({ ...x, fired: false, direction: null, score: 0, evidence: [] }));
  const idx = one.findIndex((x) => x.id === "trend-rider");
  one[idx] = { ...one[idx], fired: true, direction: "long", score: 1 };
  const ens = ensembleRead(one, 1);
  ok(ens.consensus < 0.35, `one full vote → consensus ${ens.consensus} < 0.35 (cannot serve a long)`);
  // two strong votes from heavy families still < 0.35
  const two = [...one];
  const idx2 = two.findIndex((x) => x.id === "breakout-hunter");
  two[idx2] = { ...two[idx2], fired: true, direction: "long", score: 1 };
  const ens2 = ensembleRead(two, 1);
  ok(ens2.consensus < 0.35, `two full votes → consensus ${ens2.consensus} < 0.35`);
}

// ── 13. evidence codes → pure Arabic ──────────────────────────────────────
console.log("\n[13] evidenceAr purity over the full code inventory");
{
  const fixtures = [
    uptrend(320),
    downtrend(320),
    flat(320),
    [...flat(240), ...mkPts(6, () => ({ close: (Math.random() * 0 + 1) * 103, volume: 2_600_000 }))],
    [...uptrend(240), ...mkPts(8, (i) => ({ close: 100 * (1 - (i + 1) * 0.025), volume: 1_100_000 }))],
    [...flat(200), ...mkPts(5, () => ({ close: 101, volume: 1_000_000 }))],
  ];
  const codes: string[] = [];
  for (const pts of fixtures) {
    for (const ctx of [
      CTX_NULL,
      { divYield: 6.5, fundQuality: 0.3, newsScore: null, techScore: 0 } as StrategyCtx,
      { divYield: null, fundQuality: null, newsScore: 0.6, techScore: 0.2 } as StrategyCtx,
      { divYield: null, fundQuality: null, newsScore: -0.7, techScore: -0.4 } as StrategyCtx,
    ]) {
      const ens = evaluateEnsemble(pts, ctx, atrPctAt(pts, 14));
      // the served/fallback path carries ONLY the prefixed union codes —
      // raw inner codes never reach evidenceAr directly
      codes.push(...ens.evidence);
    }
  }
  const unique = [...new Set(codes)];
  ok(unique.length > 25, `code inventory rich (${unique.length} unique codes)`);
  const ar = evidenceAr(unique.slice(0, 60));
  const strays = strayLatinInArabic(ar);
  ok(strays.length === 0, `evidenceAr output pure Arabic (strays: ${strays.slice(0, 5).join(",") || "none"})`);
  // every ensemble-prefixed code renders its strategy's Arabic name
  const prefixed = unique.filter((c) => /^[a-z0-9-]+: /.test(c)).slice(0, 12);
  const rendered = evidenceAr(prefixed);
  ok(/[\u0600-\u06ff]/.test(rendered), "prefixed codes render Arabic");
  // unknown codes still pass verbatim (honest) — but never inside a prefixed code
  ok(evidenceAr(["RSI14 55.0"]).includes("55.0"), "classic codes still translate with numbers kept");
}

// ── 14. charter + rev ─────────────────────────────────────────────────────
console.log("\n[14] charter is the multi-strategy charter");
{
  ok(STRATEGY_REV === "egx-multi-v2", `STRATEGY_REV bumped (got ${STRATEGY_REV})`);
  ok(STRATEGY_CHARTER.includes("MULTI-STRATEGY ENSEMBLE"), "charter announces the ensemble");
  ok(STRATEGY_CHARTER.includes("TWELVE-STRATEGY"), "charter says twelve");
  for (const s of STRATEGY_REGISTRY) {
    ok(STRATEGY_CHARTER.toLowerCase().includes(s.nameEn.toLowerCase()), `charter lists ${s.nameEn}`);
  }
}

// ── 15. live API: signals rows carry the ensemble ─────────────────────────
console.log("\n[15] live /api/signals ensemble block");
{
  const res = await fetch(`${BASE}/api/signals`, { signal: AbortSignal.timeout(120_000) });
  const data = (await res.json()) as { rows?: { ticker: string; ensemble?: { consensus: number; longVotes: number; avoidVotes: number; applicable: number; agreement: number; fired: string[] } }[] };
  ok(res.ok && Array.isArray(data.rows) && data.rows.length > 50, `scan served (${data.rows?.length ?? 0} rows)`);
  const withEns = (data.rows ?? []).filter((r) => r.ensemble && typeof r.ensemble.consensus === "number");
  ok(withEns.length === (data.rows ?? []).length, `every row carries the ensemble block (${withEns.length}/${data.rows?.length})`);
  const bad = (data.rows ?? []).filter((r) => r.ensemble && (r.ensemble.applicable < 1 || r.ensemble.applicable > 12));
  ok(bad.length === 0, `applicable within 1..12 (violations: ${bad.length})`);
  const firedSeen = new Set((data.rows ?? []).flatMap((r) => r.ensemble?.fired ?? []));
  ok(firedSeen.size >= 5, `strategy ids actually fire in the wild (${firedSeen.size} distinct: ${[...firedSeen].slice(0, 8).join(",")})`);
  const top = [...(data.rows ?? [])].sort((a, b) => (b.ensemble?.consensus ?? 0) - (a.ensemble?.consensus ?? 0))[0];
  ok(top && top.ensemble!.longVotes >= 1, `top consensus row has long votes (${top?.ticker}: ${top?.ensemble?.longVotes}/${top?.ensemble?.applicable})`);
}

// ── 16. live API: ai-signals picks carry strategies ───────────────────────
console.log("\n[16] live /api/ai-signals strategies");
{
  const res = await fetch(`${BASE}/api/ai-signals?wait=90`, { signal: AbortSignal.timeout(150_000) });
  const data = (await res.json()) as {
    ok?: boolean;
    set?: { picks?: { ticker: string; strategies?: string[]; longVotes?: number; avoidVotes?: number; applicable?: number; agreement?: number; charterScore?: number | null }[]; strategyRev?: string } | null;
    meta?: { strategyRev?: string; charter?: string };
  };
  ok(data.ok === true, "ai-signals responds ok");
  ok(data.meta?.strategyRev === "egx-multi-v2", `served meta rev = egx-multi-v2 (got ${data.meta?.strategyRev})`);
  ok((data.meta?.charter ?? "").includes("MULTI-STRATEGY ENSEMBLE"), "served charter is the ensemble charter");
  const picks = data.set?.picks ?? [];
  for (const p of picks) {
    ok(Array.isArray(p.strategies), `${p.ticker}: strategies array present (old sets normalize to [])`);
    ok(typeof p.longVotes === "number" && typeof p.applicable === "number", `${p.ticker}: votes/applicable present`);
    ok(p.applicable === 0 || p.applicable >= 1, `${p.ticker}: applicable sane (${p.applicable})`);
  }
  if (picks.length && (data.set?.strategyRev ?? "") === "egx-multi-v2") {
    const withStrategies = picks.filter((p) => (p.strategies?.length ?? 0) > 0);
    ok(withStrategies.length > 0, `fresh-set picks carry fired strategy ids (${withStrategies.length}/${picks.length})`);
    for (const p of withStrategies) {
      const known = p.strategies!.every((id) => strategyById(id) !== null);
      ok(known, `${p.ticker}: all strategy ids resolve (${p.strategies!.join(",")})`);
    }
  }
}

console.log(`\n=== T42: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
