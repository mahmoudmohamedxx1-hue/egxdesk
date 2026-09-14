// Quick probe: what model does the gateway actually serve for chat.completions?
import "dotenv/config";
import ZAI from "z-ai-web-dev-sdk";

async function main() {
  try {
    const zai = await ZAI.create();
    const res = await zai.chat.completions.create({
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      stream: false,
    });
    const r = res;
    console.log("MODEL:", r.model);
    console.log("CONTENT:", r.choices?.[0]?.message?.content?.slice(0, 80));
  } catch (e) {
    console.error("ERR:", e.message);
  }
}
void main();
