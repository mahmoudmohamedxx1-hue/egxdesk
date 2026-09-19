/** T46 probe B — full 1210 error + correct thinking param shape for glm-5.3-flash. */
const KEY = process.env.ZAI_API_KEY ?? "";
if (!KEY) {
  console.error("ZAI_API_KEY is not set — put it in .env (never committed) and retry.");
  process.exit(1);
}
const BASE = "https://api.z.ai/api/paas/v4/chat/completions";

async function call(model, extra, label) {
  const body = { model, messages: [{ role: "user", content: "What is 7+5?" }], max_tokens: 3000, ...extra };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      console.log(`[${label}] ${model} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
      return null;
    }
    const json = JSON.parse(text);
    const msg = json.choices?.[0]?.message ?? {};
    console.log(`[${label}] ${model} -> OK served=${json.model}`);
    console.log(`  msgKeys=${Object.keys(msg).join(",")}`);
    if (typeof msg.reasoning_content === "string") console.log(`  reasoning (${msg.reasoning_content.length} chars): ${msg.reasoning_content.slice(0, 200).replace(/\n/g, " ")}`);
    console.log(`  content: ${(msg.content ?? "").slice(0, 120).replace(/\n/g, " ")}`);
    console.log(`  usage: ${JSON.stringify(json.usage)}`);
    return json;
  } catch (e) {
    console.log(`[${label}] ${model} -> ERROR: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const m = "glm-5.3-flash";
  await call(m, {}, "no-thinking-param");
  await call(m, { thinking: { type: "enabled" } }, "thinking-enabled");
  await call(m, { thinking: { type: "enabled", level: "low" } }, "thinking-level-low");
  // also verify the current brain keeps serving with thinking ON (retry the 1305)
  await call("glm-4.7-flash", { thinking: { type: "enabled" }, max_tokens: 3000 }, "4.7-flash-thinking-enabled");
}
main();
