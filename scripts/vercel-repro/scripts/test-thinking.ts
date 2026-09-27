/** Verify whether z-ai-web-dev-sdk honors thinking:{type:"enabled"} and
 *  where the reasoning lands (content vs reasoning_content). */
import ZAI from "z-ai-web-dev-sdk";

const zai = await ZAI.create();

const PROMPT =
  "A bank trades at P/E 5.85, P/B 2.49, ROE 49.7%, up 144% YTD. Another at P/E 6.64, P/B 1.97, ROE 34.4%, up 34% YTD. Which is 'cheaper' and what nuance matters? Think carefully, then answer in 3 sentences.";

for (const type of ["disabled", "enabled"] as const) {
  const t0 = Date.now();
  try {
    const completion = await zai.chat.completions.create({
      messages: [{ role: "user", content: PROMPT }],
      thinking: { type },
    });
    const msg = completion.choices[0]?.message;
    const elapsed = Date.now() - t0;
    const reasoning = (msg as unknown as Record<string, unknown>)?.reasoning_content;
    console.log(`\n=== thinking: ${type} === ${elapsed}ms`);
    console.log("message keys:", Object.keys(msg ?? {}));
    console.log("reasoning_content chars:", typeof reasoning === "string" ? reasoning.length : "(none)");
    console.log("content preview:", (msg?.content ?? "").slice(0, 220).replace(/\n/g, " "));
  } catch (err) {
    console.log(`\n=== thinking: ${type} === FAILED:`, err instanceof Error ? err.message : err);
  }
}
