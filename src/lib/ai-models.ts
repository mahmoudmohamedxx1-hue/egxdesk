/** The AGENT model registry (T30 → T68 rewrite).
 *
 *  Every option is an online model served SERVER-side through /api/agent —
 *  no client-side loops, no third-party scripts, no sign-in walls:
 *
 *  1. "llm7:GLM-5.3-Flash" (provider llm7) — THE MAIN MODEL (T68, the
 *     user's call: GLM-4-Plus does not run on public hosting without a
 *     key, GLM-5.3-Flash answers everywhere). A REAL GLM brain, keyless,
 *     no sign-in, streams its live chain-of-thought (reasoning_content —
 *     probe-verified live with thinking:{type:"enabled"}: ~1.2k chars of
 *     reasoning per round, clean MSA Arabic, strict-JSON protocol).
 *     llm7's glm-5.3 / glm-5.2 are NOT keyless (401 missing_api_key) —
 *     GLM-5.3-Flash is the only keyless GLM there.
 *
 *  2. "glm-4-plus" (provider zai) — the STRONG-BACKBONE tier: in the dev
 *     sandbox it runs through the z-ai-web-dev-sdk gateway (verified:
 *     served=glm-4-plus); on ANY public host (Vercel…) it needs the
 *     ZAI_API_KEY env var (direct Z.AI cloud). It is an explicit PICK in
 *     the menu and the auto-failover backbone when the SDK gateway is
 *     alive — but no longer the default (it cannot answer keylessly).
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
    id: "llm7:GLM-5.3-Flash",
    provider: "llm7",
    providerModel: "GLM-5.3-Flash",
    label: "GLM-5.3 Flash",
    labelAr: "GLM-5.3 Flash",
    newest: true,
    ctx: 400_000,
    note: "THE MAIN MODEL — a real GLM brain, keyless: no key, no sign-in, works on every host. Streams its live chain-of-thought as it answers, strong Arabic. Auto-falls back through the keyless pool (Nemotron → Step → Router → GPT-OSS) when the shared pool is busy",
    noteAr: "النموذج الرئيسي — دماغ GLM حقيقي بلا تسجيل ولا مفاتيح ويعمل على أي مستضيف. يعرض تفكيره لحظة بلحظة أثناء الإجابة، وعربيته قوية. وعند انشغاله يتحول تلقائيًا عبر سلسلة النماذج المجانية (Nemotron ← Step ← Router ← GPT-OSS)",
  },
  {
    id: "glm-4-plus",
    provider: "zai",
    providerModel: "glm-4-plus",
    label: "GLM-4-Plus",
    labelAr: "GLM-4-Plus",
    note: "The strongest brain — runs through the dev sandbox gateway, or on public hosting with the ZAI_API_KEY env var. Pre-thinking generation: it does not stream its reasoning (its live work-trace shows instead). The auto-failover backbone wherever it can run",
    noteAr: "الأقوى — يعمل عبر بوابة بيئة التطوير، أو على الاستضافة العامة مع متغير البيئة ZAI_API_KEY. من جيل ما قبل بثّ التفكير فلا يرسل سلسلة تفكيره (يُعرض مسار عمله بدلًا منها). وهو العمود الاحتياطي أينما كان متاحًا",
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

// T68 — THE MAIN MODEL IS NOW GLM-5.3-Flash (the user's explicit call:
// "if glm 4 plus isnt working and glm 5.3 flash is working so replace
// them"). GLM-4-Plus physically cannot answer on public hosting without
// ZAI_API_KEY, while GLM-5.3-Flash answers everywhere, keyless, with a live
// thinking stream — so the default pick, the menu's first row and every
// fresh client now start on GLM-5.3-Flash. Old localStorage picks stay
// honored (the id still exists in the registry).
export const DEFAULT_AI_MODEL_ID = "llm7:GLM-5.3-Flash";

/** T68 — the STRONG backbone the sandbox failovers re-route to: the SDK
 *  gateway's GLM-4-Plus (alive only in the dev sandbox; on keyed hosts the
 *  DIRECT_GLM route plays this role instead — see /api/agent). */
export const SDK_BACKBONE_ID = "glm-4-plus";

/** The keyless GLM main (and the keyless chain's first hop): LLM7's
 *  anonymous GLM-5.3-Flash tier — a REAL GLM brain, probe-verified live
 *  (clean MSA Arabic, strict-JSON tool protocol compliance, streamed SSE +
 *  live reasoning_content, 100% availability at probe time). NOTE (T67
 *  probe): llm7's glm-5.3 / glm-5.2 are NOT keyless (401 missing_api_key) —
 *  GLM-5.3-Flash is the only keyless GLM there. */
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
 *  honest default's LABEL (T68: was the raw id string — the chip could
 *  render "llm7:GLM-5.3-Flash" instead of a human name). */
export function aiModelLabel(id: string): string {
  const m = findAiModel(id);
  if (m) return m.label;
  return findAiModel(DEFAULT_AI_MODEL_ID)?.label ?? DEFAULT_AI_MODEL_ID;
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
