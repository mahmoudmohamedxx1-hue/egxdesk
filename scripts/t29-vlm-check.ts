/** T29 VLM QA — visual verification of the new cloud-model assistant. */
import ZAI from "z-ai-web-dev-sdk";
import { readFileSync } from "node:fs";

type Shot = { file: string; ask: string };
const SHOTS: Shot[] = [
  {
    file: "scripts/data-test/t29-assistant-welcome-ar.png",
    ask: "This is an AI assistant popup on an Arabic market-data website. Answer JSON {\"WELCOME\":bool,\"SUGGESTIONS\":count,\"COMPOSER\":bool,\"RING\":bool,\"SEND_ORB\":bool,\"MIC_BUTTON\":bool,\"ISSUES\":\"none\" or a short note}. WELCOME=welcome card with title visible; SUGGESTIONS=number of suggestion pill chips; COMPOSER=rounded input box at bottom; RING=decorative ring/border around composer; SEND_ORB=circular send button; MIC_BUTTON=any microphone/voice button visible?",
  },
  {
    file: "scripts/data-test/t29-model-menu-ar.png",
    ask: "This is a model-selector dropdown menu for an AI assistant. Answer JSON {\"CLOUD_SECTION\":bool,\"GLM53\":bool,\"NEWEST_BADGE\":bool,\"OTHER_MODELS\":list of up to 5 model names you see,\"SIGNIN_ROW\":bool,\"ISSUES\":\"none\" or short note}. CLOUD_SECTION=section about free cloud models (Puter); GLM53=GLM-5.3 entry visible; NEWEST_BADGE='الأحدث/newest' badge on some rows; SIGNIN_ROW=free sign-in button row.",
  },
  {
    file: "scripts/data-test/t29-assistant-mobile-ar.png",
    ask: "This is an AI assistant popup on a mobile (390px) Arabic website. Answer JSON {\"NEAR_FULLSCREEN\":bool,\"CLIPPED\":bool,\"COMPOSER\":bool,\"ISSUES\":\"none\" or short note}. NEAR_FULLSCREEN=popup fills most of the viewport; CLIPPED=any text/buttons cut off horizontally?",
  },
];

async function main() {
  const client = await ZAI.create();
  let pass = 0;
  let fail = 0;
  for (const s of SHOTS) {
    const b64 = readFileSync(s.file).toString("base64");
    try {
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
      const out = (res as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
      console.log(`\n=== ${s.file.split("/").pop()} ===`);
      console.log(out.slice(0, 700));
      const ok = /"ISSUES"\s*:\s*"none"/i.test(out) || /"ISSUES"\s*:\s*none/i.test(out);
      ok ? pass++ : fail++;
    } catch (err) {
      console.log(`VLM FAIL ${s.file}: ${String(err).slice(0, 120)}`);
      fail++;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  console.log(`\nVLM: ${pass} pass / ${fail} fail`);
}

main().catch((e) => {
  console.error("crashed", e);
  process.exit(1);
});
