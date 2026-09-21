/** Probe the z-ai gateway for the most updated GLM chat model available. */
import ZAI from "z-ai-web-dev-sdk";

const CANDIDATES = ["glm-5", "glm-4.6", "glm-4-plus", "totally-bogus-model"];

async function main() {
  const client = await ZAI.create();
  const results: { model: string; ok: boolean; served?: string; note: string }[] = [];
  for (const model of CANDIDATES) {
    try {
      const res = (await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: "Reply with the single word OK." },
          { role: "user", content: "ping" },
        ],
        thinking: { type: "disabled" },
        max_tokens: 200,
      })) as { choices?: { message?: { content?: string } }[]; model?: string };
      const content = res.choices?.[0]?.message?.content ?? "";
      const served = (res as { model?: string }).model ?? "";
      results.push({ model, ok: true, served, note: content.slice(0, 40).replace(/\s+/g, " ") });
      console.log(`OK   ${model.padEnd(18)} served=${served || "?"} :: ${content.slice(0, 40).replace(/\s+/g, " ")}`);
    } catch (err) {
      const e = err as { status?: number; message?: string };
      results.push({ model, ok: false, note: `${e.status ?? ""} ${String(e.message ?? "").slice(0, 80)}` });
      console.log(`FAIL ${model.padEnd(18)} ${e.status ?? ""} ${String(e.message ?? "").slice(0, 80)}`);
    }
    await new Promise((r) => setTimeout(r, 4000)); // dodge the 429 throttle
  }
  console.log("\n=== SUMMARY ===");
  console.log(results.filter((r) => r.ok).map((r) => `${r.model} (served: ${r.served || "?"})`).join("\n") || "none worked");
}

main().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
