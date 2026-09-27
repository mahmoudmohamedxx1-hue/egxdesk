// T66 — panel-focused VLM audit
const ZAI = (await import("z-ai-web-dev-sdk")).default;
const fs = await import("node:fs/promises");

const zai = await ZAI.create();
const b64 = await fs.readFile("/home/z/my-project/scripts/qa/t66-lens-panel.png", "base64");
const res = await zai.chat.completions.createVision({
  messages: [
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
        {
          type: "text",
          text: "This screenshot shows part of an Arabic ownership-lens interface with a 'تحركات الأسبوع المختار' (chosen week's moves) panel. For EACH visible row: is the FIRST and most prominent element a HOLDER NAME (a full Arabic person/company name, semibold), followed by a stake-point change (+X.XXp) and a ticker chip with percentages? Do the rows clearly answer 'WHO made each move'? Answer in 2-3 sentences.",
        },
      ],
    },
  ],
});
console.log(res.choices?.[0]?.message?.content?.trim().slice(0, 500));
