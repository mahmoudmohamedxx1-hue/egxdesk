/** T42 — VLM visual QA on the ensemble UI screenshots. */
import ZAI from "z-ai-web-dev-sdk";
import { readFileSync } from "node:fs";

const SHOTS: { file: string; ask: string }[] = [
  {
    file: "scripts/data-test/t42-ai-signals-ar.png",
    ask: "This is the AI Signals tab of an Arabic (RTL) Egyptian stock-market web app. Answer strictly as JSON {\"CHIPS\": yes/no (colored strategy-name chips on pick cards), \"METER\": yes/no (small segmented vote meter like 8/11), \"TABLE\": yes/no (per-strategy backtest table with strategy names and numbers), \"OVERLAP\": yes/no, \"STRAY_ENGLISH\": yes/no (English words inside Arabic sentences), \"ISSUES\": \"none\" or short list}.",
  },
  {
    file: "scripts/data-test/t42-ai-mobile.png",
    ask: "This is the mobile (390px) AI Signals tab of an Arabic RTL stock-market app. Answer strictly as JSON {\"OVERFLOW\": yes/no (content cut at screen edges), \"CHIPS_WRAP\": yes/no (chips wrap to multiple lines without overlap), \"TABLE_SCROLL\": yes/no, \"ISSUES\": \"none\" or short list}.",
  },
];

async function main() {
  const client = await ZAI.create();
  for (const s of SHOTS) {
    const b64 = readFileSync(s.file).toString("base64");
    const res = await client.chat.completions.createVision({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: s.ask },
            { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
          ],
        },
      ],
      thinking: { type: "disabled" },
    });
    const out = (res as unknown as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
    console.log(`=== ${s.file} ===`);
    console.log(out.trim().slice(0, 600));
    console.log();
  }
}
main().catch((e) => {
  console.error("VLM check failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
