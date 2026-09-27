/** T28 — VLM QA on the assistant popup screenshots. */
import ZAI from "z-ai-web-dev-sdk";
import { readFileSync } from "node:fs";

const SHOTS: { file: string; ask: string }[] = [
  {
    file: "scripts/data-test/t28-popup-open.png",
    ask: "This is an AI assistant popup on a stock market web app (Arabic RTL). Answer strictly as JSON {\"WELCOME\": yes/no, \"SUGGESTIONS\": <count of suggestion chips>, \"COMPOSER\": yes/no, \"RING\": yes/no (animated gradient ring around the input box), \"SEND_ORB\": yes/no (round gradient send button), \"ISSUES\": \"none\" or a short list}. Does the welcome card, suggestion chips, and a composer with a glowing ring border and round send button all appear?",
  },
  {
    file: "scripts/data-test/t28-model-menu.png",
    ask: "This shows a model selector menu for an AI assistant. Answer strictly as JSON {\"MENU\": yes/no, \"ENTRIES\": <approx count of rows>, \"FEATURED\": yes/no (SmolLM/TinyLlama/Gemma/Qwen/Llama style entries visible), \"SIZES\": yes/no (GB labels visible), \"ALL_BUTTON\": yes/no, \"ISSUES\": \"none\" or short list}.",
  },
  {
    file: "scripts/data-test/t28-mobile-open.png",
    ask: "This is an AI assistant popup on a 390px mobile viewport (Arabic RTL). Answer strictly as JSON {\"NEAR_FULLSCREEN\": yes/no, \"HEADER\": yes/no, \"KEYBOARD_HINT\": yes/no, \"CLIPPED\": yes/no (anything cut off the screen edges), \"ISSUES\": \"none\" or short list}.",
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
    console.log(out.trim().slice(0, 500));
    console.log();
  }
}

main().catch((e) => {
  console.error("VLM check failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
