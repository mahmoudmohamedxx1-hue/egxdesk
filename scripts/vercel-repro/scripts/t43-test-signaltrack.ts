/** T43 — Signal track record + trade-plan test suite.
 *
 *  Unit (pure, no network):
 *    - tradePlan(): ATR spine — entry zone brackets the entry, stop = entry−2ATR,
 *      t1/t2/t3 = +2/+3/+4.5 ATR, target === t2, riskPct math, price-adaptive
 *      decimals, SMA20-dip entry rule
 *    - planFromLegacy(): rebuilds the SAME ladder from a persisted
 *      entry/stop/target triple (ATR exactly recoverable)
 *    - classifyEpisode(): outcome classification over synthetic candle paths —
 *      target-before-stop wins on ORDER not magnitude; stopped-first; partial
 *      T1 touch recorded; expiry past the horizon grace; open inside horizon;
 *      post-close issue excludes the issue-day candle, intraday issue
 *      includes it; no forward prints ⇒ null (pending)
 *    - buildEpisodes(): consecutive sets = ONE episode with the plan frozen
 *      at issue; a >72h absence splits a NEW episode; avoids never tracked
 *
 *  Live (dev server :3000):
 *    - /api/ai-signals serves trackRecord (pending+evaluated+skipped ≥ 0,
 *      never undefined keys) and every long pick carries a well-formed plan
 *      (zoneLo ≤ entry ≤ zoneHi, t1 < t2 < t3, riskPct > 0); avoids carry
 *      plan null
 *    - legacy persisted sets (pre-T43 rows in SQLite) normalize to a plan
 *
 *  Run: bun scripts/t43-test-signaltrack.ts   (dev server on :3000) */
import { tradePlan, planFromLegacy, type StrategyFeatures } from "@/lib/strategy";
import {
  classifyEpisode,
  buildEpisodes,
  type Episode,
  type SetRow,
} from "@/lib/signal-track";
import type { ChartPoint } from "@/lib/history";

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

// ── fixtures ───────────────────────────────────────────────────────────────

function mkFeatures(over: Partial<StrategyFeatures>): StrategyFeatures {
  return {
    ticker: "TEST",
    close: 100,
    trend: 0.5,
    momentum: 0.4,
    volumeC: 0.3,
    position52: 0.5,
    pullback: 0.5,
    atrPct: 4, // ATR = 4.0 abs on a 100 close
    volRatio20: 1.2,
    rsi: 55,
    macdHist: 0.5,
    sma20: 90, // far below — the dip rule must NOT fire, entry = close
    sma50: 97,
    sma200: 90,
    pos52: 70,
    belowHigh20Pct: 4,
    score: 0.6,
    evidence: [],
    ...over,
  } as StrategyFeatures;
}

function candles(dates: string[], closes: number[]): ChartPoint[] {
  return dates.map((date, i) => ({ date, close: closes[i], volume: 1000 }));
}

function episode(over: Partial<Episode>): Episode {
  return {
    ticker: "TEST",
    issuedAt: new Date("2026-09-10T18:00:00Z"), // 21:00 Cairo — after close
    issuedDate: "2026-09-10",
    afterClose: true,
    conviction: 4,
    entry: 100,
    stop: 92, // 2×ATR with ATR=4
    target: 112, // 3×ATR
    t1: 108, // 2×ATR
    hasLadder: true,
    horizon: 10,
    lastSeen: new Date("2026-09-10T18:00:00Z"),
    ...over,
  } as Episode;
}

// ── 1. tradePlan math ──────────────────────────────────────────────────────

