const fs = require("fs");
const ZAI = require("z-ai-web-dev-sdk").default;

async function main() {
  const zai = await ZAI.create();
  const shots = [
    ["/tmp/t64-ar2.png", "cheap stocks screen in ARABIC (RTL)"],
    ["/tmp/t64-ar3.png", "model lab valuation workbench in ARABIC (RTL)"],
    ["/tmp/t64-mob1.png", "valuation map on MOBILE 375px"],
    ["/tmp/t64-mob2.png", "model lab workbench on MOBILE 375px"],
    ["/tmp/t64-lens1.png", "valuation map with fair-value lens + hover card"],
    ["/tmp/t64-final.png", "model lab workbench desktop final"],
  ];
  for (const [p, label] of shots) {
    const b64 = fs.readFileSync(p).toString("base64");
    const r = await zai.chat.completions.createVision({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `This is a screenshot of a financial app's "${label}" page. Audit it: 1) Does it render cleanly (no blank areas, no overlapping text, no broken layout)? 2) Are the SVG map bubbles, legend, filter chips, cards/table visible and readable? 3) Any visual defects (cut-off text, misaligned elements, empty regions that look broken)? Answer in under 120 words, list defects if any.` },
            { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
          ],
        },
      ],
      thinking: { type: "disabled" },
    });
    console.log(`\n=== ${label} ===\n${r.choices[0]?.message?.content ?? "no content"}`);
  }
}
main().catch((e) => { console.error("VLM audit failed:", e.message); process.exit(1); });
