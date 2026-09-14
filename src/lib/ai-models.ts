/** Free CLOUD model registry for the AI AGENT tab (T30 → T33 rewrite).
 *
 *  Every option is an online, fully-free model — no local/in-browser
 *  inference, no API keys, no billing:
 *
 *  1. "glm-4-plus" (provider zai) — the app's own server-side model
 *     (z-ai-web-dev-sdk, never reaches the client). Verified probing
 *     showed the gateway serves GLM-4-Plus regardless of a requested
 *     model id, so this is the honest label for the server path (the
 *     done event reports the model the gateway ACTUALLY served, read
 *     from the stream metadata). Runs through the /api/agent SSE loop.
 *
 *  2. Puter cloud models (provider puter) — 1,008 real cloud models
 *     (GPT-OSS 20B, GLM-5.3, GPT-5.6, Claude, Gemini, Grok, DeepSeek…)
 *     through the free Puter.js layer, one free Puter sign-in away
 *     (no card, no API keys). The agent loop for these runs CLIENT-side
 *     (plan + answer in the browser) with tools executed by
 *     POST /api/agent/tools. The former Pollinations GPT-OSS route was
 *     REMOVED: probes showed its anonymous tier budget-gates every
 *     real-sized prompt (only ~20-token prompts pass), so it could
 *     never serve an actual agent question.
 *
 *  This registry stays dependency-free (pure data) so BOTH the server
 *  route and the client composer can import it. Puter runtime helpers
 *  live in src/lib/assistant-models.ts (client-only). */

export type AiModelProvider = "zai" | "puter";

export type AiModel = {
  /** the id the client persists/selects: "glm-4-plus" or "puter:<putterId>" */
  id: string;
  provider: AiModelProvider;
  /** provider-side model id (z-ai SDK `model` param / Puter puterId) */
  providerModel: string;
  label: string;
  labelAr: string;
  note: string;
  noteAr: string;
  /** newest-of-family flag → the menu shows a badge */
  newest?: boolean;
  /** context window (tokens) when known → shown in the menu */
  ctx?: number;
};