console.log("\n[1] tradePlan — the ATR spine");
{
  const p = tradePlan(mkFeatures({}));
  ok(p !== null, "plan computed for a normal feature set");
  if (p) {
    // ATR=4 → stop 92, t1 108, t2 112, t3 118, zone 98.6–101.4
    ok(p.entry === 100, `entry = close when SMA20 dip is not within 1 ATR (got ${p.entry})`);
    ok(p.stop === 92, `stop = entry − 2×ATR (got ${p.stop})`);
    ok(p.t1 === 108, `t1 = entry + 2×ATR (got ${p.t1})`);
    ok(p.t2 === 112, `t2 = entry + 3×ATR (got ${p.t2})`);
    ok(p.t3 === 118, `t3 = entry + 4.5×ATR (got ${p.t3})`);
    ok(p.target === p.t2, "target === t2 (compat: the legacy field carries the 1.5R rung)");
    ok(p.zoneLo === 98.6 && p.zoneHi === 101.4, `zone = entry ± 0.35×ATR (got ${p.zoneLo}–${p.zoneHi})`);
    ok(p.zoneLo < p.entry && p.entry < p.zoneHi, "the entry sits inside its own zone");
    ok(Math.abs(p.riskPct - 8) < 0.01, `riskPct = riskLeg/entry (got ${p.riskPct})`);
    ok(Math.abs(p.rr - 1.5) < 0.01, `rr computed from the ROUNDED levels ≈ 1.5 (got ${p.rr})`);
    ok(p.t1 < p.t2 && p.t2 < p.t3, "the ladder is strictly increasing");
    ok(p.stop < p.zoneLo, "the stop sits below the entry zone");
  }
  // SMA20 dip rule: sma20 within 1 ATR below close → entry = sma20
  const dip = tradePlan(mkFeatures({ sma20: 97.5 }));
  ok(dip !== null && dip.entry === 97.5, "SMA20 within 1 ATR below close ⇒ entry = SMA20");
  // low-priced name keeps more decimals (T37 discipline)
  const cheap = tradePlan(mkFeatures({ close: 0.6, atrPct: 7, sma20: 0.55 }));
  ok(
    cheap !== null && Number.isFinite(cheap.stop) && (cheap.stop! * 10000) % 1 === 0,
    "low-priced name keeps 4dp so rounding stays ≪ the risk leg"
  );
  // degenerate ATR → null
  ok(tradePlan(mkFeatures({ atrPct: 0 })) === null, "atrPct 0 ⇒ plan null (no division hazards)");
}

// ── 2. planFromLegacy — rebuild from a persisted triple ────────────────────

console.log("\n[2] planFromLegacy — deterministic rebuild");
{
  // entry 100, stop 92, target 112 ⇒ riskLeg 8 = 2×ATR ⇒ ATR 4
  const lp = planFromLegacy(100, 92, 112);
  const fresh = tradePlan(mkFeatures({}));
  ok(lp.t1 === fresh!.t1, `legacy t1 matches the live engine (${lp.t1} vs ${fresh!.t1})`);
  ok(lp.t2 === fresh!.t2 && lp.t3 === fresh!.t3, "legacy t2/t3 match the live engine");
  ok(lp.zoneLo === fresh!.zoneLo && lp.zoneHi === fresh!.zoneHi, "legacy zone matches the live engine");
  ok(Math.abs(lp.riskPct - fresh!.riskPct) < 0.01, "legacy riskPct matches the live engine");
  // a GSSC-style real persisted triple: entry 319.37 stop 290.8 target 362.23
  const g = planFromLegacy(319.37, 290.8, 362.23);
  ok(g.t1 === 347.94 && g.t3 === 383.65, `GSSC triple rebuilds t1/t3 exactly (${g.t1}/${g.t3})`);
  ok(g.t2 === 362.23, "GSSC t2 stays the persisted target (never invented)");
}

// ── 3. classifyEpisode — outcome classification ────────────────────────────

