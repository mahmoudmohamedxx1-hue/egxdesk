// T66 — final VLM audit: lens moves (WHO visible) + valuation map (names, spread)
const ZAI = (await import("z-ai-web-dev-sdk")).default;
const fs = await import("node:fs/promises");

const zai = await ZAI.create();

const shots = [
  [
    "t66-lens-moves.png",
    "An Arabic ownership-lens map (islands of company rings) with a week of stake moves selected. CRITICAL CHECKS: (1) Is there a MOVES PANEL on the right listing moves where the HOLDER'S NAME (a person or company name in Arabic) is the PROMINENT first element of each row? (2) On the map board, do some moved company rings have small colored arc labels showing BOTH a number like +4.21p AND a holder NAME next to it? (3) Do moved companies have pulsing halos? (4) Any broken layout or overlapping text? Answer in 3-4 sentences.",
  ],
  [
    "t66-val-final.png",
    "A 2D valuation bubble map in Arabic (log-scale P/E x D/E). CHECKS: (1) Roughly how many bubbles carry readable ticker name labels? (2) Are bubbles well-spread across the plot area (not crammed into one corner)? (3) Are axis tick values visible at the bottom (5x, 10x, 20x, 50x...)? (4) Any overlapping/unreadable labels or text over the axis chrome? Answer concisely.",
  ],
];

for (const [file, prompt] of shots) {
  const b64 = await fs.readFile(`/home/z/my-project/scripts/qa/${file}`, "base64");
  const res = await zai.chat.completions.createVision({
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
          { type: "text", text: prompt + " Be specific and honest." },
        ],
      },
    ],
  });
  const text = res.choices?.[0]?.message?.content ?? "(no answer)";
  console.log(`\n=== ${file} ===\n${text.trim().slice(0, 700)}`);
}
