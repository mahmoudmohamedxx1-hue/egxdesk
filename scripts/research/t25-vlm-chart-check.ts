/** T25 QA — VLM check of the positioning chart for label overlap. */
import ZAI from "z-ai-web-dev-sdk";
import { readFileSync } from "node:fs";

async function main() {
  const zai = await ZAI.create();
  const b64 = readFileSync("/home/z/my-project/scripts/research/t25/c2-positioning.png").toString("base64");
  const c = await zai.chat.completions.createVision({
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
          {
            type: "text",
            text:
              "This is a scatter positioning map with ~17 labeled dots. Answer strictly: (1) Do any text labels overlap each other or overlap dots, making them hard to read? List which. (2) Are all labels fully inside the plot area (not cut off)? (3) Is the highlighted 'EGX DESK' dot clearly visible and distinct? Format: OVERLAPS: none | <list> | CUTOFF: none | <list> | HIGHLIGHT: yes/no",
          },
        ],
      },
    ],
  });
  console.log(c.choices[0]?.message?.content);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
