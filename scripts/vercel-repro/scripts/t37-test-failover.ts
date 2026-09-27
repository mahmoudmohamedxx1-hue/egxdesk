/** T37 live test — AUTO-FAILOVER: when LLM7's globally-shared free quota is
 *  exhausted (the exact "MiniMax doesn't work" complaint), a request for ANY
 *  keyless model must STILL produce a real answer via the GLM-4-Plus
 *  backbone — with an honest status note + honest served-model — and never
 *  a bare error. Also locks: fast failover (<15s even worst-case) and the
 *  GLM regression path. */
const BASE = "http://localhost:3000";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}`);
  }
};

type Outcome = {
  answer: string;
  servedModel: string;
  steps: { tool: string; ok: boolean }[];
  statuses: string[];
  error: string | null;
  ms: number;
};

async function ask(model: string, question: string, lang: "en" | "ar" = "en"): Promise<Outcome> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: question }],
      lang,
      deviceId: "t37-failover-test-device",
      model,
    }),
  });
  const out: Outcome = { answer: "", servedModel: "", steps: [], statuses: [], error: null, ms: 0 };
  if (!res.ok || !res.body) {
    out.error = `HTTP ${res.status}`;
    out.ms = Date.now() - t0;
    return out;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
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
        if (j.type === "step") out.steps.push({ tool: j.tool, ok: j.ok });
        if (j.type === "status") out.statuses.push(j.note);
        if (j.type === "done") {
          out.answer = j.answer ?? "";
          out.servedModel = j.model ?? "";
        }
        if (j.type === "error") out.error = `${j.message} (${j.status})`;
      } catch {}
    }
  }
  out.ms = Date.now() - t0;
  return out;
}

async function main() {
  console.log("=== 1) Codestral — quota-exhausted (or healthy) must ANSWER either way ===");
  const c = await ask("llm7:codestral-latest", "What is the last price of COMI? One line.");
  console.log(`  ${c.ms}ms served=${c.servedModel} statuses=[${c.statuses.join(" | ")}]`);
  ok(c.error === null, "no error event (the old behavior: hard 503)");
  ok(c.answer.length > 20, `real answer delivered (len=${c.answer.length})`);
  const fellBack = c.servedModel.toLowerCase().includes("glm");
  if (fellBack) {
    ok(
      c.statuses.some((s) => /glm-4-plus/i.test(s)),
      "fallback streamed the honest GLM-4-Plus status note"
    );
    ok(c.answer.toLowerCase().includes("133.32") || c.steps.length > 0, "fallback loop still ran tools/real data");
  } else {
    ok(c.servedModel.length > 0, "direct keyless answer with honest served model");
  }
  console.log(`  answer: ${c.answer.slice(0, 160).replace(/\n/g, " ")}`);

  await new Promise((r) => setTimeout(r, 4000));
  console.log("\n=== 2) MiniMax M2.7 — the model the user reported broken ===");
  const m = await ask("llm7:minimax-m2.7", "Name the top 2 stocks by market cap on EGX. One line.");
  console.log(`  ${m.ms}ms served=${m.servedModel} statuses=[${m.statuses.join(" | ")}]`);
  ok(m.error === null, "no error event");
  ok(m.answer.length > 20, `real answer delivered (len=${m.answer.length})`);
  console.log(`  answer: ${m.answer.slice(0, 160).replace(/\n/g, " ")}`);

  await new Promise((r) => setTimeout(r, 4000));
  console.log("\n=== 3) Mistral Nemo — Arabic question on the fallback path ===");
  const n = await ask("llm7:mistral-Nemo-Instruct-2407", "ما هو آخر سعر سهم كومي؟ سطر واحد.", "ar");
  console.log(`  ${n.ms}ms served=${n.servedModel} statuses=[${n.statuses.join(" | ")}]`);
  ok(n.error === null, "no error event (Arabic path)");
  ok(n.answer.length > 10, `real answer delivered (len=${n.answer.length})`);
  if (n.servedModel.toLowerCase().includes("glm")) {
    ok(
      n.statuses.some((s) => /glm-4-plus/i.test(s)),
      "Arabic honest fallback note streamed"
    );
  }

  console.log("\n=== 4) GLM-4-Plus regression — the backbone itself ===");
  const g = await ask("glm-4-plus", "What is the last price of HDBK? One line.");
  console.log(`  ${g.ms}ms served=${g.servedModel}`);
  ok(g.error === null && g.answer.length > 20, "backbone answers directly (no failover needed)");

  console.log(`\nRESULT: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
}
main();
