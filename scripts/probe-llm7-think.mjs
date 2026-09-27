/** Direct llm7 GLM-5.3-Flash probe — does the tier stream reasoning_content
 *  with thinking:{type:"enabled"} right now? */
const URL_ = "https://api.llm7.io/v1/chat/completions";
const res = await fetch(URL_, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "GLM-5.3-Flash",
    stream: true,
    thinking: { type: "enabled" },
    messages: [
      { role: "system", content: "You are a market analyst. Reply with strict JSON only: {\"final\": \"<2-paragraph Arabic answer>\"}" },
      { role: "user", content: "لماذا يهتم المستثمرون بمؤشر EGX30؟" },
    ],
  }),
});
console.log("status:", res.status);
if (!res.ok) {
  console.log((await res.text()).slice(0, 200));
  process.exit(0);
}
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = "";
let reasoning = 0;
let content = 0;
let model = "";
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).replace(/\r$/, "");
    buf = buf.slice(nl + 1);
    if (!line.startsWith("data:")) continue;
    const p = line.slice(5).trim();
    if (!p || p === "[DONE]") continue;
    try {
      const j = JSON.parse(p);
      if (j.model && !model) model = j.model;
      const d = j.choices?.[0]?.delta ?? {};
      if (typeof d.reasoning_content === "string") reasoning += d.reasoning_content.length;
      if (typeof d.reasoning === "string") reasoning += d.reasoning.length;
      if (typeof d.content === "string") content += d.content.length;
    } catch {}
  }
}
console.log(JSON.stringify({ model, reasoningChars: reasoning, contentChars: content }, null, 2));
