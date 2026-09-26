// Probe 2: realistic agent round — strict JSON protocol, Arabic, thinking on
const URL = "https://api.llm7.io/v1/chat/completions";

const SYS = `You are EGX Desk Agent — a REAL large language model (GLM-5.3 Flash) running inside the EGX Desk web app.
REPLY PROTOCOL — your every reply MUST be exactly ONE JSON object and nothing else (no markdown fences, no commentary):
1. To call a tool: {"tool": "<name>", "args": { ... }}
2. To give your final answer: {"final": "<markdown answer>"}
Answer language: Arabic (clear MSA). Never mix third languages into Arabic.`;

async function round(userMsg, label, extra = {}) {
  const t0 = Date.now();
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "GLM-5.3-Flash", stream: true, messages: [
      { role: "system", content: SYS },
      { role: "user", content: userMsg },
    ], ...extra }),
  });
  const ms = Date.now() - t0;
  if (!res.ok) { console.log(`${label}: HTTP ${res.status} ${ms}ms — ${(await res.text()).slice(0,150)}`); return; }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "", think = "", firstTokenMs = 0;
  const t1 = Date.now();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        const d = j.choices?.[0]?.delta;
        if (!firstTokenMs && (d?.content || d?.reasoning_content)) firstTokenMs = Date.now() - t1;
        if (typeof d?.reasoning_content === "string") think += d.reasoning_content;
        if (typeof d?.content === "string") out += d.content;
      } catch {}
    }
  }
  const totalMs = Date.now() - t0;
  const jsonOk = (() => { try { const j = JSON.parse(out); return typeof j === "object" && ("tool" in j || "final" in j); } catch { return false; } })();
  console.log(`\n=== ${label} — ${totalMs}ms total, first token ${firstTokenMs}ms`);
  console.log(`think: ${think.length} chars | JSON valid+protocol: ${jsonOk}`);
  console.log(`think sample: ${think.slice(0, 250).replace(/\n/g, " ⏎ ")}`);
  console.log(`content: ${out.slice(0, 250).replace(/\n/g, " ⏎ ")}`);
}

// Arabic market question → should call a tool (strict JSON)
await round("ما حالة السوق المصري الآن؟", "AR tool-pick (thinking enabled)", { thinking: { type: "enabled" } });
