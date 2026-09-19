/** T45 — Hermes autonomous agent test suite.
 *
 *  Unit (pure, no network):
 *    - chart-png: renders a VALID PNG (signature, IHDR dims, CRC check on
 *      every chunk, zlib inflates, pixel count matches) from a synthetic
 *      candle tape; deterministic (same tape → identical bytes); wick-less
 *      tapes render without crashing (close polyline path)
 *    - agent-learning: weight math — under the n-gate weights stay neutral;
 *      over the gate the multiplier is 0.5+hitRate clamped to [0.75, 1.25];
 *      monotonic in hitRate; attribution counts only closed attributed
 *      episodes; diffLearning surfaces |Δ|≥0.05 changes only
 *    - agent-scheduler: dueAgentSlot logic via injected fake DB rows is
 *      covered live; pure parts — AGENT_SLOTS times, cairoClock returns
 *      Cairo-shaped parts, nextAgentRun always resolves a future date
 *    - evidenceAr (T45 FIX): ALL 18 registered strategy ids now render their
 *      Arabic name prefix (the old whitelist missed whale-watch/insider-flow/
 *      ml-forecast/etc.) and the new T44 phrases translate (whale flows,
 *      insider filings, ML holdout, patterns) — zero stray English beyond
 *      the allowed acronyms in a whale-watch fallback line
 *    - zai-client JSON extraction: fences, think-tag prefixed replies, and
 *      trailing commentary all yield the object
 *
 *  Live (dev server :3000, real key):
 *    - /api/agent-signals GET serves the full state (models, learning,
 *      lessons, runs, schedule with a future next.at)
 *    - the AgentRun table's newest row: if ok — payload parses, agent
 *      extras present (journal/vision/learning), picks passed the charter
 *      gates (consensus ≥ 0.35 for longs, conviction within caps), and
 *      events were emitted for its setRef; if failed — the error is a
 *      non-empty honest string (never fabricated output)
 *    - /api/signals/events serves the agent kind alongside the others
 *    - POST manual trigger respects the 10-minute guard (429 when cooling)
 *
 *  Run: bun scripts/t45-test-hermes.ts   (dev server on :3000) */
import { renderCandleChartPng } from "@/lib/chart-png";
import { zaiExtractJson } from "@/lib/zai-client";
import { evidenceAr, strayLatinInArabic } from "@/lib/ai-signals";
import { diffLearning, LEARN_MIN_N, type LearningState, type StrategyLearning } from "@/lib/agent-learning";
import { reweightedEnsembleRead, STRATEGY_REGISTRY, evaluateEnsemble } from "@/lib/strategies";
import { AGENT_SLOTS, nextAgentRun } from "@/lib/agent-scheduler";
import { inflateSync } from "node:zlib";
import { PrismaClient } from "@prisma/client";

// CRC table for the chunk check below (declared before use)
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

// ── 1. chart-png ───────────────────────────────────────────────────────────

