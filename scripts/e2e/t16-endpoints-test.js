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
  ok(run.status === 200 && typeof run.body?.devices === "number", "forced evaluation runs", `devices=${run.body?.devices}`);

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

  // one real agent round-trip (tools + final answer) — generous timeout
  const t0 = Date.now();
  const agent = await json("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "What is the current price of COMI?" }], lang: "en" }),
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  ok(agent.status === 200, "agent answers a real question", `${dt}s`);
  ok(typeof agent.body?.answer === "string" && agent.body.answer.length > 40, "answer is substantive", `${agent.body?.answer?.length ?? 0} chars`);
  ok(Array.isArray(agent.body?.steps) && agent.body.steps.every((s) => s.tool), "tool steps reported", (agent.body?.steps ?? []).map((s) => s.tool).join(","));
  ok(/COMI/i.test(agent.body?.answer ?? ""), "answer contains the ticker asked about");

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("SUITE ERROR:", e.message);
  process.exit(1);
});
