/** The AGENT model registry (T30 → T74 rewrite).
 *
 *  Every option is an online model served SERVER-side through /api/agent —
 *  no client-side loops, no third-party scripts, no sign-in walls:
 *
 *  1. "kilo:nvidia/nemotron-3-super-120b-a12b:free" (provider kilo) — THE
 *     MAIN MODEL (T74). A REAL 120B-parameter brain, keyless, no sign-in,
 *     clean MSA Arabic + strict-JSON tool protocol (re-verified live
 *     2026-09-29). Before it, the main was llm7's keyless GLM-5.3-Flash
 *     (T68) — RETIRED upstream on 2026-09-29 (400 model_unavailable);
 *     llm7's glm-5.3/glm-5.2 need paid keys and every remaining llm7
 *     keyless model is unusable (see the T67 probes below), so the Kilo
 *     route took the head of the chain.
 *
 *  2. The rest of the keyless pool: Kilo Step 3.7 Flash, the Kilo
 *     auto-router, and Pollinations GPT-OSS-20B — vetted via the
 *     freellmpool catalog (200 req/hr per IP on the Kilo routes).
 *
 *  T71 — GLM-4-Plus REMOVED ENTIRELY (the user's call: its live thinking
 *  took a while and it never ran in an instant way — responses took a
 *  while to end). The old "zai" provider tier (sandbox SDK gateway + the
 *  ZAI_API_KEY direct cloud) is gone from the registry, the agent loop,
 *  the assistant popup and the brain fallback: every answer now comes
 *  from the keyless chain, which streams its thinking live.
 *
 *  T67 removals (probe-verified failures, 2026-09-27):
 *  - PUTER: the whole client-side puter.js ladder was removed from the
 *    agent at the user's request (sign-in wall + flaky catalog).
 *  - llm7 codestral-latest: breaks the strict-JSON tool protocol
 *    ({"action":"call_tool","tool_name":…} instead of {"tool":…}).
 *  - llm7 mistral-Nemo-Instruct-2407: emits crash-text soup in Arabic
 *    (re-confirmed by the T74 probe — kept only as the background brain's
 *    last-resort hop, never for user-facing text).
 *  - llm7 minimax-m2.7: 15-36s shared-pool latency, refused tool calls.
 *
 *  This registry stays dependency-free (pure data) so BOTH the server route
 *  and the client composer can import it. */
export type AiModelProvider = "llm7" | "pollinations" | "kilo";

export type AiModel = {
  /** the id the client persists/selects: "llm7:…", "kilo:…", "pollinations:…" */
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
    // T74 — THE MAIN MODEL after llm7 retired its keyless GLM-5.3-Flash
    // tier (HTTP 400 model_unavailable, probe-verified 2026-09-29): Kilo's
    // Nemotron route — re-verified live the same day (clean MSA Arabic,
    // strict-JSON tool protocol, streamed SSE) — is the chain head now.
    id: "kilo:nvidia/nemotron-3-super-120b-a12b:free",
    provider: "kilo",
    providerModel: "nvidia/nemotron-3-super-120b-a12b:free",
    label: "Nemotron 3 Super 120B",
    labelAr: "Nemotron 3 Super 120B",
    newest: true,
    ctx: 131_072,
    note: "THE MAIN MODEL — a real 120B-parameter brain, keyless: no key, no sign-in, works on every host. Clean Modern Standard Arabic, strict-JSON tool protocol, and an honest fallback chain (Step → Router → GPT-OSS) whenever the shared pool is busy",
    noteAr: "النموذج الرئيسي — دماغ حقيقي بـ ١٢٠ مليار معامل بلا تسجيل ولا مفاتيح ويعمل على أي مستضيف. عربيته فصحى سليمة ويلتزم بروتوكول الأدوات، وعند انشغاله يتحول تلقائيًا عبر سلسلة النماذج المجانية (Step ← Router ← GPT-OSS)",
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

// T68/T71/T74 — THE MAIN MODEL. GLM-5.3-Flash served as the keyless main
// from T68 until llm7 retired that tier (400 model_unavailable, 2026-09-29;
// glm-5.3/glm-5.2 need paid keys, and the remaining llm7 keyless models are
// unusable — mistral crash-text Arabic, codestral breaks the JSON protocol,
// minimax 15-36s latency, DeepSeek-V4-Flash hanging at probe time). The Kilo
// Nemotron route — re-verified live on retirement day — is the main now.
// Old "llm7:GLM-5.3-Flash" localStorage picks migrate to this default
// automatically (loadAiModelId drops ids that left the registry).
export const DEFAULT_AI_MODEL_ID = "kilo:nvidia/nemotron-3-super-120b-a12b:free";

/** The keyless main (and the keyless chain's first hop): Kilo Gateway's
 *  Nemotron route — a REAL 120B-parameter brain, probe-verified live
 *  (clean MSA Arabic, strict-JSON tool protocol compliance, streamed SSE,
 *  200 req/hr per IP). */
export const KEYLESS_MODEL_ID = "kilo:nvidia/nemotron-3-super-120b-a12b:free";

/** The keyless pool after the main, ordered strictly DOWN (no loops): the
 *  remaining Kilo Gateway routes (vetted live — strict-JSON + clean MSA
 *  Arabic + streamed SSE, ~2-3s each, 200 req/hr per IP), then Pollinations
 *  GPT-OSS-20B as the final hop. Adopted from the freellmpool catalog
 *  (github.com/0xzr/freellmpool) whose audited keyless routes these are. */
export const KEYLESS_POOL_MODEL_IDS = [
  "kilo:stepfun/step-3.7-flash:free",
  "kilo:openrouter/free",
] as const;

/** The last-resort keyless tier after the Kilo pool is busy/exhausted:
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
 *  honest default's LABEL (T68: was the raw id string — the chip could
 *  render "llm7:GLM-5.3-Flash" instead of a human name). */
export function aiModelLabel(id: string): string {
  const m = findAiModel(id);
  if (m) return m.label;
  return findAiModel(DEFAULT_AI_MODEL_ID)?.label ?? DEFAULT_AI_MODEL_ID;
}

/** The honest identity line for the system prompt. */
export function aiModelIdentity(m: AiModel): string {
  return m.provider === "llm7"
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
