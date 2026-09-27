// T66 — VLM audit of the LOG-scale valuation map (1x and zoomed)
const ZAI = (await import("z-ai-web-dev-sdk")).default;
const fs = await import("node:fs/promises");

const zai = await ZAI.create();

const shots = [
  [
    "t66-val-log-1x.png",
    "A 2D valuation bubble map (log-scale P/E x D/E, Arabic UI) at zoom 1x. Check carefully: (1) Do MOST bubbles carry readable ticker name labels (like COMI, ETEL, ORAS)? Roughly how many? (2) Are the labels readable without overlapping each other? (3) Are there gridlines and axis tick values (5x, 10x, 20x, 50x, 100x, 200x)? (4) Is the bubble distribution well-spread across the plot (not crammed into one corner)? (5) Any visual defects: clipped labels, text over axis chrome, overlapping elements? Answer concisely but completely.",
  ],
  [
    "t66-val-log-zoom2.png",
    "The same valuation bubble map now zoomed to ~2.2x. CRITICAL CHECKS: (1) Do bubbles stay INSIDE the plot frame (clipped at the frame edge) or do they float OVER the axis labels / outside the chart area? (2) Did the x-axis tick values RE-VALUE to a narrower set (10x, 20x, 30x, 50x) and did gridlines re-flow to match the zoom? (3) Do names stay attached to their bubbles? (4) Overall: does the chart look like a professional synchronized zoom (like TradingView) or does anything look frozen/desynced? Answer in 3-4 sentences.",
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
          { type: "text", text: prompt + " Be brutally honest about defects." },
        ],
      },
    ],
  });
  const text = res.choices?.[0]?.message?.content ?? "(no answer)";
  console.log(`\n=== ${file} ===\n${text.trim().slice(0, 800)}`);
}
