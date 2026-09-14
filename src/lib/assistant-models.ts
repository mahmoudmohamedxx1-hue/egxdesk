"use client";

/** T29 — the FREE ONLINE CLOUD model catalog for the AI assistant popup,
 *  powered by Puter.js (js.puter.com): 1,000+ real cloud models — GLM-5.3
 *  (the newest GLM), GPT-5.6, Claude Sonnet 5, Gemini 3.1, Grok 4.6,
 *  DeepSeek V4, Kimi K3, Qwen, Llama, Mistral… — with NO API keys and NO
 *  credit cards. Puter's user-pays model means the developer pays nothing
 *  and each visitor chats against their own free monthly Puter allowance
 *  (a free Puter sign-in happens once, through Puter's own first-party
 *  popup — `puter.auth.signIn()`).
 *
 *  This module must stay CLIENT-side only (it dynamically injects the
 *  Puter.js <script> the first time a cloud model is needed — never on
 *  the server, never in the main bundle).
 *
 *  The ladder the user can switch between:
 *  - Instant            — built-in bilingual regex router (zero network)
 *  - Cloud (app server) — GLM-4-Plus via /api/assistant, any browser
 *  - Puter cloud models — the catalog below (free sign-in, real flagships)
 */

export type AssistantModelId = string; // "instant" | "cloud" | "puter:<puterId>"

export const MODEL_INSTANT = "instant";
export const MODEL_CLOUD = "cloud";
export const PUTER_PREFIX = "puter:";

export function isPuterModel(id: AssistantModelId): boolean {
  return id.startsWith(PUTER_PREFIX);
}
export function puterIdOf(id: AssistantModelId): string {
  return id.slice(PUTER_PREFIX.length);
}
export function puterModelId(puterId: string): AssistantModelId {
  return PUTER_PREFIX + puterId;
}

/** A curated shortlist of the catalog's best-known flagships, ordered
 *  GLM-first (the app's house model family). Every puterId was pulled
 *  from the LIVE `puter.ai.listModels()` catalog (Sept 2026). */
export type CloudModel = {
  puterId: string;
  name: string;
  provider: string;
  ctx: number;
  desc: { ar: string; en: string };
  /** newest-of-family flag → the menu shows a badge */
  newest?: boolean;
};

export const FEATURED_CLOUD: CloudModel[] = [
  { puterId: "z-ai:z-ai/glm-5.3", name: "GLM-5.3", provider: "zai", ctx: 1_000_000, newest: true, desc: { ar: "أحدث نموذج GLM من Z.ai — سياق مليون", en: "The newest GLM from Z.ai — 1M context" } },
  { puterId: "z-ai:z-ai/glm-5.3-flash", name: "GLM-5.3 Flash", provider: "zai", ctx: 1_000_000, desc: { ar: "الأحدث والأسرع من GLM", en: "Newest GLM, fast variant" } },
  { puterId: "z-ai:z-ai/glm-5.2", name: "GLM-5.2", provider: "zai", ctx: 1_000_000, desc: { ar: "الجيل السابق — قوي ومتوازن", en: "Previous generation — strong all-rounder" } },
  { puterId: "z-ai:z-ai/glm-4.7", name: "GLM-4.7", provider: "zai", ctx: 200_000, desc: { ar: "موثوق وسريع للمهام اليومية", en: "Reliable and quick for daily tasks" } },
  { puterId: "infron:openai/gpt-5.6-luna", name: "GPT-5.6 Luna", provider: "infron", ctx: 1_050_000, newest: true, desc: { ar: "أحدث جي بي تي من أوبن إيه آي", en: "The newest GPT from OpenAI" } },
  { puterId: "openrouter:anthropic/claude-sonnet-5", name: "Claude Sonnet 5", provider: "openrouter", ctx: 1_000_000, newest: true, desc: { ar: "أحدث كلود من أنثروبيك", en: "The newest Claude from Anthropic" } },
  { puterId: "google:google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", provider: "google", ctx: 1_048_576, newest: true, desc: { ar: "أحدث جيميناي برو من جوجل", en: "The newest Gemini Pro from Google" } },
  { puterId: "openrouter:x-ai/grok-4.6", name: "Grok 4.6", provider: "openrouter", ctx: 500_000, newest: true, desc: { ar: "أحدث جروك من xAI", en: "The newest Grok from xAI" } },
  { puterId: "alibaba:deepseek/deepseek-v4-pro-0813", name: "DeepSeek V4 Pro", provider: "alibaba", ctx: 1_000_000, newest: true, desc: { ar: "أحدث ديب سيك — استدلال قوي", en: "The newest DeepSeek — strong reasoning" } },
  { puterId: "openrouter:moonshotai/kimi-k3", name: "Kimi K3", provider: "openrouter", ctx: 1_048_576, desc: { ar: "كيمي الجديد من مونشوت", en: "The new Kimi from Moonshot" } },
  { puterId: "openrouter:qwen/qwen3-235b-a22b", name: "Qwen3 235B", provider: "openrouter", ctx: 131_072, desc: { ar: "كوين الكبير متعدد اللغات", en: "Big multilingual Qwen" } },
  { puterId: "openrouter:meta-llama/llama-4-maverick", name: "Llama 4 Maverick", provider: "openrouter", ctx: 1_048_576, desc: { ar: "أحدث لاما مفتوحة المصدر من ميتا", en: "Meta's newest open Llama" } },
  { puterId: "mistralai:mistralai/mistral-large-2512", name: "Mistral Large 3", provider: "mistralai", ctx: 262_144, desc: { ar: "ميسترال الكبيرة", en: "Mistral's large flagship" } },
  { puterId: "infron:minimax/minimax-m2.5", name: "MiniMax M2.5", provider: "infron", ctx: 204_800, desc: { ar: "ميني ماكس الجديدة", en: "The new MiniMax" } },
];

