/** Empirical probe of z-ai-web-dev-sdk platform limits (Task 19).
 *
 *  The SDK exposes NO documented quota (no rate-limit fields in typings, no
 *  headers surfaced). So we measure: fire a controlled burst of tiny chat
 *  completions (sequential + concurrent) plus web_search calls and report
 *  status / latency / any throttling errors. ~20 LLM calls + 4 searches.
 */
import ZAI from "z-ai-web-dev-sdk";

const zai = await ZAI.create();

const tiny = (i: number) =>
  zai.chat.completions.create({
    messages: [{ role: "user", content: `Reply with exactly: ok-${i}` }],
    thinking: { type: "disabled" },
  });

function stats(ms: number[]) {
  if (!ms.length) return "(no successes)";
  const s = [...ms].sort((a, b) => a - b);
  const avg = Math.round(s.reduce((a, b) => a + b, 0) / s.length);
  return `min ${s[0]}ms / p50 ${s[Math.floor(s.length / 2)]}ms / max ${s[s.length - 1]}ms / avg ${avg}ms`;
}

function errText(e: unknown) {
  const any = e as Record<string, unknown>;
  const status = any?.status ?? any?.statusCode ?? any?.code;
  const msg = e instanceof Error ? e.message : String(e);
  return `${status ? `status=${status} ` : ""}${msg.slice(0, 160)}`;
}

// ── Phase 1: 8 sequential tiny completions ─────────────────────────────────
console.log("\n=== PHASE 1 — 8 sequential tiny completions ===");
const seqMs: number[] = [];
let seqFail = 0;
for (let i = 0; i < 8; i++) {
  const t = Date.now();
  try {
    const c = await tiny(i);
    const txt = String(c?.choices?.[0]?.message?.content ?? "");
    seqMs.push(Date.now() - t);
    console.log(`  ${i + 1}/8  ok   ${Date.now() - t}ms  "${txt.slice(0, 24)}"`);
  } catch (e) {
    seqFail++;
    console.log(`  ${i + 1}/8  FAIL ${Date.now() - t}ms  ${errText(e)}`);
  }
}
console.log(`  → ${seqMs.length}/8 ok | ${stats(seqMs)} | failures: ${seqFail}`);

// ── Phase 2: 12 concurrent tiny completions ────────────────────────────────
console.log("\n=== PHASE 2 — 12 concurrent tiny completions ===");
const timed = (i: number) => {
  const t = Date.now();
  return tiny(i).then(
    (c) => ({ ok: true, ms: Date.now() - t, txt: String(c?.choices?.[0]?.message?.content ?? "") }),
    (e) => ({ ok: false, ms: Date.now() - t, err: errText(e) })
  );
};
const t2 = Date.now();
const out = await Promise.all(Array.from({ length: 12 }, (_, i) => timed(i)));
const wall2 = Date.now() - t2;
const okMs = out.filter((o) => o.ok).map((o) => o.ms);
out.forEach((o, i) =>
  console.log(`  ${i + 1}/12 ${o.ok ? "ok   " : "FAIL "} ${o.ms}ms${o.ok ? `  "${o.txt.slice(0, 20)}"` : `  ${o.err}`}`)
);
console.log(
  `  → ${okMs.length}/12 ok | wall ${wall2}ms | per-call ${stats(okMs)} | failures: ${out.length - okMs.length}`
);

// ── Phase 3: 4 web_search calls (2 batches of 2 concurrent) ────────────────
console.log("\n=== PHASE 3 — 4 web_search calls ===");
const searchTimed = (q: string) => {
  const t = Date.now();
  return zai.functions
    .invoke("web_search", { query: q, num: 3 })
    .then((r) => ({ ok: true, ms: Date.now() - t, n: Array.isArray(r) ? r.length : -1 }))
    .catch((e) => ({ ok: false, ms: Date.now() - t, err: errText(e) }));
};
const queries = [
  "EGX Egypt stock market today",
  "Central Bank of Egypt interest rate",
  "Egypt IMF program latest",
  "Egyptian pound exchange rate",
];
for (let b = 0; b < 2; b++) {
  const pair = await Promise.all(queries.slice(b * 2, b * 2 + 2).map(searchTimed));
  pair.forEach((p) => console.log(`  ${p.ok ? "ok   " : "FAIL "} ${p.ms}ms${p.ok ? `  ${p.n} results` : `  ${p.err}`}`));
}

// ── Phase 4: 1 real-sized agent-style request (thinking on, ~300 words) ────
console.log("\n=== PHASE 4 — 1 real-sized completion (thinking enabled) ===");
const t4 = Date.now();
try {
  const c = await zai.chat.completions.create({
    messages: [
      {
        role: "user",
        content:
          "Write a 250-word mini-brief on why dividend yield matters for retail investors in frontier markets. Then stop.",
      },
    ],
    thinking: { type: "enabled" },
  });
  const txt = String(c?.choices?.[0]?.message?.content ?? "");
  const usage = (c as Record<string, unknown>)?.usage;
  console.log(`  ok ${Date.now() - t4}ms, ${txt.length} chars, usage=${JSON.stringify(usage ?? null)}`);
} catch (e) {
  console.log(`  FAIL ${Date.now() - t4}ms  ${errText(e)}`);
}

console.log("\n=== PROBE COMPLETE ===");
