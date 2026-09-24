/** T59 — VLM audit of the ownership lens screenshots (light + dark). */
import ZAI from "z-ai-web-dev-sdk";
import { readFileSync } from "node:fs";

const SHOTS: { file: string; ask: string }[] = [
  {
    file: "scripts/research/t59-lens-light.png",
    ask: 'This is an "Ownership Lens" map of the Egyptian stock exchange (Arabic RTL UI). It should show sector lake shapes with company donut-ring circles and ticker labels inside them. Answer strictly as JSON: {"THEME":"light|dark|unknown","TICKERS_READABLE":"yes|no|partial — are the stock ticker labels inside the circles clearly readable against the background?","WASHED_OUT":"yes|no — is any text nearly invisible (too light on light background)?","OVERLAPS":"yes|no — do circles/labels overlap badly?","PANEL":"yes|no — is there a side panel with a register/search list?","ISSUES":"none or a short list of concrete visual problems"}.',
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
    });
    console.log("=== " + s.file + " ===");
    console.log(res.choices[0]?.message?.content ?? "no content");
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
