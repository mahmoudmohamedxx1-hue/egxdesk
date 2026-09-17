/** T37 probe #2 — GitHub Models free inference with the repo's embedded PAT.
 *  If this works, the user gets 10+ real frontier models with a key they
 *  ALREADY own (their GitHub account) — no Puter, no signup, no card. */
import { execSync } from "node:child_process";
const gitUrl = execSync("git config --get remote.origin.url").toString().trim();
const afterColon = gitUrl.split(":").pop() || "";  // "ghp_xxx@github.com/..."
const PAT = afterColon.split("@")[0];

const BASES = ["https://models.github.ai/inference", "https://models.inference.ai.azure.com"];
const CATALOGS = ["https://models.github.ai/catalog/models", "https://models.inference.ai.azure.com/catalog/models"];

const SYSTEM =
  "You are EGX Desk AI, a precise equity analyst for the Egyptian Exchange. Be concise.";
const USER = "In one sentence: what does a high P/E ratio mean for a bank stock?";

async function tryCatalog() {
  for (const c of CATALOGS) {
    try {
      const res = await fetch(c, {
        headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      let ids: string[] = [];
      try {
        const j = JSON.parse(text);
        const arr = Array.isArray(j) ? j : (j?.data ?? []);
        ids = arr.map((m: any) => `${m?.id ?? m?.name}${m?.publisher ? ` (${m.publisher})` : ""}`).filter(Boolean);
      } catch {}
      console.log(`CATALOG ${c} → HTTP ${res.status}, ${ids.length} models`);
      if (ids.length) console.log(ids.slice(0, 40).join("\n"));
      if (res.status === 200 && ids.length) return;
    } catch (e) {
      console.log(`CATALOG ${c} FAIL :: ${(e as Error).message.slice(0, 80)}`);
    }
  }
}

async function tryChat(model: string, base: string) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: USER },
        ],
        max_tokens: 120,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const text = await res.text();
    let content = "";
    try {
      content = JSON.parse(text)?.choices?.[0]?.message?.content ?? "";
    } catch {}
    console.log(
      `  [${model}] HTTP ${res.status} ${Date.now() - t0}ms len=${content.length} :: ${content.slice(0, 100).replace(/\n/g, " ") || text.slice(0, 140).replace(/\n/g, " ")}`,
    );
  } catch (e) {
    console.log(`  [${model}] FAIL ${Date.now() - t0}ms :: ${(e as Error).message.slice(0, 90)}`);
  }
}

async function main() {
  console.log(`PAT loaded: ${PAT ? `${PAT.slice(0, 4)}…${PAT.slice(-4)} (len ${PAT.length})` : "MISSING"}`);
  await tryCatalog();
  console.log("\n=== CHAT PROBES (models.github.ai/inference) ===");
  const models = [
    "openai/gpt-4o",
    "openai/gpt-4o-mini",
    "microsoft/Phi-4",
    "meta/Llama-4-Scout-17B-16E-Instruct",
    "mistralai/Mistral-large-2407",
    "deepseek/DeepSeek-V3-0324",
  ];
  for (const m of models) await tryChat(m, BASES[0]);
}
main();
