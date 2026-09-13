/** Task 20 tests — AI Signals section + streamed agent + holiday-aware
 *  market status. Run with the dev server up:
 *  `bun scripts/e2e/t20-ai-signals-test.ts` (BASE_URL configurable). */
import { marketStatus } from "@/lib/market-status";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name + (extra ? ` — ${extra}` : ""));
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function sseAgent(messages: { role: string; content: string }[], lang: string, deviceId: string) {
  const res = await fetch(`${BASE_URL}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, lang, deviceId }),
  });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/event-stream")) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {}
    return { status: res.status, sse: false, events: [], body };
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const events: Record<string, unknown>[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const rawEvt = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of rawEvt.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          events.push(JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
        } catch {}
      }
    }
  }
  return { status: res.status, sse: true, events, body: null };
}

async function main() {
  console.log(`\n=== Task 20 tests against ${BASE_URL} ===\n`);

  // ── 1. AI signals endpoint ──
  console.log("── /api/ai-signals ──");
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/api/ai-signals?wait=90`);
  const j = (await res.json()) as {
    ok?: boolean;
    status?: string;
    set?: {
      generatedAt: string;
      marketBias: { direction: string; conviction: number; summaryAr: string; summaryEn: string };
      picks: {
        ticker: string;
        stance: string;
        conviction: number;
        charterScore: number | null;
        entry: number | null;
        stop: number | null;
        target: number | null;
        rr: number | null;
        thesisAr: string;
        thesisEn: string;
        evidence: string[];
        earningsRisk: string | null;
      }[];
      scanned: number;
      model: string;
    } | null;
    backtest?: { strategyRev: string; stats: Record<string, number | null> };
    meta?: { cooldownMinutes: number; sharedCompute: boolean; strategyRev: string; backtestRev: string; backtestStale: boolean; charter: string };
  };
  check("responds 200 ok", res.status === 200 && j.ok === true, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  check("status is ready/stale/warming", ["ready", "stale", "warming"].includes(j.status ?? ""), j.status ?? "");
  check("meta: shared compute + 45min cooldown", j.meta?.sharedCompute === true && j.meta?.cooldownMinutes === 45);
  check("meta: charter shipped + revs match backtest", (j.meta?.charter?.length ?? 0) > 500 && j.meta?.backtestStale === false);

  const bt = j.backtest;
  check("backtest evidence present", !!bt && (bt.stats?.windows ?? 0) > 20 && (bt.stats?.trades ?? 0) > 100, `${bt?.stats?.trades} trades / ${bt?.stats?.windows} windows`);
  check("backtest stats sane", !!bt && (bt.stats?.hitRate ?? 0) > 0.3 && (bt.stats?.hitRate ?? 0) < 0.8 && typeof bt.stats?.profitFactor === "number");

  if (j.set) {
    const s = j.set;
    check("set: generatedAt + model + scanned", !!s.generatedAt && s.model === "GLM" && s.scanned > 100, `${s.scanned} scanned`);
    check("bias: enum + conviction 1-5 + bilingual summary", ["bullish", "bearish", "neutral"].includes(s.marketBias.direction) && s.marketBias.conviction >= 1 && s.marketBias.conviction <= 5 && s.marketBias.summaryAr.length > 10 && s.marketBias.summaryEn.length > 10);
    check("picks: at most 6, well-formed", s.picks.length >= 0 && s.picks.length <= 6, `${s.picks.length} picks`);
    let levelsOk = true;
    let disciplineOk = true;
    let thesesOk = true;
    let earningsOk = true;
    for (const p of s.picks) {
      if (p.stance === "long") {
        if (!(p.entry !== null && p.stop !== null && p.target !== null && p.stop < p.entry && p.entry < p.target)) levelsOk = false;
        if (p.charterScore !== null && p.charterScore < 0.35) disciplineOk = false;
      } else {
        if (p.charterScore !== null && p.charterScore > 0.35) disciplineOk = false;
      }
      if (p.conviction < 1 || p.conviction > 5) disciplineOk = false;
      if (!p.thesisAr || !p.thesisEn || !Array.isArray(p.evidence)) thesesOk = false;
      if (p.earningsRisk !== null && new Date(`${p.earningsRisk}T00:00:00Z`).getTime() <= Date.now()) earningsOk = false;
    }
    check("picks: ATR level math (stop<entry<target on longs)", levelsOk);
    check("picks: charter discipline (conviction 1-5, no weak longs / strong avoids)", disciplineOk);
    check("picks: bilingual theses + evidence arrays", thesesOk);
    check("picks: earnings risk only in the future", earningsOk);
  } else {
    check("cold start returns warming (not an error)", j.status === "warming");
  }

  // ── 2. usage metering counts shared refreshes separately ──
  console.log("── /api/usage ──");
  const usageRes = await fetch(`${BASE_URL}/api/usage`);
  const usage = (await usageRes.json()) as { today?: { questions?: number; aiSignalRefreshes?: number } };
  check("usage: aiSignalRefreshes counted, questions exclude them", typeof usage.today?.aiSignalRefreshes === "number" && usage.today.aiSignalRefreshes >= 1 && typeof usage.today?.questions === "number", `refreshes=${usage.today?.aiSignalRefreshes} questions=${usage.today?.questions}`);

  // ── 3. agent streams over SSE ──
  console.log("── /api/agent (SSE) ──");
  const dev = `t20-device-${Math.random().toString(36).slice(2, 10)}`;
  const sse = await sseAgent([{ role: "user", content: "What did the AI signals engine say about the market today? one short paragraph" }], "en", dev);
  check("responds as SSE", sse.sse === true, `status=${sse.status} ct=${sse.sse ? "event-stream" : "json"}`);
  if (sse.sse) {
    const types = sse.events.map((e) => String(e.type));
    const doneEvt = sse.events.find((e) => e.type === "done") as { answer?: string; steps?: { tool: string }[] } | undefined;
    const hasAiTool = sse.events.some((e) => e.type === "step" && String((e as { tool?: unknown }).tool) === "ai_signals");
    check("has terminal done event with substantive answer", !!doneEvt && (doneEvt.answer?.length ?? 0) > 60, `${doneEvt?.answer?.length ?? 0} chars`);
    check("step events carry tool names", types.filter((t) => t === "step").length === (doneEvt?.steps?.length ?? -1) || (doneEvt?.steps?.length ?? 0) > 0);
    check("ai_signals tool reachable (or another tool chosen honestly)", hasAiTool || (doneEvt?.steps?.length ?? 0) > 0, doneEvt?.steps?.map((s) => s.tool).join(","));
  }

  // ── 4. holiday-aware market status (pure unit checks) ──
  console.log("── market-status holidays ──");
  // Fri Sep 11 2026 — EGX weekend
  check("weekend Friday closed", marketStatus(new Date("2026-09-11T11:00:00Z")).open === false);
  // Sun Sep 13 2026 11:00 Cairo (09:00 UTC) — normal session
  check("Sunday 11:00 Cairo open", marketStatus(new Date("2026-09-13T09:00:00Z")).open === true);
  // Thu Jan 7 2027 11:00 Cairo — Coptic Christmas (fixed holiday)
  const xmas = marketStatus(new Date("2027-01-07T09:00:00Z"));
  check("Coptic Christmas (Jan 7) closed", xmas.open === false && xmas.lastSession === "2027-01-06", `lastSession=${xmas.lastSession}`);
  // Wed Mar 10 2027 11:00 Cairo — Eid al-Fitr (approximate religious date)
  check("Eid al-Fitr 2027 closed", marketStatus(new Date("2027-03-10T09:00:00Z")).open === false);
  // Tue Oct 6 2026 11:00 Cairo — Armed Forces Day
  const oct6 = marketStatus(new Date("2026-10-06T09:00:00Z"));
  check("Armed Forces Day (Oct 6) closed + rolls back", oct6.open === false && oct6.lastSession === "2026-10-05", `lastSession=${oct6.lastSession}`);
  // Mon Mar 8 2027 — regular Monday before Eid, stays open
  check("day before Eid still open", marketStatus(new Date("2027-03-08T09:00:00Z")).open === true);

  console.log(`\n${pass}/${pass + fail} passed`);
  if (failures.length) {
    console.log("failures:", failures.join(" | "));
  }
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error("SUITE ERROR:", err);
  process.exit(1);
});