/** Pretty label for the model chip (static lookup first so it works before
 *  the dynamic catalog ever loads). */
export function modelChipLabel(id: AssistantModelId): string {
  if (id === MODEL_INSTANT) return "Instant";
  if (id === MODEL_CLOUD) return "Cloud · GLM-4-Plus";
  if (isPuterModel(id)) {
    const pid = puterIdOf(id);
    const f = FEATURED_CLOUD.find((m) => m.puterId === pid);
    if (f) return f.name;
    // shorten a raw puter id: "openrouter:anthropic/claude-sonnet-5" -> "claude-sonnet-5"
    const tail = pid.includes("/") ? pid.split("/").slice(-1)[0] : pid;
    return tail.length > 26 ? tail.slice(0, 26) : tail;
  }
  return id;
}

// ── Puter.js loader (singleton — injects the script once, client only) ──

type PuterChatChunk = {
  text?: string;
  message?: { content?: unknown };
  delta?: { content?: string };
};
type PuterGlobal = {
  quiet?: boolean;
  auth?: {
    isSignedIn: () => boolean;
    signIn: () => Promise<unknown>;
    signOut?: () => Promise<unknown>;
    getUser?: () => Promise<{ username?: string }>;
  };
  ai: {
    chat: (
      messages: { role: "system" | "user" | "assistant"; content: string }[],
      options: Record<string, unknown>,
    ) => Promise<unknown>;
    listModels?: () => Promise<PuterCatalogRaw[]>;
  };
};

type PuterCatalogRaw = {
  puterId?: string;
  id?: string;
  name?: string;
  provider?: string;
  context?: number;
  modalities?: { input?: string[] };
};

let puterPromise: Promise<PuterGlobal> | null = null;

/** Load puter.js on demand. Resolves with the global `puter` object. */
export function loadPuter(): Promise<PuterGlobal> {
  if (typeof window === "undefined") return Promise.reject(new Error("server"));
  if (!puterPromise) {
    puterPromise = new Promise<PuterGlobal>((resolve, reject) => {
      const w = window as unknown as { puter?: PuterGlobal };
      if (w.puter) {
        w.puter.quiet = true;
        resolve(w.puter);
        return;
      }
      const s = document.createElement("script");
      s.src = "https://js.puter.com/v2/";
      s.async = true;
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("puter load timeout"));
      }, 25_000);
      const cleanup = () => {
        clearTimeout(timer);
        s.onload = null;
        s.onerror = null;
      };
      s.onload = () => {
        cleanup();
        const p = (window as unknown as { puter?: PuterGlobal }).puter;
        if (p) {
          p.quiet = true;
          resolve(p);
        } else reject(new Error("puter missing"));
      };
      s.onerror = () => {
        cleanup();
        puterPromise = null; // allow a retry on the next interaction
        reject(new Error("puter failed to load"));
      };
      document.head.appendChild(s);
    });
  }
  return puterPromise;
}

/** Is the visitor signed in to their free Puter account? (false when
 *  puter.js is unavailable — never throws) */
export async function puterSignedIn(): Promise<boolean> {
  try {
    const p = await loadPuter();
    return !!p.auth?.isSignedIn?.();
  } catch {
    return false;
  }
}

/** Open Puter's own first-party sign-in popup (free account, no card). */
export async function puterSignIn(): Promise<boolean> {
  const p = await loadPuter();
  await p.auth?.signIn?.();
  return !!p.auth?.isSignedIn?.();
}