export const AI_MODELS: AiModel[] = [
  {
    id: "glm-4-plus",
    provider: "zai",
    providerModel: "glm-4-plus",
    label: "GLM-4-Plus",
    labelAr: "GLM-4-Plus",
    note: "The app's own server model — always on, no sign-in",
    noteAr: "نموذج خادم التطبيق — متاح دائمًا بلا تسجيل",
  },
  {
    id: "puter:openrouter:openai/gpt-oss-20b",
    provider: "puter",
    providerModel: "openrouter:openai/gpt-oss-20b",
    label: "GPT-OSS 20B",
    labelAr: "GPT-OSS 20B",
    newest: true,
    note: "OpenAI's open-weights model, free via Puter cloud (free sign-in)",
    noteAr: "نموذج OpenAI مفتوح الأوزان مجانًا عبر Puter (تسجيل مجاني)",
  },
  {
    id: "puter:z-ai:z-ai/glm-5.3",
    provider: "puter",
    providerModel: "z-ai:z-ai/glm-5.3",
    label: "GLM-5.3",
    labelAr: "GLM-5.3",
    ctx: 1_000_000,
    newest: true,
    note: "The newest GLM — 1M context, free via Puter (free sign-in)",
    noteAr: "أحدث GLM — سياق مليون، مجانًا عبر Puter (تسجيل مجاني)",
  },
  {
    id: "puter:z-ai:z-ai/glm-5.3-flash",
    provider: "puter",
    providerModel: "z-ai:z-ai/glm-5.3-flash",
    label: "GLM-5.3 Flash",
    labelAr: "GLM-5.3 Flash",
    ctx: 1_000_000,
    note: "Newest GLM, fast variant — free via Puter",
    noteAr: "أحدث GLM بنسخة سريعة — مجانًا عبر Puter",
  },
  {
    id: "puter:infron:openai/gpt-5.6-luna",
    provider: "puter",
    providerModel: "infron:openai/gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    labelAr: "GPT-5.6 Luna",
    ctx: 1_050_000,
    newest: true,
    note: "The newest GPT from OpenAI — free via Puter",
    noteAr: "أحدث GPT من OpenAI — مجانًا عبر Puter",
  },
  {
    id: "puter:openrouter:anthropic/claude-sonnet-5",
    provider: "puter",
    providerModel: "openrouter:anthropic/claude-sonnet-5",
    label: "Claude Sonnet 5",
    labelAr: "Claude Sonnet 5",
    ctx: 1_000_000,
    newest: true,
    note: "The newest Claude from Anthropic — free via Puter",
    noteAr: "أحدث Claude من Anthropic — مجانًا عبر Puter",
  },
  {
    id: "puter:google:google/gemini-3.1-pro-preview",
    provider: "puter",
    providerModel: "google:google/gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    labelAr: "Gemini 3.1 Pro",
    ctx: 1_048_576,
    newest: true,
    note: "The newest Gemini Pro from Google — free via Puter",
    noteAr: "أحدث Gemini Pro من جوجل — مجانًا عبر Puter",
  },
  {
    id: "puter:openrouter:x-ai/grok-4.6",
    provider: "puter",
    providerModel: "openrouter:x-ai/grok-4.6",
    label: "Grok 4.6",
    labelAr: "Grok 4.6",
    ctx: 500_000,
    newest: true,
    note: "The newest Grok from xAI — free via Puter",
    noteAr: "أحدث Grok من xAI — مجانًا عبر Puter",
  },
  {
    id: "puter:alibaba:deepseek/deepseek-v4-pro-0813",
    provider: "puter",
    providerModel: "alibaba:deepseek/deepseek-v4-pro-0813",
    label: "DeepSeek V4 Pro",
    labelAr: "DeepSeek V4 Pro",
    ctx: 1_000_000,
    newest: true,
    note: "The newest DeepSeek — strong reasoning, free via Puter",
    noteAr: "أحدث DeepSeek — استدلال قوي، مجانًا عبر Puter",
  },
  {
    id: "puter:openrouter:moonshotai/kimi-k3",
    provider: "puter",
    providerModel: "openrouter:moonshotai/kimi-k3",
    label: "Kimi K3",
    labelAr: "Kimi K3",
    ctx: 1_048_576,
    note: "The new Kimi from Moonshot — free via Puter",
    noteAr: "كيمي الجديد من Moonshot — مجانًا عبر Puter",
  },
  {
    id: "puter:openrouter:qwen/qwen3-235b-a22b",
    provider: "puter",
    providerModel: "openrouter:qwen/qwen3-235b-a22b",
    label: "Qwen3 235B",
    labelAr: "Qwen3 235B",
    ctx: 131_072,
    note: "Big multilingual Qwen — free via Puter",
    noteAr: "كوين الكبير متعدد اللغات — مجانًا عبر Puter",
  },
  {
    id: "puter:openrouter:meta-llama/llama-4-maverick",
    provider: "puter",
    providerModel: "openrouter:meta-llama/llama-4-maverick",
    label: "Llama 4 Maverick",
    labelAr: "Llama 4 Maverick",
    ctx: 1_048_576,
    note: "Meta's newest open Llama — free via Puter",
    noteAr: "أحدث لاما مفتوحة المصدر من ميتا — مجانًا عبر Puter",
  },
  {
    id: "puter:mistralai:mistralai/mistral-large-2512",
    provider: "puter",
    providerModel: "mistralai:mistralai/mistral-large-2512",
    label: "Mistral Large 3",
    labelAr: "Mistral Large 3",
    ctx: 262_144,
    note: "Mistral's large flagship — free via Puter",
    noteAr: "ميسترال الكبيرة — مجانًا عبر Puter",
  },
  {
    id: "puter:infron:minimax/minimax-m2.5",
    provider: "puter",
    providerModel: "infron:minimax/minimax-m2.5",
    label: "MiniMax M2.5",
    labelAr: "MiniMax M2.5",
    ctx: 204_800,
    note: "The new MiniMax — free via Puter",
    noteAr: "ميني ماكس الجديدة — مجانًا عبر Puter",
  },
];

export const DEFAULT_AI_MODEL_ID = "glm-4-plus";

export function findAiModel(id: unknown): AiModel | null {
  if (typeof id !== "string" || id.length === 0) return null;
  return AI_MODELS.find((m) => m.id === id) ?? null;
}

/** Human label for ANY persisted id — featured models from the registry,
 *  ad-hoc "puter:<id>" catalog picks from the puterId tail, and anything
 *  unknown falls back to the honest default. */
export function aiModelLabel(id: string): string {
  const m = findAiModel(id);
  if (m) return m.label;
  if (id.startsWith("puter:")) {
    const tail = id.slice("puter:".length);
    const short = tail.includes("/") ? tail.split("/").slice(1).join("/") : tail;
    return short.length > 30 ? short.slice(0, 30) + "…" : short;
  }
  return DEFAULT_AI_MODEL_ID;
}

/** The honest identity line for the system prompt. */
export function aiModelIdentity(m: AiModel): string {
  return m.provider === "zai"
    ? "a REAL large language model (GLM-4-Plus, by Z.ai)"
    : `a REAL large language model (${m.label} — served via the free Puter cloud)`;
}

/** Client-side localStorage persistence helper (never throws). */
export const AI_MODEL_KEY = "egx-ai-model";

export function loadAiModelId(): string {
  try {
    const v = localStorage.getItem(AI_MODEL_KEY);
    if (!v) return DEFAULT_AI_MODEL_ID;
    // any "puter:" id is valid (catalog picks persist too); anything else
    // must exist in the registry — stale ids from old versions migrate
    if (v.startsWith("puter:") || findAiModel(v)) return v;
  } catch {}
  return DEFAULT_AI_MODEL_ID;
}

export function saveAiModelId(id: string) {
  try {
    localStorage.setItem(AI_MODEL_KEY, id);
  } catch {}
}
