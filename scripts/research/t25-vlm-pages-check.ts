/** T25 QA — VLM visual check of rendered report pages. */
import ZAI from "z-ai-web-dev-sdk";
import { readFileSync } from "node:fs";

const pages = [1, 3, 6, 8, 11];

async function main() {
  const zai = await ZAI.create();
  for (const n of pages) {
    const b64 = readFileSync(`/home/z/my-project/scripts/research/t25/page${n}.png`).toString("base64");
    const c = await zai.chat.completions.createVision({
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
            {
              type: "text",
              text:
                "This is one page of a professional PDF report. Answer concisely: (1) Any overlapping text, cut-off text, or content bleeding past margins? (2) Do tables (if any) look properly formatted with readable text? (3) Overall layout quality issue, if any? Format: PAGE_OK: yes/no | ISSUES: <none or list>",
            },
          ],
        },
      ],
    });
    console.log(`--- page ${n} ---`);
    console.log(c.choices[0]?.message?.content);
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