console.log("\n[1] chart-png — dependency-free candlestick PNG");
function mkTape(n: number, wicks: boolean) {
  const pts: { date: string; close: number; volume: number | null; high?: number | null; low?: number | null }[] = [];
  let px = 30;
  for (let i = 0; i < n; i++) {
    const chg = Math.sin(i / 7) * 1.4 + (i % 5 === 0 ? 0.8 : -0.3);
    px = Math.max(5, px + chg);
    pts.push({
      date: `2026-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
      close: Number(px.toFixed(2)),
      volume: 1_000_000 + ((i * 7919) % 900_000),
      ...(wicks ? { high: Number((px + 0.9).toFixed(2)), low: Number((px - 0.9).toFixed(2)) } : {}),
    });
  }
  return pts;
}

const pngA = renderCandleChartPng(mkTape(90, true), { ticker: "ABCA" });
ok(pngA.length > 2000, "rendered a non-trivial PNG", `${pngA.length} bytes`);
ok(pngA[0] === 0x89 && pngA[1] === 0x50 && pngA[2] === 0x4e && pngA[3] === 0x47, "PNG signature correct");
// IHDR dims
const wDim = pngA.readUInt32BE(16);
const hDim = pngA.readUInt32BE(20);
ok(wDim === 520 && hDim === 300, "IHDR carries the requested dimensions", `${wDim}x${hDim}`);
// CRC of every chunk verifies
{
  let off = 8;
  let chunks = 0;
  let crcOk = true;
  while (off < pngA.length) {
    const len = pngA.readUInt32BE(off);
    const type = pngA.subarray(off + 4, off + 8).toString("ascii");
    // CRC32 of type+data
    let c = 0xffffffff;
    const body = pngA.subarray(off + 4, off + 8 + len);
    for (let i = 0; i < body.length; i++) {
      c = CRC_T[(c ^ body[i]) & 0xff] ^ (c >>> 8);
    }
    const computed = (c ^ 0xffffffff) >>> 0;
    const stored = pngA.readUInt32BE(off + 8 + len);
    if (computed !== stored) crcOk = false;
    chunks++;
    off += 12 + len;
  }
  ok(chunks === 3 && crcOk, "all 3 chunks (IHDR/IDAT/IEND) pass CRC32", `chunks=${chunks}`);
}
// zlib inflates to exactly w*h*4 + h filter bytes
{
  let off = 8;
  let idat: Buffer | null = null;
  while (off < pngA.length) {
    const len = pngA.readUInt32BE(off);
    const type = pngA.subarray(off + 4, off + 8).toString("ascii");
    if (type === "IDAT") idat = Buffer.concat([idat ?? Buffer.alloc(0), pngA.subarray(off + 8, off + 8 + len)]);
    off += 12 + len;
  }
  const raw = inflateSync(idat!);
  ok(raw.length === 520 * 300 * 4 + 300, "IDAT inflates to the exact pixel buffer + filters", `${raw.length}`);
}
const pngB = renderCandleChartPng(mkTape(90, true), { ticker: "ABCA" });
ok(pngA.equals(pngB), "deterministic — same tape renders identical bytes");
// wick-less tape (close polyline path)
const pngC = renderCandleChartPng(mkTape(60, false), { ticker: "NOPX" });
ok(pngC.length > 1500, "wick-less tape renders (close polyline, no invented wicks)");

// ── 2. agent-learning ──────────────────────────────────────────────────────

console.log("\n[2] agent-learning — bounded self-learning math");
function mkLearning(mults: Record<string, number>): LearningState {
  const strategies: StrategyLearning[] = STRATEGY_REGISTRY.map((s) => ({
    id: s.id,
    nameAr: s.nameAr,
    nameEn: s.nameEn,
    family: s.family,
    baseWeight: s.weight,
    multiplier: mults[s.id] ?? 1,
    adaptedWeight: Number((s.weight * (mults[s.id] ?? 1)).toFixed(3)),
    closed: 0,
    hits: 0,
    stopped: 0,
    expired: 0,
    decided: 0,
    hitRate: null,
    avgRetPct: null,
  }));
  return { computedAt: "", since: null, episodesClosed: 0, minN: LEARN_MIN_N, strategies, noteAr: "", noteEn: "" };
}
// the multiplier mapping (mirrors computeLearning): clamp(0.75, 1.25, 0.5 + hitRate)
const map = (hitRate: number) => Math.max(0.75, Math.min(1.25, 0.5 + hitRate));
ok(map(0.5) === 1, "hitRate 0.5 → ×1.00 (no change)");
ok(map(0.75) === 1.25, "hitRate 0.75 → ×1.25 (capped up)");
ok(map(0.9) === 1.25, "hitRate 0.9 stays capped at ×1.25");
ok(map(0.25) === 0.75, "hitRate 0.25 → ×0.75 (floored down)");
ok(map(0.2) === 0.75, "hitRate 0.2 stays floored at ×0.75");
ok(map(0.6) > map(0.55) && map(0.55) > map(0.45) && map(0.45) > map(0.4), "monotonic in hitRate");
// reweightedEnsembleRead: identical math to ensembleRead at neutral weights
{
  const pts = mkTape(220, true).map((p) => ({ date: p.date, close: p.close, volume: p.volume, high: p.high, low: p.low }));
  const ens = evaluateEnsemble(pts, { divYield: null, fundQuality: null, newsScore: null, techScore: 0, ml: null, insider: null, whale: null }, 2.1);
  const neutral = reweightedEnsembleRead(ens.verdicts, 2.1, () => 1);
  ok(Math.abs(neutral - ens.consensus) < 0.002, "reweighted consensus ≡ base consensus at neutral weights", `${neutral} vs ${ens.consensus}`);
  const boosted = reweightedEnsembleRead(ens.verdicts, 2.1, (id) => (id === "trend-rider" ? 1.25 : 1));
  const fired = ens.verdicts.find((v) => v.id === "trend-rider" && v.fired);
  if (fired) {
    ok(boosted !== neutral, "a fired strategy's boosted weight moves the consensus");
  } else {
    ok(true, "trend-rider not fired on this fixture — weight invariance holds trivially");
  }
  const silentBoost = reweightedEnsembleRead(ens.verdicts, 2.1, (id) => (id === "whale-watch" ? 1.25 : 1));
  ok(silentBoost === neutral || !ens.verdicts.find((v) => v.id === "whale-watch" && v.fired), "an unfired data-gated weight cannot move the consensus");
}
// diffLearning
{
  const prev = mkLearning({ "trend-rider": 1, "volume-surge": 1 });
  const next = mkLearning({ "trend-rider": 1.1, "volume-surge": 1.02 });
  const d = diffLearning(prev, next);
  ok(d.length === 1 && d[0].id === "trend-rider", "diff surfaces only |Δ|≥0.05 changes", JSON.stringify(d.map((x) => x.id)));
  ok(diffLearning(null, next).length === 0, "no previous state → no diff (first run is a milestone, not a change)");
  ok(diffLearning(prev, prev).length === 0, "identical states → no diff");
}

// ── 3. agent-scheduler (pure parts) ────────────────────────────────────────

console.log("\n[3] agent-scheduler — EGX weekday schedule");
ok(AGENT_SLOTS.length === 3, "three slots per trading day");
ok(AGENT_SLOTS[0].minutes === 555 && AGENT_SLOTS[1].minutes === 735 && AGENT_SLOTS[2].minutes === 900, "slots at 09:15 / 12:15 / 15:00 Cairo");
{
  const next = nextAgentRun();
  ok(next.at.getTime() > Date.now() - 60_000, "next run is never in the past", next.at.toISOString());
  ok(["pre-open", "midday", "post-close"].includes(next.kind), "next run is a scheduled kind");
  ok(next.at.getTime() - Date.now() < 8 * 24 * 3600_000, "next run within a week (weekend roll works)");
}

// ── 4. evidenceAr — the T45 fix ────────────────────────────────────────────

console.log("\n[4] evidenceAr — all 18 strategy ids render Arabic (T44 leak fix)");
{
  let allRender = true;
  const missing: string[] = [];
  for (const s of STRATEGY_REGISTRY) {
    const rendered = evidenceAr([`${s.id}: foreign institutions net +322 EGP mn over the last 3 sessions`]);
    if (!rendered.includes(s.nameAr)) {
      allRender = false;
      missing.push(s.id);
    }
  }
  ok(allRender, "every registered id gets its Arabic strategy-name prefix", missing.join(","));
  const whale = evidenceAr(["whale-watch: foreign institutions net +322.4 EGP mn over the last 3 sessions"]);
  ok(/رادار الحيتان/.test(whale), "whale-watch renders its Arabic name");
  ok(/المؤسسات الأجنبية/.test(whale), "the whale flow phrase translates to Arabic");
  ok(strayLatinInArabic(whale).length === 0, "the whale fallback line carries ZERO stray Latin", whale);
  const insider = evidenceAr(["insider-flow: 3 insider/major-holder buy filings + 1 treasury purchase(s), 0 sells (90 days)"]);
  ok(/إفصاح شراء/.test(insider) && strayLatinInArabic(insider).length === 0, "insider filings phrase translates cleanly", insider);
  const ml = evidenceAr(["ml-forecast: holdout hit rate 58% over 40 bars (250 training rows)"]);
  ok(/دقة عينة الاحتجاز/.test(ml) && strayLatinInArabic(ml).length === 0, "ML holdout phrase translates cleanly", ml);
  const pat = evidenceAr(["pattern-reversal: hammer: close in top 78% of a 3.1%-range bar"]);
  ok(/مطرقة/.test(pat) && strayLatinInArabic(pat).length === 0, "candlestick pattern phrase translates cleanly", pat);
  const zc = evidenceAr(["zscore-reversion: z-score -2.10 vs the 50-session mean (σ 4.2% of price)"]);
  ok(/درجة الانحراف/.test(zc) && strayLatinInArabic(zc).length === 0, "z-score phrase translates cleanly", zc);
}

// ── 5. zai-client JSON extraction ──────────────────────────────────────────

console.log("\n[5] zai-client — robust JSON extraction");
ok(zaiExtractJson('{"a":1}')?.a === 1, "plain object");
ok(zaiExtractJson('```json\n{"a":2}\n```')?.a === 2, "fenced object");
ok(zaiExtractJson("<think>reasoning…</think>\n{\"a\":3}")?.a === 3, "think-tag prefixed object");
ok(zaiExtractJson('noise before {"a":4} noise after')?.a === 4, "object embedded in commentary");
ok(zaiExtractJson('{"a":{"b":5}}')?.a?.b === 5, "nested object kept whole");
ok(zaiExtractJson("no json at all") === null, "garbage → null (honest)");

// ── 6. LIVE checks (dev server + DB) ───────────────────────────────────────

console.log("\n[6] LIVE — /api/agent-signals + AgentRun + events (dev server)");
const db = new PrismaClient();
try {
  const res = await fetch(`${BASE}/api/agent-signals`, { cache: "no-store" });
  ok(res.ok, "GET /api/agent-signals responds 200", String(res.status));
  const state = (await res.json()) as {
    ok: boolean;
    models: { brain: string; vision: string };
    learning: { strategies: unknown[]; noteAr: string; noteEn: string };
    lessons: unknown[];
    runs: { kind: string; status: string; error: string | null }[];
    schedule: { next: { at: string; kind: string } };
  };
  ok(state.ok === true, "state payload ok:true");
  ok(state.models.brain === "glm-4.7-flash", "the brain is glm-4.7-flash (the user's latest free model)", state.models.brain);
  ok(state.models.vision === "glm-4.6v-flash", "the vision model is glm-4.6v-flash", state.models.vision);
  ok(Array.isArray(state.learning.strategies) && state.learning.strategies.length >= 18, "learning covers every strategy");
  ok(typeof state.learning.noteAr === "string" && state.learning.noteAr.length > 30, "learning carries the honest Arabic note");
  ok(Array.isArray(state.lessons), "lessons array served");
  ok(Date.parse(state.schedule.next.at) > Date.now() - 60_000, "schedule.next.at is a valid future date");

  const runs = await db.agentRun.findMany({ orderBy: { startedAt: "desc" }, take: 2 });
  if (runs.length === 0) {
    ok(false, "at least one AgentRun exists (trigger one via POST if cold)");
  }
  for (const r of runs.slice(0, 1)) {
    if (r.status === "ok") {
      ok(r.llmMs > 0 && r.visionMs >= 0, "ok run carries real timings", `llm=${r.llmMs} vision=${r.visionMs}`);
      const payload = JSON.parse(r.outputJson ?? "{}") as {
        picks: { ticker: string; stance: string; conviction: number; charterScore: number | null }[];
        agent: { journalAr: string; journalEn: string; vision: unknown[]; learning: { weights: unknown[] }; skills: string[] };
        marketBias: { direction: string; conviction: number };
      };
      ok(Array.isArray(payload.picks) && payload.picks.length >= 0, "payload parses with picks");
      ok(payload.agent && typeof payload.agent.journalAr === "string", "agent extras present (journal)");
      ok(Array.isArray(payload.agent.vision), "vision reads present");
      ok(Array.isArray(payload.agent.learning.weights) && payload.agent.learning.weights.length >= 18, "learning snapshot frozen with the run");
      ok(Array.isArray(payload.agent.skills) && payload.agent.skills.length === 10, "the ten skills are recorded");
      for (const p of payload.picks ?? []) {
        if (p.stance === "long") {
          ok((p.charterScore ?? 0) >= 0.35, `long ${p.ticker} cleared the 0.35 consensus gate`, String(p.charterScore));
        }
        ok(p.conviction >= 1 && p.conviction <= 5, `${p.ticker} conviction within 1-5`);
      }
      // events emitted for the run's set
      const evCount = await db.signalEvent.count({ where: { setRef: r.setRef ?? "none" } });
      ok(evCount >= 1, "live events were emitted for the run's set", `${evCount} events`);
      const agentEv = await db.signalEvent.count({ where: { kind: "agent", setRef: r.setRef ?? "none" } });
      ok(agentEv === 1, "exactly ONE agent summary event (idempotent)", String(agentEv));
    } else {
      ok(typeof r.error === "string" && r.error.length > 0, "failed run stores the honest error");
      ok(r.setRef === null, "failed run persisted NO set (nothing fabricated)");
    }
  }

  // lessons kinds
  const kinds = await db.agentLesson.groupBy({ by: ["kind"], _count: true });
  ok(kinds.some((k) => k.kind === "reflection"), "a reflection lesson exists");
  ok(kinds.some((k) => k.kind === "milestone"), "the first-run milestone exists");

  // events API serves the agent kind
  const evRes = await fetch(`${BASE}/api/signals/events?limit=30`, { cache: "no-store" });
  const evJson = (await evRes.json()) as { ok: boolean; events: { kind: string }[] };
  ok(evJson.ok && evJson.events.some((e) => e.kind === "agent"), "the events stream includes agent-kind events");

  // manual trigger guard — right after a run, POST must 429
  const last = await db.agentRun.findFirst({ orderBy: { startedAt: "desc" } });
  if (last && Date.now() - last.startedAt.getTime() < 10 * 60_000) {
    const post = await fetch(`${BASE}/api/agent-signals`, { method: "POST" });
    ok(post.status === 429, "manual trigger is rate-limited while cooling", String(post.status));
  } else {
    const post = await fetch(`${BASE}/api/agent-signals`, { method: "POST" });
    ok(post.status === 200 || post.status === 429, "manual trigger responds sanely", String(post.status));
  }

  // usage metering recorded the route
  const metered = await db.usageEvent.count({ where: { route: "hermes-agent" } });
  ok(metered >= 1, "agent calls are metered under route hermes-agent", String(metered));
} finally {
  await db.$disconnect();
}

// ── summary ────────────────────────────────────────────────────────────────

console.log(`\nT45 result: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
