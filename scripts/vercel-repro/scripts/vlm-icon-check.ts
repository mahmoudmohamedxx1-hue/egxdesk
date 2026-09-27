/** Task 24 QA — visually verify the regenerated favicon set with VLM:
 *  the icons must show ONLY the hexagon EGXDesk mark (no "EGXDesk" wordmark,
 *  no full-photo look), centered on the charcoal rounded tile. */
import ZAI from "z-ai-web-dev-sdk";
import { readFileSync } from "node:fs";

async function main() {
  const zai = await ZAI.create();

  const files = [
    { path: "/home/z/my-project/public/icon-192.png", label: "icon-192" },
    { path: "/home/z/my-project/public/icon-512.png", label: "icon-512" },
  ];

  for (const { path, label } of files) {
    const b64 = readFileSync(path).toString("base64");
    const completion = await zai.chat.completions.createVision({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${b64}` },
            },
            {
              type: "text",
              text:
                'This is a website favicon candidate. Answer these 3 questions concisely: (1) Is there ANY text or wordmark visible (letters/words)? (2) Describe the main shape you see. (3) Is the shape a single centered logo mark, or does it look like a shrunken full photo/poster with multiple elements? Format: TEXT: yes/no | SHAPE: ... | LOOKS: mark-only | full-photo',
            },
          ],
        },
      ],
    });
    console.log(`\n=== ${label} ===`);
    console.log(completion.choices[0]?.message?.content ?? "(no content)");
  }
}

void main();
