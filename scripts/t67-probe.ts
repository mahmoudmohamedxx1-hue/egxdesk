/** T67 probe — is the sandbox SDK path (GLM-4-Plus) alive, and does it
 *  emit reasoning_content we can stream live? Also probe each llm7 registry
 *  model to see which ones are dead. */
import ZAI from "z-ai-web-dev-sdk";

async function probeSdk() {
  console.log("=== 1. SDK gateway (sandbox path, model glm-4-plus) ===");
  const t0 = Date.now();
  try {
    const zai = await ZAI.create();
    const res = await zai.chat.completions.create({
      model: "glm-4-plus",
      messages: [
        { role: "user", content: "Reply with exactly: OK-4-PLUS" },
      ],
      thinking: { type: "enabled" },
      stream: true,
    });
    let out = "";
    let reasoning = "";
    let served = "";
    if (res && typeof (res as any).getReader === "function") {
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
            if (typeof d?.content === "string") out += d.content;
            if (typeof d?.reasoning_content === "string") reasoning += d.reasoning_content;
          } catch {}
        }
      }
    } else {
      const c = res as any;
      served = c.model ?? "";
      out = c.choices?.[0]?.message?.content ?? "";
      reasoning = c.choices?.[0]?.message?.reasoning_content ?? "";
    }
    console.log(`served=${served || "<none>"} ms=${Date.now() - t0}`);
    console.log(`content="${out.slice(0, 120)}"`);
    console.log(`reasoning len=${reasoning.length} sample="${reasoning.slice(0, 150).replace(/\n/g, " ")}"`);
  } catch (e) {
    console.log(`SDK FAILED after ${Date.now() - t0}ms:`, e instanceof Error ? e.message : String(e));
  }
}

async function probeLlm7(model: string) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch("https://api.llm7.io/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        stream: true,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.log(`llm7 ${model}: HTTP ${res.status} (${Date.now() - t0}ms) ${detail.slice(0, 100)}`);
      return;
    }
    let out = "";
    let served = "";
    if (res.body) {
      const reader = res.body.getReader();
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
            if (typeof d?.content === "string") out += d.content;
          } catch {}
        }
      }
    }
    console.log(`llm7 ${model}: OK (${Date.now() - t0}ms) served=${served} out="${out.slice(0, 60).replace(/\n/g, " ")}"`);
  } catch (e) {
    console.log(`llm7 ${model}: FAILED (${Date.now() - t0}ms) ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  await probeSdk();
  console.log("\n=== 2. LLM7 registry models ===");
  for (const m of ["GLM-5.3-Flash", "codestral-latest", "mistral-Nemo-Instruct-2407", "minimax-m2.7"]) {
    await probeLlm7(m);
  }
  console.log("\n=== 3. LLM7 model list (what does the catalog serve?) ===");
  try {
    const res = await fetch("https://api.llm7.io/v1/models", { signal: AbortSignal.timeout(20_000) });
    if (res.ok) {
      const j = (await res.json()) as any;
      const ids: string[] = (j.data ?? []).map((d: any) => d.id);
      console.log(`total models: ${ids.length}`);
      const interesting = ids.filter((id) => /glm|glm-4|glm-5/i.test(id));
      console.log("GLM-family ids:", interesting.join(", ") || "<none>");
    } else {
      console.log("models endpoint HTTP", res.status);
    }
  } catch (e) {
    console.log("models endpoint failed:", e instanceof Error ? e.message : String(e));
  }
}

main().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
