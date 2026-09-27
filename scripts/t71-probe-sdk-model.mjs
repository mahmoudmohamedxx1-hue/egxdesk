// T71 probe — what model does the sandbox z-ai-web-dev-sdk gateway serve
// when NO model param is passed (the ai-signals / hourly-report / agent-core
// call sites)? If it is glm-4-plus, those calls need an explicit model now.
import ZAI from "z-ai-web-dev-sdk";

async function main() {
  const zai = await ZAI.create();
  const res = await zai.chat.completions.create({
    messages: [{ role: "user", content: "Reply with exactly: ok" }],
    thinking: { type: "disabled" },
  });
  console.log("default served model:", res && res.model);

  // also probe glm-4.7-flash through the SDK gateway explicitly
  try {
    const res2 = await zai.chat.completions.create({
      model: "glm-4.7-flash",
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      thinking: { type: "disabled" },
    });
    console.log("glm-4.7-flash explicit:", res2 && res2.model, "content:", JSON.stringify(String((res2.choices && res2.choices[0] && res2.choices[0].message && res2.choices[0].message.content) || "").slice(0, 40)));
  } catch (e) {
    console.log("glm-4.7-flash explicit FAILED:", e instanceof Error ? e.message : String(e));
  }
}

main().catch((e) => {
  console.error("probe failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
