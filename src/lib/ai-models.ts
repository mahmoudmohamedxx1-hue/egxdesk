/** The AGENT model registry (T30 → T67 rewrite).
 *
 *  Every option is an online model served SERVER-side through /api/agent —
 *  no client-side loops, no third-party scripts, no sign-in walls:
 *
 *  1. "glm-4-plus" (provider zai) — the app's own server-side GLM-4-Plus.
 *     In the dev sandbox it runs through the z-ai-web-dev-sdk gateway
 *     (verified: the gateway reports served=glm-4-plus). On ANY public host
 *     (Vercel…) that private gateway is unreachable, so GLM-4-Plus requires
 *     the ZAI_API_KEY env var (direct Z.AI cloud) — the switcher shows an
 *     honest host banner explaining exactly that. The done event always
 *     reports the model the provider ACTUALLY served.
 *
 *  2. Keyless GLM cloud (llm7) — GLM-5.3-Flash, the only GLM llm7.io
 *     serves without a key (probe-verified: glm-5.3 / glm-5.2 answer 401
 *     "missing_api_key"). Real GLM brain, streams its chain-of-thought
 *     (reasoning_content) live, clean MSA Arabic.
 *
 *  3. Keyless Kilo Gateway pool (3 routes, 200 req/hr per IP) and
 *     Pollinations GPT-OSS-20B — vetted via the freellmpool catalog.
 *
 *  T67 removals (probe-verified failures, 2026-09-27):
 *  - PUTER: the whole client-side puter.js ladder was removed from the
 *    agent at the user's request (sign-in wall + flaky catalog).
 *  - llm7 codestral-latest: breaks the strict-JSON tool protocol
 *    ({"action":"call_tool","tool_name":…} instead of {"tool":…}).
 *  - llm7 mistral-Nemo-Instruct-2407: emits crash-text soup in Arabic.
 *  - llm7 minimax-m2.7: 15-36s shared-pool latency, refused tool calls.
 *
 *  This registry stays dependency-free (pure data) so BOTH the server route
 *  and the client composer can import it. */
export type AiModelProvider = "zai" | "llm7" | "pollinations" | "kilo";

export type AiModel = {
  /** the id the client persists/selects: "glm-4-plus", "llm7:…", "kilo:…", "pollinations:…" */
  id: string;
  provider: AiModelProvider;
  /** provider-side model id (SDK `model` param / llm7 / kilo / pollinations id) */
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
    note: "The app's own server model — the strongest brain, no sign-in. On public hosting it needs the ZAI_API_KEY env var; the host banner tells you which engine is live",
    noteAr: "نموذج خادم التطبيق — الأقوى، بلا تسجيل. على الاستضافة العامة يحتاج متغير البيئة ZAI_API_KEY، ولافتة المستضيف تخبرك أي محرك يعمل الآن",
  },
  {
    id: "llm7:GLM-5.3-Flash",
    provider: "llm7",
    providerModel: "GLM-5.3-Flash",
    label: "GLM-5.3 Flash (keyless)",
    labelAr: "GLM-5.3 Flash (بلا تسجيل)",
    newest: true,
    ctx: 400_000,
    note: "Keyless GLM cloud — a real GLM brain, streams its live chain-of-thought, strong Arabic, no key, no sign-in. Auto-falls back through the keyless pool (Nemotron → Step → Router → GPT-OSS) when the shared pool is busy",
    noteAr: "سحابة GLM بلا تسجيل ولا مفاتيح — عربية قوية وتعرض تفكيرها لحظة بلحظة. وعند انشغالها يتحول تلقائيًا عبر سلسلة النماذج المجانية (Nemotron ← Step ← Router ← GPT-OSS)",
  },
  {
    id: "kilo:nvidia/nemotron-3-super-120b-a12b:free",
    provider: "kilo",
    providerModel: "nvidia/nemotron-3-super-120b-a12b:free",
    label: "Nemotron 3 Super 120B (keyless)",
    labelAr: "Nemotron 3 Super 120B (بلا تسجيل)",
    ctx: 131_072,
    note: "Keyless Kilo Gateway pool — 200 req/hr per IP, strong Arabic, strict-JSON verified. Auto-falls through the keyless pool when busy",
    noteAr: "بوابة Kilo المجانية — 200 طلب/ساعة لكل IP، عربية قوية. وعند انشغالها يتحول تلقائيًا عبر سلسلة النماذج المجانية",
  },
  {
    id: "kilo:stepfun/step-3.7-flash:free",
    provider: "kilo",
    providerModel: "stepfun/step-3.7-flash:free",
    label: "Step 3.7 Flash (keyless)",
    labelAr: "Step 3.7 Flash (بلا تسجيل)",
    ctx: 131_072,
    note: "Keyless Kilo Gateway pool — fast, strong Arabic. Auto-falls through the keyless pool when busy",
    noteAr: "بوابة Kilo المجانية — سريعة وعربية قوية. وعند انشغالها يتحول تلقائيًا عبر سلسلة النماذج المجانية",
  },
  {
    id: "kilo:openrouter/free",
    provider: "kilo",
    providerModel: "openrouter/free",
    label: "Free Model Router (keyless)",
    labelAr: "موجّه النماذج المجانية (بلا تسجيل)",
    ctx: 131_072,
    note: "Keyless Kilo Gateway auto-router — picks a live free model per request. Auto-falls through the keyless pool when busy",
    noteAr: "موجّه Kilo المجاني — يختار نموذجًا مجانيًا متاحًا لكل طلب. وعند انشغاله يتحول تلقائيًا عبر سلسلة النماذج المجانية",
  },
  {
    id: "pollinations:gpt-oss-20b",
    provider: "pollinations",
    providerModel: "openai-fast",
    label: "GPT-OSS 20B (keyless)",
    labelAr: "GPT-OSS 20B (بلا تسجيل)",
    ctx: 131_072,
    note: "Keyless cloud, strong Arabic — no sign-in, no key. Free shared tier; the last hop of the keyless chain",
    noteAr: "سحابة بلا تسجيل ولا مفاتيح — عربية قوية. الحصة المجانية المشتركة، وهي المحطة الأخيرة في السلسلة المجانية",
  },
];

