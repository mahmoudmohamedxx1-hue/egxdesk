const ZAI = (await import("z-ai-web-dev-sdk")).default;
const fs = await import("node:fs/promises");
const zai = await ZAI.create();
const b64 = await fs.readFile("/home/z/my-project/scripts/qa/t65-dcf-full.png", "base64");
const res = await zai.chat.completions.createVision({
  messages: [{ role: "user", content: [
    { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
    { type: "text", text: "Full-page Arabic Model Lab with a DCF section. Verify: (1) a 10-row year-by-year projection table with a terminal row and totals, (2) a bar chart titled 'من أين تأتي القيمة' with 11 bars, (3) a 5x5 sensitivity grid, (4) basis strip with TTM/shares/net debt. Are ALL four present and cleanly laid out? 2-3 sentences." },
  ]}],
});
console.log(res.choices?.[0]?.message?.content?.trim().slice(0, 400));
