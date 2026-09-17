/** T35 probe — which models does the z-ai gateway ACTUALLY serve?
 *  Sends a real-sized prompt with different `model` ids and records the
 *  served model + answer style, to find genuinely distinct server models. */
import ZAI from "z-ai-web-dev-sdk";

const CANDIDATES = [
  undefined, // no model param (baseline)
  "glm-4-plus",
  "glm-4-flash",
  "glm-4.5-flash",
  "glm-4.6",
  "glm-4-0520",
  "glm-4.7",
  "glm-5",
  "glm-5.3",
];

const PROMPT = `You are a stock market analyst. In 2-3 sentences: what drives the P/E ratio of a bank stock like CIB on the Egyptian Exchange? Answer in English.`;

async function main() {
  const zai = await ZAI.create();
  for (const m of CANDIDATES) {
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45_000);
      const completion = await zai.chat.completions.create({
        messages: [
          { role: "assistant", content: "You are a precise equity analyst." },
          { role: "user", content: PROMPT },
        ],
        ...(m ? { model: m } : {}),
        thinking: { type: "disabled" },
      });
      clearTimeout(timer);
      const txt = completion?.choices?.[0]?.message?.content ?? "";
      const served = (completion as unknown as { model?: string }).model ?? "?";
      const usage = (completion as unknown as { usage?: unknown }).usage;
      console.log(
        `[${m ?? "(none)"}] OK ${Date.now() - t0}ms served=${served} len=${txt.length} :: ${txt.slice(0, 90).replace(/\n/g, " ")}`
      );
      if (usage) console.log(`    usage=${JSON.stringify(usage).slice(0, 140)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[${m ?? "(none)"}] FAIL ${Date.now() - t0}ms :: ${msg.slice(0, 160)}`);
    }
  }
}
main().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
