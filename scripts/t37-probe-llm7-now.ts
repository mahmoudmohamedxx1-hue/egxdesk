/** T37 probe #1 — are the three shipped keyless LLM7 models still alive?
 *  Probes the EXACT ids from ai-models.ts with an AGENT-SIZED prompt,
 *  then fetches the live LLM7 catalog to see what serves keyless today. */
const SYSTEM =
  "You are EGX Desk AI, a precise equity analyst for the Egyptian Exchange. Answer in strict JSON: {\"answer\": string}. Be concise.";
const USER =
  "What was the last price of Commercial International Bank (COMI)? Reply with the number you can recall, in one sentence.";

const SHIPPED = ["codestral-latest", "mistral-Nemo-Instruct-2407", "minimax-m2.7"];

async function probe(model: string) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 75_000);
    const res = await fetch("https://api.llm7.io/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: USER },
        ],
        stream: false,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    let content = "";
    let served = "";
    try {
      const j = JSON.parse(text);
      content = j?.choices?.[0]?.message?.content ?? "";
      served = j?.model ?? "";
    } catch {}
    console.log(
      `[${model}] HTTP ${res.status} ${Date.now() - t0}ms served=${served} len=${content.length} :: ${String(content).slice(0, 110).replace(/\n/g, " ") || text.slice(0, 120).replace(/\n/g, " ")}`,
    );
  } catch (e) {
    console.log(`[${model}] FAIL ${Date.now() - t0}ms :: ${(e as Error).message.slice(0, 90)}`);
  }
}

async function catalog() {
  try {
    const res = await fetch("https://api.llm7.io/v1/models");
    const text = await res.text();
    let ids: string[] = [];
    try {
      const j = JSON.parse(text);
      ids = (j?.data ?? j ?? []).map((m: any) => m?.id ?? m?.model ?? String(m)).filter(Boolean);
    } catch {
      ids = text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    }
    console.log(`\nCATALOG: HTTP ${res.status}, ${ids.length} entries`);
    console.log(ids.join("\n"));
  } catch (e) {
    console.log(`CATALOG FAIL :: ${(e as Error).message}`);
  }
}

async function main() {
  console.log("=== SHIPPED KEYLESS MODELS (agent-sized prompt) ===");
  for (const m of SHIPPED) {
    await probe(m);
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log("\n=== LIVE CATALOG ===");
  await catalog();
}
main();