export async function puterSignOut(): Promise<void> {
  try {
    const p = await loadPuter();
    await p.auth?.signOut?.();
  } catch {}
}

export async function puterUsername(): Promise<string | null> {
  try {
    const p = await loadPuter();
    const u = await p.auth?.getUser?.();
    return u?.username ?? null;
  } catch {
    return null;
  }
}

// ── the dynamic full catalog (1,000+ models, anonymous — no sign-in) ──

export type CatalogModel = {
  puterId: string;
  name: string;
  provider: string;
  ctx: number | null;
};

let catalogPromise: Promise<CatalogModel[]> | null = null;

export function puterCatalog(): Promise<CatalogModel[]> {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const p = await loadPuter();
      const raw = await p.ai.listModels?.();
      const list = Array.isArray(raw) ? raw : [];
      const out: CatalogModel[] = [];
      const seen = new Set<string>();
      for (const m of list) {
        const pid = typeof m.puterId === "string" ? m.puterId : typeof m.id === "string" ? m.id : "";
        if (!pid || seen.has(pid)) continue;
        seen.add(pid);
        const name = String(m.name ?? pid);
        out.push({
          puterId: pid,
          name: name.length > 44 ? name.slice(0, 44) + "…" : name,
          provider: String(m.provider ?? pid.split(":")[0] ?? ""),
          ctx: typeof m.context === "number" ? m.context : null,
        });
      }
      // stable ordering: zai first, then by provider name, then model name
      const provRank = (p2: string) => (p2 === "zai" ? 0 : p2 === "openai" ? 1 : 2);
      out.sort((a, b) =>
        provRank(a.provider) - provRank(b.provider) ||
        a.provider.localeCompare(b.provider) ||
        a.name.localeCompare(b.name),
      );
      return out;
    })().catch(() => [] as CatalogModel[]);
  }
  return catalogPromise;
}

// ── chat completion on a Puter cloud model ──

/** thrown when a chat is attempted without a Puter sign-in — the UI turns
 *  this into the friendly "sign in free" card instead of an error */
export class PuterAuthRequiredError extends Error {
  constructor() {
    super("puter sign-in required");
    this.name = "PuterAuthRequiredError";
  }
}

function extractContent(chunk: unknown): string {
  const c = chunk as PuterChatChunk | string;
  if (typeof c === "string") return c;
  if (!c || typeof c !== "object") return "";
  if (typeof c.text === "string" && c.text) return c.text;
  const mc = c.message?.content;
  if (typeof mc === "string") return mc;
  if (Array.isArray(mc)) {
    return mc
      .map((b) => (b && typeof b === "object" && typeof (b as { text?: string }).text === "string" ? (b as { text: string }).text : ""))
      .join("");
  }
  if (typeof c.delta?.content === "string") return c.delta.content;
  return "";
}

function stripThinking(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export type PuterChatOpts = {
  /** ms before the call gives up (default 90s — cloud models can be slow) */
  timeoutMs?: number;
  /** live streaming preview callback (full accumulated text) */
  onDelta?: (full: string) => void;
  /** stop reading further chunks (the stop button) */
  stopped?: () => boolean;
};

/** One chat completion against a Puter cloud model. Streams when the
 *  transport allows it and always resolves with the full text. Requires
 *  the visitor to be signed in to Puter (PuterAuthRequiredError otherwise). */
export async function puterChat(
  modelId: AssistantModelId,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  opts: PuterChatOpts = {},
): Promise<string> {
  const puterId = puterIdOf(modelId);
  const p = await loadPuter();
  if (!p.auth?.isSignedIn?.()) throw new PuterAuthRequiredError();

  const timeoutMs = opts.timeoutMs ?? 90_000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
  }, timeoutMs);

  try {
    const res = await p.ai.chat(messages, {
      model: puterId,
      stream: true,
      normalize: true,
    });

    // streaming path — an async iterable of chunks
    if (res && typeof (res as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function") {
      let out = "";
      for await (const chunk of res as AsyncIterable<unknown>) {
        if (timedOut) break;
        if (opts.stopped?.()) break;
        const piece = extractContent(chunk);
        if (piece) {
          out += piece;
          opts.onDelta?.(out);
        }
      }
      if (timedOut && !out) throw new Error("cloud model timeout");
      return stripThinking(out);
    }

    // non-streaming fallback — a single response object
    const text = extractContent(res);
    if (!text) throw new Error("empty cloud response");
    opts.onDelta?.(text);
    return stripThinking(text);
  } finally {
    clearTimeout(timer);
  }
}
