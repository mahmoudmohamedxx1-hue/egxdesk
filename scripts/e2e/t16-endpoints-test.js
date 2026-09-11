#!/usr/bin/env node
/** Task 16 regression suite: Signals scan, AI agent, web-push endpoints.
 *  Run: node scripts/e2e/t16-endpoints-test.js  (BASE_URL env to override) */

const BASE = process.env.BASE_URL || "http://localhost:3000";
let pass = 0, fail = 0;
const ok = (cond, name, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? "  -- " + extra : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? "  -- " + extra : ""}`); }
};

async function json(path, opts) {
  const res = await fetch(BASE + path, opts);
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

(async () => {
  console.log("── /api/signals ──");
  const sig = await json("/api/signals");
  ok(sig.status === 200, "signals responds 200");
  const rows = sig.body?.rows ?? [];
  ok(Array.isArray(rows) && rows.length > 100, "scan covers the market", `${rows.length} rows`);
  ok(rows.every((r) => typeof r.score === "number" && r.score >= -1 && r.score <= 1), "scores within -1..+1");
  ok(rows.every((r) => ["strongBuy", "buy", "neutral", "sell", "strongSell"].includes(r.rating)), "ratings valid");
  const sorted = [...rows].every((r, i) => i === 0 || rows[i - 1].score >= r.score);
  ok(sorted, "rows ranked by score desc");
  const first = rows[0] ?? {};
  ok(first.rsi !== undefined && first.macdHist !== undefined && first.pos52 !== undefined, "indicator fields present", first.ticker);
  ok(first.nameAr && typeof first.nameAr === "string", "Arabic name present");
  const ratings = new Set(rows.map((r) => r.rating));
  ok(ratings.size >= 3, "multiple ratings in the market", [...ratings].join(","));

  console.log("── /api/push/* ──");
  const key = await json("/api/push/key");
  ok(key.status === 200 && typeof key.body?.publicKey === "string" && key.body.publicKey.length > 60, "VAPID public key served");
  const badSub = await json("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: "", subscription: { endpoint: "https://x", keys: { p256dh: "a", auth: "b" } } }),
  });
  ok(badSub.status === 400, "subscribe rejects invalid device");
  const run = await json("/api/push/run", { method: "POST" });
  // Task 19: /api/push/run is now rate-limited (6/h per IP). A 429 caused by
  // an earlier suite burning the budget on the SAME server is CORRECT
  // behavior, not a failure — accept either a real evaluation or the guard.
  ok(
    (run.status === 200 && typeof run.body?.devices === "number") ||
      (run.status === 429 && typeof run.body?.error === "string"),
    "forced evaluation runs (or correctly rate-limited)",
    `status=${run.status} devices=${run.body?.devices}`
  );

  console.log("── /api/agent ──");
  const noMsgs = await json("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [] }),
  });
  ok(noMsgs.status === 400, "agent rejects empty conversation");
  const lastNotUser = await json("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "assistant", content: "x" }] }),
  });
  ok(lastNotUser.status === 400, "agent requires last message = user");

  // one real agent round-trip (tools + final answer) — generous timeout.
  // Task 20: the agent now streams SSE (step/delta/done events) — parse the
  // stream and reconstruct the {answer, steps} shape the old JSON test used.
  const t0 = Date.now();
  const agentRes = await fetch(BASE + "/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "What is the current price of COMI?" }], lang: "en" }),
  });
  const agent = { status: agentRes.status, body: null, sse: false };
  if ((agentRes.headers.get("content-type") || "").includes("text/event-stream")) {
    agent.sse = true;
    const reader = agentRes.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const events = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let sep;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const rawEvt = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        for (const line of rawEvt.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try { events.push(JSON.parse(line.slice(5).trim())); } catch {}
        }
      }
    }
    const doneEvt = events.find((e) => e.type === "done");
    agent.body = doneEvt ?? null;
  } else {
    try { agent.body = await agentRes.json(); } catch {}
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  ok(agent.status === 200, "agent answers a real question", `${dt}s${agent.sse ? " (SSE)" : ""}`);
  ok(typeof agent.body?.answer === "string" && agent.body.answer.length > 40, "answer is substantive", `${agent.body?.answer?.length ?? 0} chars`);
  ok(Array.isArray(agent.body?.steps) && agent.body.steps.every((s) => s.tool), "tool steps reported", (agent.body?.steps ?? []).map((s) => s.tool).join(","));
  ok(/COMI/i.test(agent.body?.answer ?? ""), "answer contains the ticker asked about");

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("SUITE ERROR:", e.message);
  process.exit(1);
});
