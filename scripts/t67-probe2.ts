/** T67 probe 2 — (a) does glm-4-plus emit reasoning_content on a REAL question?
 *  (b) do the llm7 catalog GLMs (glm-5.3, glm-5.2) pass the strict-JSON agent
 *  protocol keyless? (c) do the registry's llm7 models (codestral/nemo/minimax)
 *  still pass the strict-JSON protocol? */
import ZAI from "z-ai-web-dev-sdk";

const SYS = `You are the EGX Desk analyst agent. Reply with exactly ONE JSON object, no fences, no prose: {"tool":"market_overview","args":{}} to call a tool, or {"final":"<markdown answer>"} to answer. Answer in Arabic.`;

async function probeSdkThinking() {
  console.log("=== SDK glm-4-plus THINKING on a real question ===");
  try {
    const zai = await ZAI.create();
    const res = await zai.chat.completions.create({
      model: "glm-4-plus",
      messages: [
        { role: "user", content: `${SYS}\n\nUser: كيف حال البورصة المصرية اليوم؟` },
      ],
      thinking: { type: "enabled" },
      stream: true,
    });
    let out = "", reasoning = "", served = "";
    const reader = (res as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder();
    let buf = "";
    const t0 = Date.now();
    let firstReasoningAt = 0, firstContentAt = 0;
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
          if (typeof d?.reasoning_content === "string" && d.reasoning_content) {
            if (!firstReasoningAt) firstReasoningAt = Date.now() - t0;
            reasoning += d.reasoning_content;
          }
          if (typeof d?.content === "string" && d.content) {
            if (!firstContentAt) firstContentAt = Date.now() - t0;
            out += d.content;
          }
        } catch {}
      }
    }
    console.log(`served=${served} ms=${Date.now() - t0}`);
    console.log(`reasoning: len=${reasoning.length} firstAt=${firstReasoningAt}ms sample="${reasoning.slice(0, 200).replace(/\n/g, " ")}"`);
    console.log(`content: firstAt=${firstContentAt}ms out="${out.slice(0, 120).replace(/\n/g, " ")}"`);
  } catch (e) {
    console.log("SDK thinking probe FAILED:", e instanceof Error ? e.message : String(e));
  }
}

async function probeLlm7Protocol(model: string) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const res = await fetch("https://api.llm7.io/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYS },
          { role: "user", content: "كيف حال البورصة المصرية اليوم؟" },
        ],
        stream: true,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.log(`llm7 ${model}: HTTP ${res.status} (${Date.now() - t0}ms) ${detail.slice(0, 140)}`);
      return;
    }
    let out = "", reasoning = "", served = "";
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
          if (typeof j.model === "string" && !served) served = j.model;
          const d = j.choices?.[0]?.delta;
          if (typeof d?.reasoning_content === "string") reasoning += d.reasoning_content;
          if (typeof d?.content === "string") out += d.content;
        } catch {}
      }
    }
    const okJson = /^\s*\{\s*"tool"\s*:\s*"market_overview"/.test(out);
    console.log(
      `llm7 ${model}: ${Date.now() - t0}ms served=${served} strictJson=${okJson} reasoningLen=${reasoning.length} out="${out.slice(0, 100).replace(/\n/g, " ")}"`
    );
  } catch (e) {
    console.log(`llm7 ${model}: FAILED (${Date.now() - t0}ms) ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  await probeSdkThinking();
  console.log("\n=== llm7 catalog GLMs + registry models under the real protocol ===");
  for (const m of ["glm-5.3", "glm-5.2", "GLM-5.3-Flash", "codestral-latest", "mistral-Nemo-Instruct-2407", "minimax-m2.7"]) {
    await probeLlm7Protocol(m);
  }
}

main().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
