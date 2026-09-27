// Probe llm7 GLM-5.3-Flash: does it stream reasoning_content by default?
const URL = "https://api.llm7.io/v1/chat/completions";

async function probe(body, label) {
  const t0 = Date.now();
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(`\n=== ${label} → HTTP ${res.status} (${Date.now() - t0}ms)`);
  if (!res.ok) {
    console.log((await res.text()).slice(0, 300));
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let out = "", think = "", served = "", nChunks = 0, thinkChunks = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        if (!served && j.model) served = j.model;
        nChunks++;
        const d = j.choices?.[0]?.delta;
        if (typeof d?.reasoning_content === "string" && d.reasoning_content) { think += d.reasoning_content; thinkChunks++; }
        if (typeof d?.reasoning === "string" && d.reasoning) { think += d.reasoning; thinkChunks++; }
        if (typeof d?.content === "string" && d.content) out += d.content;
      } catch {}
    }
  }
  console.log(`served=${served} chunks=${nChunks} thinkChunks=${thinkChunks}`);
  console.log(`THINK (${think.length} chars): ${think.slice(0, 400).replace(/\n/g, " ⏎ ")}`);
  console.log(`CONTENT (${out.length} chars): ${out.slice(0, 300).replace(/\n/g, " ⏎ ")}`);
}

// 1 — plain, no special params
await probe(
  { model: "GLM-5.3-Flash", stream: true, messages: [
    { role: "system", content: "Answer in one short sentence." },
    { role: "user", content: "What is 7 × 8?" },
  ]},
  "plain (no params)"
);

// 2 — with thinking enabled flag (GLM-style)
await probe(
  { model: "GLM-5.3-Flash", stream: true, thinking: { type: "enabled" }, messages: [
    { role: "user", content: "What is 13 × 12? Think step by step." },
  ]},
  "thinking: {type: enabled}"
);