export const DEFAULT_AI_MODEL_ID = "glm-4-plus";

/** T59 → T65 — the default KEYLESS backbone on hosts without the SDK gateway
 *  and without ZAI_API_KEY (the public Vercel deployment): LLM7's anonymous
 *  GLM-5.3-Flash tier — a REAL GLM brain, probe-verified live (clean MSA
 *  Arabic, strict-JSON tool protocol compliance, streamed SSE + live
 *  reasoning_content, 100% availability at probe time). This replaces the
 *  old order (Pollinations GPT-OSS first) because the user asked for GLM as
 *  the main family: with no key on the host, GLM-5.3-Flash keyless IS the
 *  main; with ZAI_API_KEY set, the direct cloud serves glm-4-plus (the
 *  user's explicit pick); in the sandbox the SDK gateway serves GLM-4-Plus
 *  as always. NOTE (T67 probe): llm7's glm-5.3 / glm-5.2 are NOT keyless
 *  (401 missing_api_key) — GLM-5.3-Flash is the only keyless GLM there. */
export const KEYLESS_MODEL_ID = "llm7:GLM-5.3-Flash";

/** The keyless pool after the GLM tier, ordered strictly DOWN (no loops):
 *  the three Kilo Gateway routes (vetted live — strict-JSON + clean MSA
 *  Arabic + streamed SSE, ~2-3s each, 200 req/hr per IP, independent
 *  capacity from LLM7's shared pool), then Pollinations GPT-OSS-20B as the
 *  final hop. Adopted from the freellmpool catalog (github.com/0xzr/freellmpool)
 *  whose audited keyless routes these are. T67: the old llm7-mistral final
 *  hop was removed — probe showed crash-text Arabic from that tier. */
export const KEYLESS_POOL_MODEL_IDS = [
  "kilo:nvidia/nemotron-3-super-120b-a12b:free",
  "kilo:stepfun/step-3.7-flash:free",
  "kilo:openrouter/free",
] as const;

/** The last-resort keyless tier after the GLM pool is busy/exhausted:
 *  Pollinations GPT-OSS-20B (strong Arabic). When even this hop is
 *  exhausted the loop ships the deterministic briefing built from the
 *  tool data it already collected — never a bare error. */
export const KEYLESS_FALLBACK_MODEL_ID = "pollinations:gpt-oss-20b";

export function findAiModel(id: unknown): AiModel | null {
  if (typeof id !== "string" || id.length === 0) return null;
  return AI_MODELS.find((m) => m.id === id) ?? null;
}

/** Human label for ANY persisted id — registry models, and anything
 *  unknown (incl. stale "puter:" ids from old versions) falls back to the
 *  honest default. */
export function aiModelLabel(id: string): string {
  const m = findAiModel(id);
  if (m) return m.label;
  return DEFAULT_AI_MODEL_ID;
}

/** The honest identity line for the system prompt. */
export function aiModelIdentity(m: AiModel): string {
  return m.provider === "zai"
    ? "a REAL large language model (GLM-4-Plus, by Z.ai)"
    : m.provider === "llm7"
      ? `a REAL large language model (${m.label} — served keyless via the free LLM7.io cloud)`
      : m.provider === "pollinations"
        ? `a REAL large language model (GPT-OSS-20B, OpenAI open weights — served keyless via the free Pollinations cloud)`
        : `a REAL large language model (${m.label} — served keyless via the free Kilo Gateway cloud)`;
}

/** Client-side localStorage persistence helper (never throws). */
export const AI_MODEL_KEY = "egx-ai-model";

export function loadAiModelId(): string {
  try {
    const v = localStorage.getItem(AI_MODEL_KEY);
    if (!v) return DEFAULT_AI_MODEL_ID;
    // must exist in the registry — stale ids (old "puter:" picks, pruned
    // llm7 models…) migrate to the honest default
    if (findAiModel(v)) return v;
  } catch {}
  return DEFAULT_AI_MODEL_ID;
}

export function saveAiModelId(id: string) {
  try {
    localStorage.setItem(AI_MODEL_KEY, id);
  } catch {}
}
