/** T66 — chain-hop honesty check: in the Vercel simulation, when the keyless
 *  chain hops tiers, the done event's model must match the tier that ACTUALLY
 *  served the final answer. Dumps every served-model notification per round. */
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
      deviceId: "diag-t66-hop-check",
      messages: [{ role: "user", content: "ما حالة السوق المصري الآن؟ اذكر مستوى المؤشر." }],
    }),
  });

  const res = await POST(req as unknown as Request);
  const raw = await res.text();
  const served: string[] = [];
  const statuses: string[] = [];
  let doneModel = "";
  let answerHead = "";
  let deltas = 0;
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const d = JSON.parse(line.slice(6));
      if (d.type === "served" || d.type === "servedModel") served.push(JSON.stringify(d));
      else if (d.type === "status") statuses.push(d.note);
      else if (d.type === "delta") deltas++;
      else if (d.type === "done") {
        doneModel = d.model;
        answerHead = d.answer.slice(0, 200);
      }
    } catch {}
  }
  console.log("statuses:", statuses.join(" | "));
  console.log("delta events:", deltas);
  console.log("done.model:", doneModel);
  console.log("answer head:", answerHead.replace(/\n/g, " "));
  // any other event types that carry a model field?
  const modelEvents = [...raw.matchAll(/"type":"([^"]+)","model":"([^"]*)"/g)].map((m) => `${m[1]}:${m[2]}`);
  console.log("model-bearing events:", modelEvents.slice(0, 20).join(" , "));
  process.exit(0);
}

main().catch((e) => {
  console.error("SIM FAILED:", e);
  process.exit(1);
});
