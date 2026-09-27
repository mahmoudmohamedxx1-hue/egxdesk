/** T59 — VERCEL SIMULATION (pollinations keyless tier): the agent route with NO SDK gateway and NO
 *  ZAI_API_KEY (exactly what the live deployment runs with today). The SDK's
 *  create() is patched to throw the same error Vercel produces; the key is
 *  blanked BEFORE the route module loads. Then an ARABIC question is asked —
 *  the exact live crash-text scenario — and the final answer must pass the
 *  language gate (clean Arabic, or the deterministic briefing).
 *
 *  Run: npx tsx scripts/t58-vercel-sim.ts [question]
 */
process.env.DATABASE_URL = "file:/home/z/my-project/db/custom.db";
process.env.ZAI_API_KEY = ""; // Vercel without env vars

async function main() {
  // ── simulate the VERCEL runtime: the SDK gateway CANNOT authenticate ──
  // require() gives the raw CJS module.exports; its .default is the Zai class
  // (the same class object the route's `import ZAI from` resolves to via
  // interop) → overriding the STATIC create is the one true patch point.
  // biome-ignore lint/no-unused-expressions: CJS require inside tsx CJS build
  const sdkModule = require("z-ai-web-dev-sdk") as { default?: unknown } & Record<string, unknown>;
  const ZClass = (sdkModule.default ?? sdkModule) as { create: () => Promise<unknown> };
  console.log("SDK class found:", typeof ZClass === "function" || typeof ZClass === "object", "| has create:", typeof ZClass.create);
  ZClass.create = async () => {
    throw new Error("Configuration file not found or invalid. Please create .z-ai-config in your project, home directory, or /etc.");
  };

  const { POST } = await import("../src/app/api/agent/route");
  const { languageOk } = await import("../src/lib/briefing-composer");

  const question = process.argv[2] ?? "ما هي حالة السوق المصري الآن؟";

  const req = new Request("http://localhost/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "127.0.0.2" },
    body: JSON.stringify({
      lang: "ar",
      deep: false,
      deviceId: "diag-t59-vercel-sim",
      messages: [{ role: "user", content: question }],
    }),
  });

  const t0 = Date.now();
  const res = await POST(req as unknown as Request);
  console.log("HTTP", res.status, `${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const raw = await res.text();
  let answer = "";
  let model = "";
  const steps: string[] = [];
  let deltas = 0;
  const statuses: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const d = JSON.parse(line.slice(6));
      if (d.type === "delta") deltas++;
      else if (d.type === "step") steps.push(`${d.tool}${d.ok ? " ok" : " FAIL"}`);
      else if (d.type === "status") statuses.push(d.note);
      else if (d.type === "done") {
        answer = d.answer;
        model = d.model;
      } else if (d.type === "error") console.log("ERROR EVENT:", d);
    } catch {}
  }

  console.log("steps:", steps.join(" "));
  console.log("statuses:", statuses.join(" | ").slice(0, 300));
  console.log("delta events (must be 0 on keyless):", deltas);
  console.log("served model:", model);
  console.log("answer length:", answer.length);
  const ok = languageOk(answer, "ar");
  console.log("languageOk(ar):", ok);
  console.log("========== FINAL ANSWER ==========");
  console.log(answer.slice(0, 1600));
  console.log("==================================");
  process.exit(ok && deltas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SIM FAILED:", e);
  process.exit(1);
});
