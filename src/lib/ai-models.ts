/** Free CLOUD model registry for the AI AGENT tab (T30).
 *
 *  Every option is an online, fully-free model — no local/in-browser
 *  inference, no API keys, no billing:
 *
 *  1. "glm-4-plus" — the app's own server-side model (z-ai-web-dev-sdk,
 *     never reaches the client). Verified probing showed the gateway serves
 *     GLM-4-Plus regardless of a requested model id, so this is the honest
 *     label for the server path (the done event reports the model the
 *     gateway ACTUALLY served, read from the stream metadata).
 *  2. "gpt-oss-20b" — the open-weights OpenAI model via Pollinations.ai's
 *     keyless anonymous cloud tier. Honest caveat: that shared pool is
 *     frequently budget-limited at peak (the agent retries with backoff and
 *     degrades to a bilingual busy message — never fake data).
 *
 *  The registry is the single source of truth shared by the API route
 *  (validation + routing) and the agent composer's model dropdown. */

export type AiModelProvider = "zai" | "pollinations";

export type AiModel = {
  /** the id the client sends to /api/agent (stable) */
  id: string;
  provider: AiModelProvider;
  /** provider-side model id (z-ai SDK `model` param / pollinations body) */
  providerModel: string;
  label: string;
  labelAr: string;
  note: string;
  noteAr: string;
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
    id: "gpt-oss-20b",
    provider: "pollinations",
    providerModel: "openai-fast",
    label: "GPT-OSS 20B",
    labelAr: "GPT-OSS 20B",
    note: "Experimental: keyless Pollinations cloud — shared pool, may be busy at peak",
    noteAr: "تجريبي: سحابي مجاني عبر Pollinations — مورد مشترك قد ينشغل وقت الذروة",
  },
];

export const DEFAULT_AI_MODEL_ID = "glm-4-plus";

export function findAiModel(id: unknown): AiModel | null {
  if (typeof id !== "string" || id.length === 0) return null;
  return AI_MODELS.find((m) => m.id === id) ?? null;
}

/** Client-side localStorage persistence helper (never throws). */
export const AI_MODEL_KEY = "egx-ai-model";

export function loadAiModelId(): string {
  try {
    const v = localStorage.getItem(AI_MODEL_KEY);
    return findAiModel(v) ? (v as string) : DEFAULT_AI_MODEL_ID;
  } catch {
    return DEFAULT_AI_MODEL_ID;
  }
}

export function saveAiModelId(id: string) {
  try {
    localStorage.setItem(AI_MODEL_KEY, id);
  } catch {}
}
