/** Probe v2 — characterize the 429 throttle window (Task 19).
 *  v1 found: 2 instant OKs then instant 429 "Too many requests, please try
 *  again later" on BOTH chat completions and web_search.
 *  v2: after a 60s cooldown, send 1 tiny call every 8s and log the ok/429
 *  timeline — the pattern reveals the rolling window (e.g. 2/min vs burst).
 */
import ZAI from "z-ai-web-dev-sdk";

const zai = await ZAI.create();

const tiny = () =>
  zai.chat.completions.create({
    messages: [{ role: "user", content: "Reply with exactly: ok" }],
    thinking: { type: "disabled" },
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const one = async (label: string) => {
  const t = Date.now();
  try {
    await tiny();
    return { label, ok: true, ms: Date.now() - t };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const is429 = msg.includes("429");
    return { label, ok: false, is429, ms: Date.now() - t, msg: msg.slice(0, 90) };
  }
};

console.log("cooldown 60s ...");
await sleep(60_000);

const results: { label: string; ok: boolean; is429?: boolean; ms: number; msg?: string }[] = [];
results.push(await one("t=0   (recovery check after 60s)"));
for (let i = 1; i <= 10; i++) {
  await sleep(8_000);
  results.push(await one(`t=${i * 8}s`));
}

console.log("\n--- timeline (1 call / 8s) ---");
for (const r of results) {
  console.log(
    `${r.ok ? "ok  " : r.is429 ? "429 " : "ERR "} ${String(r.ms).padStart(5)}ms  ${r.label}${r.ok ? "" : "  " + (r.msg ?? "")}`
  );
}

// burst re-confirmation: 3 instant back-to-back calls
console.log("\n--- burst: 3 instant calls ---");
const burst: string[] = [];
for (let i = 0; i < 3; i++) {
  const r = await one(`burst-${i + 1}`);
  burst.push(`${r.ok ? "ok" : r.is429 ? "429" : "ERR"}(${r.ms}ms)`);
}
console.log(burst.join(" "));

const oks = results.filter((r) => r.ok).length;
console.log(`\n paced: ${oks}/${results.length} ok | burst after paced series: ${burst.join(" ")}`);
