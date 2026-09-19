/** T46 probe — which models does the user's Z.AI key actually SERVE?
 *  One tiny call per model (thinking off, 16 tokens) + one thinking-ON call on
 *  the flash brains to inspect the reasoning_content shape. Honest output. */
const KEY = process.env.ZAI_API_KEY ?? "";
if (!KEY) {
  console.error("ZAI_API_KEY is not set — put it in .env (never committed) and retry.");
  process.exit(1);
}
const BASE = "https://api.z.ai/api/paas/v4/chat/completions";

const CATALOG = [
  "glm-4.5", "glm-4.5-air", "glm-4.6", "glm-4.7", "glm-5", "glm-5-turbo",
  "glm-5.1", "glm-5.2", "glm-5.3", "glm-5.3-flash", "glm-5.3-flashx",
  // known-good but absent from the catalog:
  "glm-4.7-flash", "glm-4.6v-flash",
];

async function probe(model, thinking) {
  const body = {
    model,
    messages: [{ role: "user", content: thinking ? "What is 7+5? Think briefly." : "Reply with the single word: ok" }],
    max_tokens: thinking ? 2000 : 16,
    ...(thinking ? { thinking: { type: "enabled" } } : { thinking: { type: "disabled" } }),
  };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let code = "";
      try { code = JSON.parse(text)?.error?.code ?? ""; } catch {}
      return { model, ok: false, http: res.status, code: String(code), snippet: text.slice(0, 120) };
    }
    const json = JSON.parse(text);
    const msg = json.choices?.[0]?.message ?? {};
    return {
      model, ok: true, servedModel: json.model ?? model,
      thinking,
      msgKeys: Object.keys(msg).join(","),
      reasoningLen: typeof msg.reasoning_content === "string" ? msg.reasoning_content.length : null,
      contentSnippet: (msg.content ?? "").slice(0, 60),
      usage: json.usage ? { pt: json.usage.prompt_tokens, ct: json.usage.completion_tokens, tt: json.usage.total_tokens, details: JSON.stringify(json.usage).slice(0, 200) } : null,
    };
  } catch (e) {
    return { model, ok: false, http: 0, code: "network/timeout", snippet: e instanceof Error ? e.message.slice(0, 100) : String(e) };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  console.log("=== PASS 1: every catalog model, thinking OFF, 16 tokens ===");
  for (const m of CATALOG) {
    const r = await probe(m, false);
    console.log(JSON.stringify(r));
  }
  console.log("\n=== PASS 2: thinking ON (reasoning_content shape) on the flash brains ===");
  for (const m of ["glm-4.7-flash", "glm-5.3-flash", "glm-5.3-flashx"]) {
    const r = await probe(m, true);
    console.log(JSON.stringify(r));
  }
}
main();
