// T71 probe — llm7 keyless GLM-5.3-Flash as a NON-STREAMING synthesis brain
// (thinking on, strict JSON) — the replacement for the removed SDK glm-4-plus
// chat tier in the background pipelines (ai-signals / hourly-report / hermes).
const LLM7_URL = "https://api.llm7.io/v1/chat/completions";

async function round(thinking) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 95_000);
  try {
    const t0 = Date.now();
    const res = await fetch(LLM7_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "GLM-5.3-Flash",
        messages: [
          { role: "system", content: "You are a JSON synthesis engine. Reply with EXACTLY ONE valid JSON object, no fences, no commentary." },
          { role: "user", content: 'Return {"ok":true,"n":3,"ar":"سطر عربي سليم"} exactly with n replaced by the count of letters in the word "EGX" (3).' },
        ],
        stream: false,
        ...(thinking ? { thinking: { type: "enabled" } } : {}),
      }),
      signal: ctrl.signal,
    });
    const ms = Date.now() - t0;
    if (!res.ok) throw new Error(`http ${res.status}: ${(await res.text().catch(() => "")).slice(0, 120)}`);
    const j = await res.json();
    const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
    console.log(`thinking=${thinking} → ${ms}ms model=${j.model || "?"} content=${JSON.stringify(content.slice(0, 120))}`);
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  await round(true);
  await round(false);
})().catch((e) => {
  console.error("probe failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
