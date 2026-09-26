/** T67 — VLM visual QA on the agent thinking UI, lens moves labels, and the
 *  valuation impact panel. */
import ZAI from "z-ai-web-dev-sdk";
import { readFileSync } from "node:fs";

const SHOTS: { file: string; ask: string }[] = [
  {
    file: "scripts/qa/t67-valuation-impact.png",
    ask: 'This is the valuation map page of an Arabic (RTL) Egyptian stock-market web app. Below the bubble map there should be a per-company impact panel titled "أثر كل شركة". Answer strictly as JSON {"PANEL": yes/no (titled panel below the map), "SUMMARY": yes/no (summary strip with counts like مرتفعة على قيمها 35), "ROWS": yes/no (company rows each with P/E, D/E and verdict chips), "IMPACT_SENTENCES": yes/no (Arabic sentence under each row describing rich/cheap vs fair value and debt weight), "OVERLAP": yes/no, "ISSUES": "none" or short list}.',
  },
  {
    file: "scripts/qa/t67-lens-moves.png",
    ask: 'This is the Ownership Lens page of an Arabic (RTL) stock-market web app with a chosen week\'s moves panel. Answer strictly as JSON {"MOVES_PANEL": yes/no (panel titled تحركات الأسبوع listing stake moves), "POINT_LABEL": yes/no (the change column reads like "-6.50 نقطة ملكية" NOT a bare "p" suffix), "HOLDER_NAMES": yes/no (each row leads with a holder name), "LEGEND": yes/no (legend explains the point unit), "OVERLAP": yes/no, "ISSUES": "none" or short list}.',
  },
  {
    file: "scripts/qa/t67-agent-answer.png",
    ask: 'This is the AI Agent chat page of an Arabic (RTL) stock-market web app after an answer. Answer strictly as JSON {"ANSWER": yes/no (an Arabic answer about the market is visible), "ENGINE_CHIP": yes/no (top bar shows GLM-4-Plus engine), "SERVED_CHIP": yes/no (a small chip showing the model that actually served, e.g. glm-4-plus), "TOOL_CHIPS": yes/no (tool usage chips like نظرة السوق), "THINK_PANEL": yes/no (a collapsible reasoning-trail panel is visible), "OVERLAP": yes/no, "ISSUES": "none" or short list}.',
  },
];

async function main() {
  const client = await ZAI.create();
  let fails = 0;
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
    const out = (res as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
    console.log(`\n=== ${s.file.split("/").pop()} ===`);
    console.log(out.trim().slice(0, 600));
    if (/ISSUES"\s*:\s*"(?!none)/i.test(out) && !/"ISSUES":\s*"none"/i.test(out)) fails++;
  }
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("VLM audit failed:", e);
  process.exit(1);
});
