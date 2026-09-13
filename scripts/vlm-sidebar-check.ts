/** Task 24 visual QA on the browser screenshots. */
import ZAI from "z-ai-web-dev-sdk";
import { readFileSync } from "node:fs";

async function main() {
  const zai = await ZAI.create();
  const files = [
    "/home/z/my-project/scripts/data-test/t24-agent-desktop-final.png",
    "/home/z/my-project/scripts/data-test/t24-agent-mobile-open.png",
  ];
  for (const f of files) {
    const b64 = readFileSync(f).toString("base64");
    const completion = await zai.chat.completions.createVision({
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
            {
              type: "text",
              text: "This is a screenshot of an Arabic RTL financial-dashboards AI chat page. Verify: (1) Is there a chat-history SIDEBAR panel visible (with a list of past chat titles)? On which side of the screen? (2) Does the main chat area remain fully usable (greeting/messages + input box at bottom)? (3) Any layout breakage, overlapping elements, or cut-off content? Answer concisely: SIDEBAR: yes/no + side | CHAT_OK: yes/no | ISSUES: none | <describe>",
            },
          ],
        },
      ],
    });
    console.log(`\n=== ${f.split("/").pop()} ===`);
    console.log(completion.choices[0]?.message?.content ?? "(no content)");
  }
}

void main();
