"use client";

/** T28 — the FREE, fully client-based model catalog for the AI assistant
 *  popup, powered by WebLLM (@mlc-ai/web-llm, Apache-2.0): the models are
 *  downloaded once from the public MLC-AI CDN and then run ENTIRELY in the
 *  user's browser via WebGPU — no API key, no server, no cost, works offline
 *  after the first download.
 *
 *  This module must ALWAYS be dynamically imported from the client (the
 *  component does `await import("@/lib/assistant-models")`) so the ~1MB
 *  WebLLM runtime never lands in the main bundle and never runs on the
 *  server. */

export type AssistantModelId = string; // "instant" | "cloud" | "<webllm model_id>"

export type FeaturedModel = {
  /** exact WebLLM prebuilt model_id */
  id: string;
  /** display label */
  label: string;
  /** VRAM/disk needed, GB */
  sizeGb: number;
  /** short bilingual blurb */
  desc: { ar: string; en: string };
};

/** Hand-curated featured ladder — every id VERIFIED against
 *  prebuiltAppConfig.model_list of @mlc-ai/web-llm@0.2.85 (163 entries).
 *  Ordered smallest → heaviest so the first row is the one that works on
 *  almost any WebGPU machine. */
export const FEATURED_MODELS: FeaturedModel[] = [
  { id: "SmolLM2-360M-Instruct-q4f16_1-MLC", label: "SmolLM 2 · 360M", sizeGb: 0.4, desc: { ar: "أصغر نموذج — أسرع تحميل", en: "Smallest — fastest download" } },
  { id: "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC", label: "TinyLlama · 1.1B", sizeGb: 0.7, desc: { ar: "خفيف وسريع للمهام البسيطة", en: "Light and quick for simple tasks" } },
  { id: "gemma3-1b-it-q4f16_1-MLC", label: "Gemma 3 · 1B", sizeGb: 0.7, desc: { ar: "جوجل — ردود طبيعية", en: "Google — natural replies" } },
  { id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 · 0.5B", sizeGb: 0.9, desc: { ar: "عائلة كوين — متعدد اللغات", en: "Qwen family — multilingual" } },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 · 1B", sizeGb: 0.9, desc: { ar: "ميتا — توازن جيد", en: "Meta — good balance" } },
  { id: "Qwen3-0.6B-q4f16_1-MLC", label: "Qwen 3 · 0.6B", sizeGb: 1.4, desc: { ar: "الأحدث من كوين", en: "Newest Qwen generation" } },
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 · 1.5B", sizeGb: 1.6, desc: { ar: "شائع ومتوازن", en: "Popular all-rounder" } },
  { id: "Qwen3-1.7B-q4f16_1-MLC", label: "Qwen 3 · 1.7B", sizeGb: 2.0, desc: { ar: "توليد أفضل + تفكير", en: "Better generation + reasoning" } },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 · 3B", sizeGb: 2.2, desc: { ar: "أفضل جودة في حدود ٢ جيجا", en: "Best quality under ~2GB" } },
  { id: "Qwen3-4B-q4f16_1-MLC", label: "Qwen 3 · 4B", sizeGb: 3.4, desc: { ar: "جودة عالية للتخطيط", en: "High quality planning" } },
  { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", label: "Phi 3.5 mini", sizeGb: 3.7, desc: { ar: "مايكروسوفت — قوي للمهام المنطقية", en: "Microsoft — strong on logic" } },
  { id: "Mistral-7B-Instruct-v0.3-q4f16_1-MLC", label: "Mistral · 7B", sizeGb: 4.6, desc: { ar: "نموذج مرجعي قوي", en: "Strong reference model" } },
  { id: "Llama-3.1-8B-Instruct-q4f16_1-MLC", label: "Llama 3.1 · 8B", sizeGb: 5.0, desc: { ar: "الأقوى في القائمة المميزة", en: "Strongest in the featured list" } },
  { id: "Qwen2.5-7B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 · 7B", sizeGb: 5.1, desc: { ar: "كوين الكبير — دقة أعلى", en: "Big Qwen — higher accuracy" } },
  { id: "DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC", label: "DeepSeek R1 · 7B", sizeGb: 5.1, desc: { ar: "نموذج استدلال خطوة بخطوة", en: "Step-by-step reasoning model" } },
  { id: "gemma-2-9b-it-q4f16_1-MLC", label: "Gemma 2 · 9B", sizeGb: 6.4, desc: { ar: "الأثقل — يحتاج جهازًا قويًا", en: "Heaviest — needs a strong GPU" } },
];

/** The two non-WebLLM entries always shown above the on-device ladder:
 *  instant = the built-in zero-download command router; cloud = the app's
 *  own GLM endpoint (works on every browser, no WebGPU needed). */
export const MODEL_INSTANT = "instant";
export const MODEL_CLOUD = "cloud";

export function isWebLLMModel(id: AssistantModelId): boolean {
  return id !== MODEL_INSTANT && id !== MODEL_CLOUD;
}

/** Pretty label for the model chip (also used before the full registry is
 *  fetched — hence the static featured lookup first). */
export function modelChipLabel(id: AssistantModelId): string {
  if (id === MODEL_INSTANT) return "Instant";
  if (id === MODEL_CLOUD) return "Cloud · GLM";
  const f = FEATURED_MODELS.find((m) => m.id === id);
  if (f) return f.label;
  // shorten a raw webllm id: "Qwen2.5-0.5B-Instruct-q4f32_1-MLC" -> "Qwen2.5-0.5B q4f32"
  const base = id.replace(/-MLC$/, "").replace(/-?q(\d)f(\d+)(-1k)?$/, (m) => ` ${m.replace(/^-/, "")}`);
  return base.length > 26 ? base.slice(0, 26) : base;
}

// ── WebGPU detection (cached promise — navigator.gpu is only present in
//    Chromium-family browsers today; Safari/Firefox fall back to Cloud) ──

let webgpuPromise: Promise<boolean> | null = null;
export function detectWebGPU(): Promise<boolean> {
  if (!webgpuPromise) {
    webgpuPromise = (async () => {
      try {
        const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
        if (!gpu) return false;
        const adapter = await gpu.requestAdapter();
        return adapter != null;
      } catch {
        return false;
      }
    })();
  }
  return webgpuPromise;
}

// ── Engine management ──
// One engine lives for the app session; switching models unloads first.
// The loader reports WebLLM's own init progress (download %/speed) so the
// UI can show an honest progress bar instead of a fake spinner.

type MLCEngineLike = {
  chat: {
    completions: {
      create: (opts: Record<string, unknown>) => Promise<AsyncIterable<{ choices: ({ delta?: { content?: string }; message?: { content?: string } })[] }>>;
    };
  };
  unload: () => Promise<void>;
  interruptGenerate: () => void;
};

export type EngineStatus =
  | { phase: "idle" }
  | { phase: "loading"; model: string; progress: number; text: string }
  | { phase: "ready"; model: string }
  | { phase: "error"; model: string; message: string };

let engine: MLCEngineLike | null = null;
let engineModel: string | null = null;
let loadAbort = false;

/** Live status listeners (the popup subscribes; the loader is the only
 *  writer). Kept module-level so closing the popup never orphans a download. */
const statusListeners = new Set<(s: EngineStatus) => void>();
export function onEngineStatus(fn: (s: EngineStatus) => void): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}
function emit(s: EngineStatus) {
  for (const fn of statusListeners) fn(s);
}

