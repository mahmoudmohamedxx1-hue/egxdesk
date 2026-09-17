/** T36 probe #2 — which LLM7.io models actually serve keyless, with an
 *  AGENT-SIZED prompt (system + user, ~500 chars) like the real agent loop
 *  sends. Also checks streaming support and CORS headers. */
const SYSTEM =
  "You are EGX Desk AI, a precise equity analyst for the Egyptian Exchange. Answer in strict JSON: {\"answer\": string}. Be concise.";
const USER =
  "What is the P/E ratio? Explain in one sentence what a high P/E means for a bank stock like CIB on the Egyptian Exchange.";

const MODELS = [
  "gpt-5.6-luna",
  "claude-sonnet-5",
  "claude-haiku-4-5",
  "gemini-3.7-flash",
  "grok-4.6",
  "glm-5.3",
  "glm-5.3-flash",
  "deepseek-v4-pro",
  "deepseek-v4-flash_0731",
  "kimi-k3",
  "llama-4-maverick",
  "minimax-m2.7",
  "mistral-Small-24B-Instruct-2501",
  "mistral-Nemo-Instruct-2407",
  "DeepSeek-V4-Flash-0731",
];

async function probe(model: string) {
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
    let served = "";
    try {
      const j = JSON.parse(text);
      content = j?.choices?.[0]?.message?.content ?? "";
      served = j?.model ?? "";
    } catch {}
    const cors = res.headers.get("access-control-allow-origin");
    console.log(
      `[${model}] HTTP ${res.status} ${Date.now() - t0}ms served=${served} len=${content.length} cors=${cors} :: ${String(content).slice(0, 80).replace(/\n/g, " ") || text.slice(0, 100).replace(/\n/g, " ")}`,
    );
  } catch (e) {
    console.log(`[${model}] FAIL ${Date.now() - t0}ms :: ${(e as Error).message.slice(0, 90)}`);
  }
}

async function main() {
  // sequential — respect the shared anonymous rate limit
  for (const m of MODELS) {
    await probe(m);
    await new Promise((r) => setTimeout(r, 1200));
  }
}
main();
