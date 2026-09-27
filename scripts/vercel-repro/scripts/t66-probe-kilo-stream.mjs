// T66 probe: kilo streaming (SSE) + Arabic final-answer quality.
const CANDS = [
  { name: "kilo:nemotron-3-super", model: "nvidia/nemotron-3-super-120b-a12b:free" },
  { name: "kilo:step-3.7-flash", model: "stepfun/step-3.7-flash:free" },
  { name: "kilo:openrouter/free", model: "openrouter/free" },
];
const AR_Q = "اكتب جملة عربية واحدة موجزة عن بورصة مصر (بدون أدوات، فقط الجملة).";

for (const c of CANDS) {
  const t0 = Date.now();
  try {
    const res = await fetch("https://api.kilo.ai/api/gateway/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: c.model,
        messages: [{ role: "user", content: AR_Q }],
        max_tokens: 800,
        temperature: 0.4,
        stream: true,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok || !res.body) { console.log(`${c.name}: HTTP ${res.status} / no body`); continue; }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", chunks = 0, full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        chunks++;
        try {
          const j = JSON.parse(payload);
          const d = j.choices?.[0]?.delta;
          if (d?.content) full += d.content;
        } catch {}
      }
    }
    const ms = Date.now() - t0;
    const clean = full.trim().replace(/^```[a-z]*\s*/i, "").replace(/```$/, "");
    let jsonOk = "n/a";
    try { JSON.parse(clean); jsonOk = "parses-as-JSON(!)"; } catch { jsonOk = "prose"; }
    console.log(`${c.name.padEnd(22)} ${String(ms).padStart(6)}ms  sse-chunks=${String(chunks).padStart(3)}  ${jsonOk}`);
    console.log(`   ar[0..130]: ${JSON.stringify(full.slice(0, 130))}`);
  } catch (e) {
    console.log(`${c.name}: FAIL ${e.message}`);
  }
}
