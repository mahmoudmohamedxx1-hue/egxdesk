/** T27 QA — VLM visual check of the new UI surfaces. */
import ZAI from "z-ai-web-dev-sdk";
import { readFileSync } from "node:fs";

async function main() {
  const zai = await ZAI.create();
  const shots: { file: string; ask: string }[] = JSON.parse(readFileSync(process.argv[2] ?? "[]", "utf-8"));
  for (const s of shots) {
    const b64 = readFileSync(`/home/z/my-project/scripts/data-test/${s.file}`).toString("base64");
    const c = await zai.chat.completions.createVision({
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
            { type: "text", text: s.ask },
          ],
        },
      ],
    });
    console.log(`--- ${s.file} ---`);
    console.log(c.choices[0]?.message?.content);
  }
}
main().catch((e) => console.error(e.message));
