/** T36 probe #3 — remaining LLM7 models + OVHcloud retry + streaming check. */
const SYSTEM =
  "You are EGX Desk AI, a precise equity analyst for the Egyptian Exchange. Answer in strict JSON: {\"answer\": string}. Be concise.";
const USER =
  "What does a high P/E ratio mean for a bank stock like CIB on the Egyptian Exchange? One sentence.";

const LLM7_REST = [
  "gemma4:31b",
  "L3-8B-Lunaris-v1-Turbo",
  "XiaomiMiMo/MiMo-V2.5",
  "chroma-v.46-flash",
  "Inkling-Small",
  "seed-2.0-mini",
  "codestral-latest",
  "deepseek-v4-flash:0731",
  "mistral-Nemo-Instruct-2407",
  "minimax-m2.7",
];

async function llm7(model: string) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
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
    try {
      const j = JSON.parse(text);
      content = j?.choices?.[0]?.message?.content ?? "";
    } catch {}
    console.log(
      `[llm7:${model}] HTTP ${res.status} ${Date.now() - t0}ms len=${content.length} :: ${String(content).slice(0, 70).replace(/\n/g, " ") || text.slice(0, 90).replace(/\n/g, " ")}`,
    );
  } catch (e) {
    console.log(`[llm7:${model}] FAIL ${Date.now() - t0}ms :: ${(e as Error).message.slice(0, 80)}`);
  }
}

async function ovh(model: string) {
  const t0 = Date.now();
  try {
    const res = await fetch("https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions", {
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
    });
    const text = await res.text();
    let content = "";
    try {
      const j = JSON.parse(text);
      content = j?.choices?.[0]?.message?.content ?? "";
    } catch {}
    console.log(
      `[ovh:${model}] HTTP ${res.status} ${Date.now() - t0}ms len=${content.length} :: ${String(content).slice(0, 70).replace(/\n/g, " ") || text.slice(0, 90).replace(/\n/g, " ")}`,
    );
  } catch (e) {
    console.log(`[ovh:${model}] FAIL ${Date.now() - t0}ms :: ${(e as Error).message.slice(0, 80)}`);
  }
}

async function streamCheck() {
  console.log("--- streaming check: llm7 minimax-m2.7 ---");
  try {
    const res = await fetch("https://api.llm7.io/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "minimax-m2.7",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: USER },
        ],
        stream: true,
      }),
    });
    console.log(`stream HTTP ${res.status}, content-type=${res.headers.get("content-type")}`);
    if (res.ok && res.body) {
      let got = 0;
      let chunks = 0;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      const t0 = Date.now();
      while (Date.now() - t0 < 30_000) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks++;
        got += dec.decode(value, { stream: true }).length;
      }
      console.log(`streamed ${chunks} chunks, ${got} chars — STREAMING WORKS`);
    }
  } catch (e) {
    console.log("stream FAIL:", (e as Error).message.slice(0, 90));
  }
}

async function main() {
  for (const m of LLM7_REST) {
    await llm7(m);
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log("--- OVH retry ---");
  await ovh("qwen3.6-27b");
  await new Promise((r) => setTimeout(r, 65_000)); // 2 RPM — wait a full minute
  await ovh("meta-llama-3_3-70b-instruct");
  await streamCheck();
}
main();
