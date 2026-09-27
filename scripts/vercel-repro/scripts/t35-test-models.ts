/** T35 unit test — the expanded free-cloud model registry + the anti-staleness
 *  version guard. Locks: 20 curated models (1 server + 19 Puter families),
 *  unique ids, id<->providerModel consistency, bilingual notes, honest
 *  default fallback, localStorage migration for stale ids, catalog-pick
 *  labels, and the numeric isServerNewer comparison that drives the
 *  self-heal reload. */

import {
  AI_MODELS,
  DEFAULT_AI_MODEL_ID,
  findAiModel,
  aiModelLabel,
  loadAiModelId,
  AI_MODEL_KEY,
} from "@/lib/ai-models";
import { isServerNewer } from "@/lib/version-guard";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label} ${extra}`);
  }
}

console.log("1) registry shape — 23 curated free cloud models");
{
  const server = AI_MODELS.filter((m) => m.provider === "zai");
  const llm7 = AI_MODELS.filter((m) => m.provider === "llm7");
  const puter = AI_MODELS.filter((m) => m.provider === "puter");
  ok(AI_MODELS.length === 23, "exactly 23 models (1 server + 3 keyless LLM7 + 19 Puter)", `got ${AI_MODELS.length}`);
  ok(server.length === 1 && server[0].id === "glm-4-plus", "one honest server model: GLM-4-Plus");
  ok(llm7.length === 3, "3 KEYLESS LLM7 models (no sign-in!)", `got ${llm7.length}`);
  ok(puter.length === 19, "19 curated Puter families", `got ${puter.length}`);
  ok(DEFAULT_AI_MODEL_ID === "glm-4-plus", "default is the keyless server model");
}

console.log("2) registry integrity — ids, prefixes, bilingual notes");
{
  const ids = new Set(AI_MODELS.map((m) => m.id));
  ok(ids.size === AI_MODELS.length, "all ids unique");
  for (const m of AI_MODELS) {
    if (m.provider === "puter") {
      if (m.id !== `puter:${m.providerModel}`) {
        ok(false, `puter id matches providerModel: ${m.id}`, `expected puter:${m.providerModel}`);
      }
      if (m.providerModel.includes(" ")) {
        ok(false, `no spaces in providerModel: ${m.providerModel}`);
      }
    }
    if (!m.label || !m.labelAr || !m.note || !m.noteAr) {
      ok(false, `bilingual label+note present: ${m.id}`);
    }
    if (m.ctx !== undefined && m.ctx <= 0) {
      ok(false, `ctx is positive when present: ${m.id}`);
    }
  }
  ok(true, "every entry has consistent id/providerModel + bilingual fields + sane ctx");
}

console.log("3) GPT-OSS 20B + the T35 additions + the T36 keyless family");
{
  const oss = findAiModel("puter:openrouter:openai/gpt-oss-20b");
  ok(oss !== null && oss.label === "GPT-OSS 20B", "GPT-OSS 20B (the user's pick) exists");
  const additions = [
    "puter:openrouter:openai/gpt-oss-120b",
    "puter:infron:z-ai/glm-5.2",
    "puter:openrouter:meta-llama/llama-4-scout",
    "puter:infron:cohere/command-a-03-2025",
    "puter:openrouter:microsoft/phi-4",
    "puter:infron:nvidia/llama-3.3-nemotron-super-49b-v1.5",
  ];
  for (const id of additions) ok(findAiModel(id) !== null, `new family registered: ${id}`);
  const keyless = ["llm7:mistral-Nemo-Instruct-2407", "llm7:codestral-latest", "llm7:minimax-m2.7"];
  for (const id of keyless) {
    const m = findAiModel(id);
    ok(m !== null && m.provider === "llm7", `keyless LLM7 model registered: ${id}`);
    if (m) ok(m.id === `llm7:${m.providerModel}`, `llm7 id matches providerModel: ${m.id}`);
  }
  ok(
    aiModelLabel("llm7:mistral-Nemo-Instruct-2407") === "Mistral Nemo",
    "keyless model label resolves",
  );
  ok(
    findAiModel("llm7:gpt-5.6-luna") === null,
    "premium LLM7 ids NOT registered (keyless-honest registry)",
  );
}

console.log("4) lookups — find, honest labels, unknown fallback");
{
  ok(findAiModel("glm-4-plus")?.provider === "zai", "findAiModel resolves the server model");
  ok(findAiModel("nope") === null, "unknown id → null (never a fake model)");
  ok(aiModelLabel("glm-4-plus") === "GLM-4-Plus", "server label");
  ok(aiModelLabel("puter:openrouter:openai/gpt-oss-20b") === "GPT-OSS 20B", "featured puter label");
  ok(
    aiModelLabel("puter:someprovider/weird-new-model").includes("weird-new-model"),
    "ad-hoc catalog pick falls back to the id tail",
  );
  ok(aiModelLabel("garbage") === DEFAULT_AI_MODEL_ID, "garbage id → honest default label");
}

console.log("5) localStorage persistence + stale-id migration");
{
  // minimal localStorage mock (loadAiModelId must never throw)
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  ok(loadAiModelId() === "glm-4-plus", "no stored value → default");
  store.set(AI_MODEL_KEY, "puter:openrouter:openai/gpt-oss-120b");
  ok(loadAiModelId() === "puter:openrouter:openai/gpt-oss-120b", "any puter: id persists (catalog picks too)");
  store.set(AI_MODEL_KEY, "gpt-oss-20b"); // stale id from the v2.21 era → migrates
  ok(loadAiModelId() === "glm-4-plus", "stale v2.21 id migrates to the default");
  store.set(AI_MODEL_KEY, "pollinations:gpt-oss-20b"); // dead provider prefix → migrates
  ok(loadAiModelId() === "glm-4-plus", "dead Pollinations prefix migrates to the default");
  delete (globalThis as Record<string, unknown>).localStorage;
}

console.log("6) version guard — numeric-aware isServerNewer");
{
  ok(isServerNewer("2.24", "2.25"), "2.24 → 2.25 is newer (triggers the self-heal reload)");
  ok(isServerNewer("2.9.1", "2.24.0"), "numeric compare: 2.9 < 2.24 (not lexicographic)");
  ok(!isServerNewer("2.25", "2.25"), "equal versions → no-op");
  ok(!isServerNewer("2.25", "2.24"), "server OLDER than page → no-op (dev server behind)");
  ok(!isServerNewer("2.25", "garbage"), "garbage server version → no-op, never reload loops");
  ok(isServerNewer("2.25", "2.25.1"), "patch bump is newer");
  ok(!isServerNewer("2.25.1", "2.25"), "page newer than server → no-op");
}

console.log(`\n${pass}/${pass + fail}`);
if (fail > 0) process.exit(1);
