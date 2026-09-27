/** T45 — VLM visual QA on the autonomous-agent UI screenshots. */
import ZAI from "z-ai-web-dev-sdk";
import { readFileSync } from "node:fs";

const SHOTS: { file: string; ask: string }[] = [
  {
    file: "scripts/qa/t45-desktop-en.png",
    ask: 'This is the AI Signals tab (English) of an Egyptian stock-market web app. It should show an "autonomous self-learning agent" section (badges glm-4.7-flash / glm-4.6v-flash, a next-run countdown, a journal quote, vision chart reads, learning panel, lessons journal) and a "Live signal feed" with event rows. Answer strictly as JSON {"AGENT_SECTION": yes/no, "MODEL_BADGES": yes/no, "LIVE_FEED": yes/no (event rows with titles and times), "OVERLAP": yes/no (any overlapping/clipped elements), "ISSUES": "none" or short list}.',
  },
  {
    file: "scripts/qa/t45-mobile-en.png",
    ask: 'This is the mobile (390px) AI Signals tab (English). Answer strictly as JSON {"OVERFLOW": yes/no (content cut at screen edges or horizontal scroll), "AGENT_SECTION": yes/no, "READABLE": yes/no, "ISSUES": "none" or short list}.',
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
    const text = res.choices[0]?.message?.content ?? "";
    console.log(`\n=== ${s.file} ===\n${text.trim().slice(0, 500)}`);
  }
}

void main();