export function currentEngineStatus(): EngineStatus {
  if (engine && engineModel) return { phase: "ready", model: engineModel };
  return { phase: "idle" };
}

/** Parse WebLLM's initProgressCallback report into {0..1, human text}. */
function parseProgress(report: { progress?: number; text?: string }): { progress: number; text: string } {
  const p = typeof report.progress === "number" && Number.isFinite(report.progress) ? Math.min(1, Math.max(0, report.progress)) : 0;
  let text = report.text ?? "";
  // WebLLM prefixes "[Fetching model]" / "[Loading model]" — keep it short
  text = text.replace(/\s+/g, " ").trim();
  return { progress: p, text };
}

/** Load (or reuse) the on-device engine for a WebLLM model id. */
export async function loadEngine(modelId: string): Promise<MLCEngineLike> {
  if (engine && engineModel === modelId) return engine;
  loadAbort = false;
  if (engine) {
    try {
      await engine.unload();
    } catch {}
    engine = null;
    engineModel = null;
  }
  emit({ phase: "loading", model: modelId, progress: 0, text: "" });
  try {
    const webllm = await import("@mlc-ai/web-llm");
    const created = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (report: unknown) => {
        const { progress, text } = parseProgress((report ?? {}) as { progress?: number; text?: string });
        emit({ phase: "loading", model: modelId, progress, text });
      },
    });
    if (loadAbort) {
      // the user switched away mid-download — throw it away immediately
      try {
        await (created as unknown as MLCEngineLike).unload();
      } catch {}
      emit({ phase: "idle" });
      throw new Error("cancelled");
    }
    engine = created as unknown as MLCEngineLike;
    engineModel = modelId;
    emit({ phase: "ready", model: modelId });
    return engine;
  } catch (err) {
    engine = null;
    engineModel = null;
    const message = err instanceof Error ? err.message : String(err);
    emit({ phase: "error", model: modelId, message });
    throw err;
  }
}

