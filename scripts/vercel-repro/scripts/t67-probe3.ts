/** T67 probe 3 — which model ids does the SDK gateway accept, and which emit
 *  reasoning_content (thinking) live? Also: kilo hops still alive? */
import ZAI from "z-ai-web-dev-sdk";

async function probeSdkModel(model: string) {
  const t0 = Date.now();
  try {
    const zai = await ZAI.create();
    const res = await zai.chat.completions.create({
      model,
      messages: [
        { role: "user", content: "أعطني تحليلًا موجزًا في سطرين لسهم بنكي مصري افتراضي." },
      ],
      thinking: { type: "enabled" },
      stream: true,
    });
    let out = "", reasoning = "", served = "";
    const reader = (res as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          if (typeof j.model === "string" && !served) served = j.model;
          const d = j.choices?.[0]?.delta;
          if (typeof d?.reasoning_content === "string") reasoning += d.reasoning_content;
          if (typeof d?.content === "string") out += d.content;
        } catch {}
      }
    }
    console.log(
      `SDK ${model}: OK ${Date.now() - t0}ms served=${served} reasoningLen=${reasoning.length} outLen=${out.length}`
    );
    if (reasoning.length > 0) console.log(`   reasoning sample: "${reasoning.slice(0, 140).replace(/\n/g, " ")}"`);
  } catch (e) {
    console.log(`SDK ${model}: FAILED ${Date.now() - t0}ms — ${e instanceof Error ? e.message.slice(0, 110) : String(e)}`);
  }
}

async function probeKilo(providerModel: string) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const res = await fetch("https://api.kilo.ai/api/gateway/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: providerModel,
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        stream: true,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const d = await res.text().catch(() => "");
      console.log(`kilo ${providerModel}: HTTP ${res.status} (${Date.now() - t0}ms) ${d.slice(0, 90)}`);
      return;
    }
    let out = "";
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          const d = j.choices?.[0]?.delta;
          if (typeof d?.content === "string") out += d.content;
        } catch {}
      }
    }
    console.log(`kilo ${providerModel}: OK ${Date.now() - t0}ms out="${out.slice(0, 40).replace(/\n/g, " ")}"`);
  } catch (e) {
    console.log(`kilo ${providerModel}: FAILED ${Date.now() - t0}ms ${e instanceof Error ? e.message.slice(0, 90) : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log("=== SDK gateway model matrix ===");
  for (const m of ["glm-4-plus", "glm-4.6", "glm-4.5", "glm-4.5-air", "glm-4-flash", "glm-4.5v", "glm-4-0414-flash"]) {
    await probeSdkModel(m);
  }
  console.log("\n=== kilo hops ===");
  for (const m of ["nvidia/nemotron-3-super-120b-a12b:free", "stepfun/step-3.7-flash:free", "openrouter/free"]) {
    await probeKilo(m);
  }
}

main().catch((e) => {
  console.error("crashed:", e);
  process.exit(1);
});
