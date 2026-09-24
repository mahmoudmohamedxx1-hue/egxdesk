/** T59 — probe Pollinations viability as the keyless free tier:
 *  real-size agent system prompt, JSON protocol compliance, Arabic quality,
 *  referrer field, and consecutive-request rate limits. */
const SYS = `You are EGX Desk's market assistant — a REAL large language model with tools over live Egyptian Exchange data.

PROTOCOL (strict):
Reply with exactly ONE JSON object, no markdown fences, no prose:
- To call a tool: {"tool": "<name>", "args": {...}}
- To answer: {"final": "<markdown answer in Modern Standard Arabic>"}

TOOLS: market_overview{}, quote{ticker}, screen{metric,min,max,limit}, technicals{ticker}, top_movers{limit}, web_search{query}

RULES:
- Answer in the user's language (Arabic unless they write English).
- Numbers MUST come from tool results — never invent prices or percentages.
- For general finance questions with no needed tool, answer directly with {"final": ...}.
- OUTPUT HYGIENE: no literal \\n escapes, no foreign scripts inside Arabic text.`;

async function post(body) {
  const t0 = Date.now();
  const res = await fetch("https://text.pollinations.ai/openai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const text = await res.text();
  let content = text;
  let model = "";
  let tier = "";
  try {
    const j = JSON.parse(text);
    content = j.choices?.[0]?.message?.content ?? "";
    model = j.model ?? "";
    tier = j.user_tier ?? "";
  } catch {}
  return { status: res.status, dt, content, model, tier, raw: text.slice(0, 200) };
}

// 1 — JSON protocol compliance, Arabic answer, real-size prompt
console.log("=== 1: protocol + Arabic (no tool needed) ===");
const r1 = await post({
  model: "openai-fast",
  referrer: "egxdesk.vercel.app",
  messages: [
    { role: "system", content: SYS },
    { role: "user", content: "ما الفرق بين السهم والسند؟" },
  ],
});
console.log(`status ${r1.status} in ${r1.dt}s | model=${r1.model} tier=${r1.tier}`);
console.log(r1.content.slice(0, 300));

// 2 — tool-call JSON compliance
console.log("\n=== 2: tool call JSON ===");
const r2 = await post({
  model: "openai-fast",
  referrer: "egxdesk.vercel.app",
  messages: [
    { role: "system", content: SYS },
    { role: "user", content: "ما حالة السوق المصري الآن؟" },
  ],
});
console.log(`status ${r2.status} in ${r2.dt}s`);
console.log(r2.content.slice(0, 200));

// 3 — consecutive burst (rate limits, anonymous+referrer)
console.log("\n=== 3: burst of 4 quick requests ===");
const burst = ["ما هو مضاعف الربحية؟", "اشرح التضخم بإيجاز", "ما هي الأسهم الحرة؟", "ما فائدة التنويع؟"];
const results = await Promise.all(
  burst.map((q) =>
    post({
      model: "openai-fast",
      referrer: "egxdesk.vercel.app",
      messages: [
        { role: "system", content: "أجب بالعربية الفصحى في جملة واحدة موجزة." },
        { role: "user", content: q },
      ],
    })
  )
);
for (const r of results) console.log(`status ${r.status} ${r.dt}s | ${r.content.slice(0, 60)}`);
