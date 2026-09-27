/** T36 probe — keyless free LLM endpoints that could replace broken Puter
 *  sign-in. Server-side context (no CORS constraints): /api/agent runs in
 *  Node, so ANY endpoint works as long as it serves real completions. */
const PROMPT = "You are a stock analyst. In 2 sentences: what drives a bank's P/E ratio? Answer in English.";

type Probe = { name: string; url: string; body: Record<string, unknown>; headers?: Record<string, string> };

const probes: Probe[] = [
  {
    name: "LLM7 keyless (no auth header)",
    url: "https://api.llm7.io/v1/chat/completions",
    body: { model: "gpt-oss-20b", messages: [{ role: "user", content: PROMPT }], stream: false },
  },
  {
    name: "LLM7 trial token 'unused'",
    url: "https://api.llm7.io/v1/chat/completions",
    body: { model: "gpt-oss-20b", messages: [{ role: "user", content: PROMPT }], stream: false },
    headers: { Authorization: "Bearer unused" },
  },
  {
    name: "LLM7 mistral-nemo keyless",
    url: "https://api.llm7.io/v1/chat/completions",
    body: { model: "mistral-Nemo-Instruct-2407", messages: [{ role: "user", content: PROMPT }], stream: false },
  },
  {
    name: "OVHcloud anonymous qwen3.6-27b",
    url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
    body: { model: "qwen3.6-27b", messages: [{ role: "user", content: PROMPT }], stream: false },
  },
  {
    name: "OVHcloud anonymous llama-3.3-70b",
    url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
    body: { model: "meta-llama-3_3-70b-instruct", messages: [{ role: "user", content: PROMPT }], stream: false },
  },
  {
    name: "g4f.dev keyless",
    url: "https://api.g4f.dev/v1/chat/completions",
    body: { model: "gpt-4o-mini", messages: [{ role: "user", content: PROMPT }], stream: false },
  },
];

async function main() {
  for (const p of probes) {
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45_000);
      const res = await fetch(p.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(p.headers ?? {}) },
        body: JSON.stringify(p.body),
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
      } catch {
        content = "";
      }
      console.log(
        `[${p.name}] HTTP ${res.status} ${Date.now() - t0}ms served=${served} len=${content.length} :: ${String(content).slice(0, 110).replace(/\n/g, " ") || text.slice(0, 130).replace(/\n/g, " ")}`,
      );
    } catch (e) {
      console.log(`[${p.name}] FAIL ${Date.now() - t0}ms :: ${(e as Error).message.slice(0, 120)}`);
    }
  }
}
main();
