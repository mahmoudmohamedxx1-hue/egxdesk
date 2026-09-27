// T68 agent test battery — hits the LOCAL dev server's /api/agent SSE loop
// with real questions and verifies the full event contract:
//   meta (engine honest) → think (live reasoning!) → step (tools) → delta → done
// plus: honest served-model reporting, no crash-text, thinking length.
import { read } from "fs";

const BASE = "http://localhost:3000";

function sseBody(body) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function askAgent({ messages, lang, model, deep }) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/agent`, sseBody({ messages, lang, model, deep }));
  if (!res.ok) {
    return { error: `HTTP ${res.status}`, detail: await res.text() };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const events = [];
  let firstThinkMs = 0;
  const t1 = Date.now();
  outer: for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          const evt = JSON.parse(payload);
          if (evt.type === "think" && !firstThinkMs) firstThinkMs = Date.now() - t1;
          events.push(evt);
          if (evt.type === "done" || evt.type === "error") break outer;
        } catch {}
      }
    }
  }
  const done = events.find((e) => e.type === "done");
  const error = events.find((e) => e.type === "error");
  const thinks = events.filter((e) => e.type === "think");
  const steps = events.filter((e) => e.type === "step");
  const deltas = events.filter((e) => e.type === "delta");
  const meta = events.find((e) => e.type === "meta");
  const statuses = events.filter((e) => e.type === "status");
  return {
    ms: Date.now() - t0,
    meta,
    firstThinkMs,
    thinkChars: thinks.reduce((a, e) => a + (e.text?.length ?? 0), 0),
    thinkSample: thinks.slice(0, 3).map((e) => e.text).join("").slice(0, 160),
    steps: steps.map((e) => `${e.tool}${e.ok ? "✓" : "✕"}`),
    statuses: statuses.map((e) => e.note),
    deltaChars: deltas.reduce((a, e) => a + (e.text?.length ?? 0), 0),
    answer: (done?.answer ?? "").slice(0, 700),
    answerLen: done?.answer?.length ?? 0,
    model: done?.model,
    thinkingAttached: done?.thinking?.length ?? 0,
    error: error?.message ?? (done ? null : "stream ended without done"),
  };
}

function verdict(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  process.exitCode = ok ? process.exitCode : 1;
}

// ── T1: backbone report ──
const bb = await (await fetch(`${BASE}/api/agent`)).json();
console.log("\n== host backbone ==", JSON.stringify(bb));
verdict("backbone engine is GLM-5.3-Flash (the main)", bb.engine === "GLM-5.3-Flash");

// ── T2: Arabic tool question on the DEFAULT model (no model field) ──
console.log("\n== T2: AR default model, market overview ==");
const t2 = await askAgent({ messages: [{ role: "user", content: "ما حالة السوق المصري الآن؟" }], lang: "ar" });
console.log(JSON.stringify({ ...t2, answer: t2.answer?.slice(0, 250) }, null, 1).slice(0, 1200));
verdict("T2 done without error", !t2.error, t2.error ?? "");
verdict("T2 meta engine = GLM-5.3 Flash", t2.meta?.engine === "GLM-5.3 Flash");
verdict("T2 LIVE THINKING streamed (>=300 chars)", t2.thinkChars >= 300, `${t2.thinkChars} chars, first token ${t2.firstThinkMs}ms`);
verdict("T2 thinking attached to done event", t2.thinkingAttached >= 300, `${t2.thinkingAttached}`);
verdict("T2 used tools", t2.steps.length >= 1, t2.steps.join(","));
verdict("T2 answer is Arabic", /[\u0600-\u06FF]/.test(t2.answer ?? ""));
verdict("T2 served model honest", typeof t2.model === "string" && t2.model.length > 0, t2.model);

// ── T3: English quote question ──
console.log("\n== T3: EN quote for COMI ==");
const t3 = await askAgent({ messages: [{ role: "user", content: "Give me the quote for COMI" }], lang: "en" });
console.log(JSON.stringify({ ...t3, answer: t3.answer?.slice(0, 250) }, null, 1).slice(0, 1000));
verdict("T3 done", !t3.error, t3.error ?? "");
verdict("T3 thinking streamed", t3.thinkChars >= 200, `${t3.thinkChars}`);
verdict("T3 mentions a real number", /\d/.test(t3.answer ?? ""));

console.log(`\nexit code will be ${process.exitCode ?? 0}`);
