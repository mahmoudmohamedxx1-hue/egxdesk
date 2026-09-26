/** T67 — the VERCEL SIMULATION end-to-end: SDK patched to throw + key blanked
 *  → the keyless backbone (GLM-5.3-Flash) must serve, and its THINKING must
 *  stream live (`think` events), the meta event must report
 *  backbone:keyless, and the done event must carry the thinking trail. */
process.env.DATABASE_URL = "file:/home/z/my-project/db/custom.db";
process.env.ZAI_API_KEY = "";

async function main() {
  const sdkModule = require("z-ai-web-dev-sdk") as { default?: unknown } & Record<string, unknown>;
  const ZClass = (sdkModule.default ?? sdkModule) as { create: () => Promise<unknown> };
  ZClass.create = async () => {
    throw new Error("Configuration file not found or invalid. Please create .z-ai-config in your project, home directory, or /etc.");
  };

  const { POST } = await import("../src/app/api/agent/route");
  const req = new Request("http://localhost/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "127.0.0.9" },
    body: JSON.stringify({
      lang: "ar",
      deep: false,
      deviceId: "diag-t67-think-check",
      messages: [{ role: "user", content: "ما حالة السوق المصري الآن؟ اذكر مستوى المؤشر ونسبة التغير." }],
    }),
  });

  const t0 = Date.now();
  const res = await POST(req as unknown as Request);
  const raw = await res.text();
  const ms = Date.now() - t0;

  let metaBackbone = "";
  let thinkEvents = 0;
  let thinkChars = 0;
  let firstThinkAt = 0;
  let deltas = 0;
  let statuses: string[] = [];
  let doneModel = "";
  let doneThinkingLen = 0;
  let answerHead = "";
  let steps: string[] = [];
  const t0ms = Date.now();
  let elapsed = 0;
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const d = JSON.parse(line.slice(6));
      if (d.type === "meta") metaBackbone = `${d.backbone}/${d.engine}/needsKey=${d.needsKey}`;
      else if (d.type === "think") {
        thinkEvents++;
        if (!firstThinkAt) firstThinkAt = Date.now() - t0;
        thinkChars += typeof d.text === "string" ? d.text.length : 0;
      } else if (d.type === "delta") deltas++;
      else if (d.type === "status") statuses.push(d.note);
      else if (d.type === "step") steps.push(d.tool);
      else if (d.type === "done") {
        doneModel = d.model;
        doneThinkingLen = typeof d.thinking === "string" ? d.thinking.length : 0;
        answerHead = d.answer.slice(0, 220);
      }
    } catch {}
  }

  console.log(`total ${ms}ms`);
  console.log(`meta: ${metaBackbone}`);
  console.log(`think events: ${thinkEvents} (${thinkChars} chars, first at ${firstThinkAt}ms)`);
  console.log(`delta events: ${deltas}`);
  console.log(`steps: ${steps.join(", ") || "—"}`);
  console.log(`statuses: ${statuses.join(" | ") || "—"}`);
  console.log(`done.model: ${doneModel}`);
  console.log(`done.thinking length: ${doneThinkingLen}`);
  console.log(`answer head: ${answerHead.replace(/\n/g, " ")}`);
  const pass =
    metaBackbone.startsWith("keyless/") &&
    thinkEvents > 0 &&
    thinkChars > 200 &&
    doneThinkingLen === thinkChars &&
    deltas > 5 &&
    doneModel.length > 0;
  console.log(pass ? "THINK-STREAM CHECK: PASS" : "THINK-STREAM CHECK: FAIL");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("SIM FAILED:", e);
  process.exit(1);
});
