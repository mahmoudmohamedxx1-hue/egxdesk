import ZAI from "z-ai-web-dev-sdk";
import { readFileSync } from "node:fs";
async function main() {
  const client = await ZAI.create();
  const b64 = readFileSync("scripts/data-test/t42-per-strategy-table.png").toString("base64");
  const res = await client.chat.completions.createVision({
    messages: [{ role: "user", content: [
      { type: "text", text: 'This shows a per-strategy backtest table in an Arabic RTL stock app (strategy name, family, trades, hit rate, avg, profit factor, 3y cumulative; two rows say "مباشر فقط" live-only). Answer strictly as JSON {"TABLE": yes/no, "ROWS": <approx row count>, "READABLE": yes/no, "LIVE_ONLY_ROWS": yes/no, "ISSUES": "none" or short list}.' },
      { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
    ]}],
    thinking: { type: "disabled" },
  });
  console.log((res as unknown as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content?.trim().slice(0, 400));
}
main().catch((e) => { console.error(e); process.exit(1); });
