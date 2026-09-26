// T66 probe: can the kilo keyless models serve the agent's strict-JSON tool protocol?
const CANDIDATES = [
  { name: "kilo:nemotron-3-super", url: "https://api.kilo.ai/api/gateway/v1/chat/completions", model: "nvidia/nemotron-3-super-120b-a12b:free" },
  { name: "kilo:step-3.7-flash", url: "https://api.kilo.ai/api/gateway/v1/chat/completions", model: "stepfun/step-3.7-flash:free" },
  { name: "kilo:openrouter/free", url: "https://api.kilo.ai/api/gateway/v1/chat/completions", model: "openrouter/free" },
];

const SYS = `You are EGX Desk's agent. On each turn you MUST reply with ONE JSON object and nothing else, using exactly one of:
{"tool":"market_overview","args":{}}
{"tool":"stock_quote","args":{"ticker":"COMI"}}
{"final":"<your answer>"}
Rules: no markdown, no prose outside JSON, no code fences.`;

async function probe(c) {
  const t0 = Date.now();
  try {
    const res = await fetch(c.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: c.model,
        messages: [
          { role: "system", content: SYS },
          { role: "user", content: "ما وضع السوق الآن؟ ابدأ بأداة نظرة عامة." },
        ],
        max_tokens: 700,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(45000),
    });
    const ms = Date.now() - t0;
    const text = await res.text();
    let content = "";
    let served = "";
    try {
      const j = JSON.parse(text);
      content = j.choices?.[0]?.message?.content ?? "";
      served = j.model ?? "";
    } catch { content = "RAW:" + text.slice(0, 140); }
    const stripped = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let jsonOk = false, kind = "";
    try { const o = JSON.parse(stripped); jsonOk = true; kind = "final" in o ? "final" : "tool:" + (o.tool ?? "?"); } catch {}
    console.log(`${c.name.padEnd(24)} ${String(ms).padStart(6)}ms  json=${jsonOk ? "YES" : "NO "}  ${kind.padEnd(16)} served=${served}`);
    console.log("   content[0..110]: " + JSON.stringify(content.slice(0, 110)));
  } catch (e) {
    console.log(`${c.name.padEnd(24)} FAIL ${e.message}`);
  }
}

for (const c of CANDIDATES) await probe(c);