/** Abort an in-flight load and free the VRAM of a ready engine. */
export async function unloadEngine(): Promise<void> {
  loadAbort = true;
  try {
    engine?.interruptGenerate();
  } catch {}
  if (engine) {
    try {
      await engine.unload();
    } catch {}
  }
  engine = null;
  engineModel = null;
  emit({ phase: "idle" });
}

/** Stop an in-flight generation (the stop button) without unloading. */
export function interruptEngine(): void {
  try {
    engine?.interruptGenerate();
  } catch {}
}

export function isEngineReady(modelId: string): boolean {
  return engine != null && engineModel === modelId;
}

/** Streaming chat completion on the loaded engine. Strips 21st-century
 *  "thinking" tags (DeepSeek-R1 / Qwen3 emit <think>…</think>) so small-model
 *  reasoning never leaks into the JSON parser or the UI. */
export async function engineChat(
  modelId: string,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  onDelta?: (full: string) => void,
): Promise<string> {
  const e = await loadEngine(modelId);
  const stream = await e.chat.completions.create({ messages, temperature: 0.6, stream: true });
  let out = "";
  for await (const chunk of stream) {
    const piece = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? "";
    if (piece) {
      out += piece;
      onDelta?.(out);
    }
  }
  return out.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

// ── Full registry ("ALL the models") — pulled live from the package so new
//    WebLLM releases automatically widen the catalog. Embedding models are
//    filtered out (they are not chat models). ──

export type RegistryModel = {
  id: string;
  sizeGb: number;
  vramMb: number;
  lowResource: boolean;
  ctx: number | null;
};

let registryPromise: Promise<RegistryModel[]> | null = null;
export function fullModelRegistry(): Promise<RegistryModel[]> {
  if (!registryPromise) {
    registryPromise = (async () => {
      try {
        const webllm = await import("@mlc-ai/web-llm");
        const list = webllm.prebuiltAppConfig.model_list;
        return list
          .filter((m) => !/embed/i.test(m.model_id))
          .map((m) => ({
            id: m.model_id,
            vramMb: m.vram_required_MB ?? 0,
            sizeGb: (m.vram_required_MB ?? 0) / 1024,
            lowResource: !!m.low_resource_required,
            ctx: (m.overrides?.context_window_size as number | undefined) ?? null,
          }))
          .sort((a, b) => a.vramMb - b.vramMb);
      } catch {
        return [];
      }
    })();
  }
  return registryPromise;
}
