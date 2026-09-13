/** Precise VLM check: does the mark (zoomed) contain any leaked wordmark
 *  fragment like "DESK", or is the bottom region just hexagon lines? */
import ZAI from "z-ai-web-dev-sdk";
import { readFileSync } from "node:fs";

async function main() {
  const zai = await ZAI.create();
  const files = ["diag-mark-bottom-right", "diag-mark-bottom-strip", "diag-mark-full"];
  for (const name of files) {
    const b64 = readFileSync(`/home/z/my-project/scripts/data-test/${name}.png`).toString("base64");
    const completion = await zai.chat.completions.createVision({
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
            {
              type: "text",
              text: "Look very carefully at this image (a zoomed crop of a logo). List EVERY distinct element you can identify. Specifically: is there any readable word or letter sequence like 'DESK', 'EGX', 'EGXDESK'? Or is everything just geometric logo lines/shapes? Answer in this format: ELEMENTS: ... | READABLE_WORDS: none | <list them>",
            },
          ],
        },
      ],
    });
    console.log(`\n=== ${name} ===`);
    console.log(completion.choices[0]?.message?.content ?? "(no content)");
  }
}

void main();
