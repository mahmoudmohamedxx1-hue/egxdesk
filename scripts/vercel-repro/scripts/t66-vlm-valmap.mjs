// T66 — VLM audit of the valuation map zoom behavior screenshots
const ZAI = (await import("z-ai-web-dev-sdk")).default;
const fs = await import("node:fs/promises");

const zai = await ZAI.create();

const shots = [
  [
    "t66-val-before.png",
    "A 2D valuation bubble map (P/E x D/E, Arabic UI) at zoom 1x. Describe: (1) how many bubbles are visible, (2) do bubbles have NAME labels on them, (3) do the bubbles look crowded/overlapping, (4) are axis tick labels visible at the bottom/left? Answer concisely.",
  ],
  [
    "t66-val-zoom3.png",
    "The same valuation bubble map now zoomed to ~2.2x via the zoom buttons. CRITICAL CHECK: (1) Did the bubble labels (COMI, HDBK, etc.) scale up and move WITH the bubbles? (2) Did the axis tick values at the bottom RE-VALUE (e.g. changed from a wide 0-200 range to a narrower range like 100x-200x)? (3) Does the chart look synchronized (grid/axes agree with bubble positions) or does anything look FROZEN while bubbles moved? (4) Any visual glitches: tint rectangles spilling outside the plot frame over the axis labels, clipped labels, overlapping elements? Answer in 3-4 short sentences.",
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
  console.log(`\n=== ${file} ===\n${text.trim().slice(0, 700)}`);
}
