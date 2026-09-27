/** T36 live test — the KEYLESS LLM7 agent path end-to-end through the real
 *  /api/agent SSE route: strict-JSON tool loop, real data tools, honest
 *  served-model reporting. The whole point: models that need NO Puter
 *  sign-in, NO key, NO card — they must just answer. */
const BASE = "http://localhost:3000";

async function ask(model: string, question: string) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: question }],
      lang: "en",
      deviceId: "t36-keyless-test-device",
      model,
    }),
  });
  if (!res.ok || !res.body) {
    console.log(`[${model}] HTTP ${res.status} — FAIL`);
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let answer = "";
  let servedModel = "";
  const steps: { tool: string; ok: boolean }[] = [];
  const statuses: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      try {
        const j = JSON.parse(line.slice(5));
        if (j.type === "step") steps.push({ tool: j.tool, ok: j.ok });
        if (j.type === "status") statuses.push(j.note);
        if (j.type === "done") {
          answer = j.answer ?? "";
          servedModel = j.model ?? "";
        }
        if (j.type === "error") {
          console.log(`[${model}] ERROR event: ${j.message} (${j.status}) ${j.detail ?? ""}`);
          return;
        }
      } catch {}
    }
  }
  console.log(
    `[${model}] ${Date.now() - t0}ms served=${servedModel} tools=[${steps.map((s) => `${s.tool}${s.ok ? "✓" : "✗"}`).join(",")}] statuses=[${statuses.join("|")}] len=${answer.length}`,
  );
  console.log(`    answer: ${answer.slice(0, 220).replace(/\n/g, " ")}`);
}

async function main() {
  console.log("1) Mistral Nemo (keyless) — quote question with tools");
  await ask("llm7:mistral-Nemo-Instruct-2407", "What is the last price of COMI? One line.");
  await new Promise((r) => setTimeout(r, 8000)); // respect the shared pool
  console.log("\n2) Codestral (keyless) — market overview");
  await ask("llm7:codestral-latest", "Give me a 2-line market overview of the Egyptian Exchange now.");
  console.log("\n3) MiniMax M2.7 (keyless) — screener question");
  await ask("llm7:minimax-m2.7", "Name the top 3 stocks by market cap. One line each.");
  console.log("\n4) GLM-4-Plus (server default) — regression check");
  await ask("glm-4-plus", "What is the last price of HDBK? One line.");
}
main();