console.log("\n[3] classifyEpisode — real-path outcomes");
{
  // (a) target before stop — order matters, not magnitude
  const a = classifyEpisode(
    episode({}),
    candles(["2026-09-11", "2026-09-14", "2026-09-15"], [104, 113, 95])
  );
  ok(a !== null && a.status === "target", "a close ≥ target BEFORE any stop close ⇒ target");
  ok(a!.endedDate === "2026-09-14", "endedDate is the resolving session");
  // the later 95 stop-close must NOT flip it
  ok(a!.status === "target", "a stop AFTER resolution is ignored (no lookahead rewrite)");

  // (b) stopped first
  const b = classifyEpisode(
    episode({}),
    candles(["2026-09-11", "2026-09-14"], [95, 91])
  );
  ok(b !== null && b.status === "stopped", "a close ≤ stop first ⇒ stopped");

  // (c) partial T1 touch, then stopped — the partial flag survives
  const c = classifyEpisode(
    episode({}),
    candles(["2026-09-11", "2026-09-14", "2026-09-15"], [108.5, 106, 90])
  );
  ok(c !== null && c.status === "stopped" && c.partialT1, "touched T1 then stopped ⇒ stopped + partialT1");

  // (d) open inside the horizon
  const d = classifyEpisode(
    episode({}),
    candles(["2026-09-11", "2026-09-14"], [102, 104])
  );
  ok(d !== null && d.status === "open" && d.sessionsElapsed === 2, "no resolution inside horizon ⇒ open with session count");
  ok(d!.bestPct === 4 && d!.worstPct === 2, "best/worst excursion computed vs entry");

  // (e) expiry: > horizon×1.5 forward prints with no resolution
  const dates: string[] = [];
  const closes: number[] = [];
  let day = new Date("2026-09-11T00:00:00Z");
  for (let i = 0; i < 16; i++) {
    do {
      day = new Date(day.getTime() + 24 * 3600_000);
    } while (day.getUTCDay() === 5 || day.getUTCDay() === 6); // EGX Fri/Sat off
    dates.push(day.toISOString().slice(0, 10));
    closes.push(100 + Math.sin(i) * 2); // oscillates, never resolves
  }
  const e = classifyEpisode(episode({}), candles(dates, closes));
  ok(e !== null && e.status === "expired", "16 prints > 10×1.5 grace with no resolution ⇒ expired");

  // (f) post-close issue: the issue-day candle is NOT a forward print
  const f = classifyEpisode(
    episode({ issuedDate: "2026-09-10", afterClose: true }),
    candles(["2026-09-10", "2026-09-11"], [105, 101])
  );
  ok(f !== null && f.sessionsElapsed === 1 && f.retPct === 1, "post-close issue excludes the issue-day candle");

  // (g) intraday issue: the issue-day candle IS the first forward print
  const g2 = classifyEpisode(
    episode({ issuedDate: "2026-09-10", afterClose: false }),
    candles(["2026-09-10", "2026-09-11"], [105, 101])
  );
  ok(g2 !== null && g2.sessionsElapsed === 2, "intraday issue includes the issue-day candle");

  // (h) no forward prints ⇒ null (pending, never a guess)
  ok(classifyEpisode(episode({}), candles(["2026-09-09"], [99])) === null, "no forward print ⇒ null (pending)");
}

// ── 4. buildEpisodes — grouping and freezing ───────────────────────────────

