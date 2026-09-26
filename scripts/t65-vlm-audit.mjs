// T65 — VLM audit of the four UI changes
const ZAI = (await import("z-ai-web-dev-sdk")).default;
const fs = await import("node:fs/promises");

const zai = await ZAI.create();

const shots = [
  ["t65-valmap-zoomed.png", "A zoomed-in 2D valuation map (P/E x D/E bubble chart, Arabic UI). Check: do the axis tick labels and gridlines look CONSISTENT with the zoomed bubble positions (i.e. the axes re-valued themselves, not frozen at 0-200)? Any overlapping labels or broken layout?"],
  ["t65-dcf-lab.png", "A DCF valuation lab section in Arabic (Model Lab). Check: is there a year-by-year projection table (10 rows), a bar chart of where the value comes from, a sensitivity grid, and readable layout? Any broken/overlapping elements?"],
  ["t65-strategy-lab.png", "A Strategy Lab page in Arabic with a live workbench. Check: is there a consensus header, a table of 18 strategies with verdict chips, and below it the published record sections? Any broken layout?"],
  ["t65-lens-moves-final.png", "An ownership lens map (Arabic) with a week of moves selected. Check: are moved companies visually distinguished (pulsing halos / outer arcs), and is there a ranked moves panel on the right? Any overlap or broken rendering?"],
];

for (const [file, prompt] of shots) {
  const b64 = await fs.readFile(`/home/z/my-project/scripts/qa/${file}`, "base64");
  const res = await zai.chat.completions.createVision({
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
          { type: "text", text: prompt + " Answer in 2-3 short sentences." },
        ],
      },
    ],
  });
  const text = res.choices?.[0]?.message?.content ?? "(no answer)";
  console.log(`\n=== ${file} ===\n${text.trim().slice(0, 500)}`);
}