console.log("\n[4] buildEpisodes — grouping and freezing");
{
  const mk = (iso: string, picks: unknown[]) => ({
    createdAt: new Date(iso),
    data: JSON.stringify({ picks }),
  });
  // three consecutive sets (45-min cycles) carrying the same pick → ONE episode
  const rows: SetRow[] = [
    mk("2026-09-10T18:00:00Z", [{ ticker: "ALCN", stance: "long", conviction: 3, entry: 100, stop: 92, target: 112 }]),
    mk("2026-09-10T18:45:00Z", [{ ticker: "ALCN", stance: "long", conviction: 4, entry: 101, stop: 93, target: 113 }]),
    mk("2026-09-10T19:30:00Z", [{ ticker: "ALCN", stance: "long", conviction: 5, entry: 102, stop: 94, target: 114 }]),
  ];
  const eps = buildEpisodes(rows);
  ok(eps.length === 1, "consecutive sets collapse into ONE episode");
  ok(eps[0].entry === 100 && eps[0].conviction === 3, "the plan and conviction freeze at the FIRST set");
  // >72h gap splits episodes
  const rows2: SetRow[] = [
    mk("2026-09-08T18:00:00Z", [{ ticker: "X", stance: "long", conviction: 3, entry: 50, stop: 46, target: 56 }]),
    mk("2026-09-15T18:00:00Z", [{ ticker: "X", stance: "long", conviction: 4, entry: 55, stop: 51, target: 61 }]),
  ];
  const eps2 = buildEpisodes(rows2);
  ok(eps2.length === 2, "a >72h absence ⇒ TWO episodes (re-arm)");
  ok(eps2[1].entry === 55, "the second episode carries the SECOND plan");
  // avoids are never tracked
  const rows3: SetRow[] = [mk("2026-09-10T18:00:00Z", [{ ticker: "Y", stance: "avoid", conviction: 3 }])];
  ok(buildEpisodes(rows3).length === 0, "avoid picks never open episodes");
  // a pick with missing levels is skipped honestly
  const rows4: SetRow[] = [mk("2026-09-10T18:00:00Z", [{ ticker: "Z", stance: "long", conviction: 3, entry: null, stop: null, target: null }])];
  ok(buildEpisodes(rows4).length === 0, "a long without levels never opens an episode");
  // ladder t1 read from the persisted plan block (T43 shape)
  const rows5: SetRow[] = [
    mk("2026-09-10T18:00:00Z", [
      { ticker: "W", stance: "long", conviction: 3, entry: 100, stop: 92, target: 112, plan: { zoneLo: 98.6, zoneHi: 101.4, t1: 108, t2: 112, t3: 118, riskPct: 8 } },
    ]),
  ];
  const eps5 = buildEpisodes(rows5);
  ok(eps5.length === 1 && eps5[0].t1 === 108 && eps5[0].hasLadder, "t1 is read from the persisted plan block");
}

// ── 5. live API ────────────────────────────────────────────────────────────

console.log("\n[5] live /api/ai-signals");
{
  const res = await fetch(`${BASE}/api/ai-signals?wait=0`);
  ok(res.ok, `endpoint responds (${res.status})`);
  const d = (await res.json()) as {
    status?: string;
    set?: { picks?: { ticker: string; stance: string; entry: number | null; stop: number | null; target: number | null; plan: { zoneLo: number; zoneHi: number; t1: number; t2: number; t3: number; riskPct: number } | null }[] } | null;
    trackRecord?: { summary?: Record<string, unknown>; signals?: unknown[] } | null;
  };
  ok(d.set !== null && Array.isArray(d.set?.picks), "a set is served");
  const longs = (d.set?.picks ?? []).filter((p) => p.stance === "long");
  ok(longs.length > 0, "at least one long pick is served");
  for (const p of longs) {
    const q = p.plan;
    ok(
      q !== null &&
        q.zoneLo <= (p.entry ?? 0) && (p.entry ?? 0) <= q.zoneHi &&
        q.t1 < q.t2 && q.t2 < q.t3 &&
        q.riskPct > 0 && q.riskPct < 25 &&
        q.t2 === p.target,
      `${p.ticker}: well-formed plan (zone brackets entry, ladder increasing, riskPct sane, t2 === target)`
    );
  }
  const avoids = (d.set?.picks ?? []).filter((p) => p.stance === "avoid");
  for (const p of avoids) {
    ok(p.plan === null && p.entry === null, `${p.ticker}: avoid carries no levels (charter)`);
  }
  const tr = d.trackRecord;
  ok(tr !== null, "trackRecord is served (never undefined)");
  if (tr?.summary) {
    const s = tr.summary;
    const keys = ["tracked", "evaluated", "pending", "skipped", "hits", "stopped", "expired", "open"];
    ok(keys.every((k) => typeof s[k] === "number"), "summary counters are all defined numbers");
    ok(
      (s.tracked as number) === ((tr.signals ?? []) as unknown[]).length,
      "tracked === signals.length (no hidden rows)"
    );
    ok(
      (s.evaluated as number) + (s.pending as number) + (s.skipped as number) >= (s.tracked as number),
      "every episode is accounted for (evaluated + pending + skipped)"
    );
  }
}

// ── summary ────────────────────────────────────────────────────────────────

console.log(`\nT43 result: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
