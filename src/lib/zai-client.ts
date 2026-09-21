/** T45 — the direct Z.AI API client (SERVER-ONLY, never imported client-side).
 *
 *  The user supplied their own Z.AI API key and asked that it be used FOR
 *  SIGNALS ONLY, autonomously. This module is that pipe:
 *
 *   - TEXT BRAIN: "glm-4.7-flash" — the newest free GLM-Flash generation
 *     (probe-verified live: served 2026-09-18, supports thinking on/off).
 *     Used with thinking ENABLED for the agent's synthesis reasoning and
 *     DISABLED for small structured fix-ups.
 *   - VISION: "glm-4.6v-flash" — the free GLM vision-flash model
 *     (probe-verified live: correctly described a candlestick PNG's trend).
 *     Reads the real candlestick charts the app renders server-side.
 *
 *  Honesty rules:
 *   - every call reports the model the API ACTUALLY served (echoed in the
 *     response `model` field) — the run row records it verbatim;
 *   - throttle (429) and overload (1305) get bounded retries with backoff,
 *     then the error surfaces — a failed agent run is NEVER fabricated;
 *   - the key comes from ZAI_API_KEY (env / .env) ONLY — it is never a
 *     hardcoded default, never committed to git, never in the browser
 *     bundle; with no key the direct tier skips instantly and callers fall
 *     through to their fallback providers. */

// hard server guard — fails loudly if anything client-side imports this.
// (the "server-only" npm pkg is not installed in this sandbox; this module is
// only ever imported by API routes / server libs / background jobs)
const ZAI_SERVER_ONLY_GUARD = typeof window === "undefined";
if (!ZAI_SERVER_ONLY_GUARD) {
  throw new Error("zai-client must never run in the browser — the API key would leak");
}

export const ZAI_API_KEY = process.env.ZAI_API_KEY ?? "";
const ZAI_BASE = "https://api.z.ai/api/paas/v4/chat/completions";

export const ZAI_SIGNAL_MODEL = "glm-4.7-flash";
export const ZAI_VISION_MODEL = "glm-4.6v-flash";

const TIMEOUT_MS = 110_000;
// T46: a 4th, longer backoff — the free thinking tier's overload windows
// (1305) can run minutes; the brain's bounded chain now rides out ~2min of
// throttle before failing honestly (vision keeps its 1-retry cap so a dead
// vision tier can never starve the brain's budget).
const RETRY_BACKOFF_MS = [8_000, 20_000, 35_000, 60_000];

export type ZaiUsage = { promptTokens: number; completionTokens: number; totalTokens: number };
export type ZaiChatResult = {
  content: string;
  /** T46 — the model's THINKING stream (GLM `reasoning_content`), captured
   *  verbatim when thinking is on; null when the model thought silently or
   *  thinking was off. This is what makes the agent's reasoning VISIBLE. */
  reasoning: string | null;
  servedModel: string;
  usage: ZaiUsage | null;
  ms: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class ZaiError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "ZaiError";
  }
}

function classify(err: unknown): ZaiError {
  if (err instanceof ZaiError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (/timeout|abort/i.test(msg)) return new ZaiError(`zai: request timed out after ${TIMEOUT_MS}ms`, null, true);
  return new ZaiError(`zai: ${msg}`, null, false);
}

/** One chat completion against the user's key. Retries throttle/overload with
 *  bounded backoff; everything else fails honestly. */
export async function zaiChat(opts: {
  messages: { role: "system" | "user" | "assistant"; content: unknown }[];
  model?: string;
  thinking?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** cap the throttle/overload retry chain (default: all 3 backoffs). The
   *  vision pass uses 1 — its retries burn the free tier's REQUEST rate
   *  budget (1302) which then starves the brain call. */
  maxRetries?: number;
}): Promise<ZaiChatResult> {
  // no key configured (e.g. a host without env vars) → skip instantly with
  // no wasted 401 round-trip; callers fall through to their fallback tier.
  if (!ZAI_API_KEY) {
    throw new ZaiError("zai: ZAI_API_KEY is not configured (set it in .env / host env vars) — direct tier skipped", null, false);
  }
  const model = opts.model ?? ZAI_SIGNAL_MODEL;
  const t0 = Date.now();
  const retryPlan = RETRY_BACKOFF_MS.slice(0, Math.max(0, opts.maxRetries ?? RETRY_BACKOFF_MS.length));
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ZAI_BASE, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ZAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: opts.messages,
          // T46 — thinking is now EXPLICIT both ways: {type:"enabled"} when the
          // caller wants reasoning (the agent's brain), {type:"disabled"} for
          // the small mechanical fix-ups. glm-4.7-flash is a reasoning model —
          // enabled is its native mode and the thinking stream is captured.
          thinking: opts.thinking === false ? { type: "disabled" } : { type: "enabled" },
          ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        let code: string | null = null;
        try {
          code = (JSON.parse(body) as { error?: { code?: string | number } }).error?.code != null
            ? String((JSON.parse(body) as { error?: { code?: string | number } }).error?.code)
            : null;
        } catch {}
        // 429 throttle / 1305 overload / 5xx are transient — retry with backoff
        const retryable = res.status === 429 || code === "1305" || res.status >= 500;
        throw new ZaiError(`zai ${model}: HTTP ${res.status}${code ? ` (code ${code})` : ""} ${body.slice(0, 180)}`, code, retryable);
      }
      const json = (await res.json()) as {
        model?: string;
        choices?: { message?: { content?: string; reasoning_content?: string; reasoning?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const content = json.choices?.[0]?.message?.content ?? "";
      // GLM returns the thinking stream as `reasoning_content` (DeepSeek-style
      // OpenAI-compat shape); some builds call it `reasoning` — accept both.
      const reasoningRaw = json.choices?.[0]?.message?.reasoning_content ?? json.choices?.[0]?.message?.reasoning;
      const reasoning = typeof reasoningRaw === "string" && reasoningRaw.trim().length > 0 ? reasoningRaw.trim() : null;
      return {
        content,
        reasoning,
        servedModel: json.model ?? model,
        usage:
          json.usage && Number.isFinite(json.usage.total_tokens)
            ? {
                promptTokens: json.usage.prompt_tokens ?? 0,
                completionTokens: json.usage.completion_tokens ?? 0,
                totalTokens: json.usage.total_tokens ?? 0,
              }
            : null,
        ms: Date.now() - t0,
      };
    } catch (err) {
      const e = classify(err);
      const wait = retryPlan[attempt];
      if (e.retryable && wait !== undefined) {
        console.warn(`[zai] ${e.message} — retrying in ${wait / 1000}s (attempt ${attempt + 1}/${retryPlan.length})`);
        await sleep(wait);
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** T56 — STREAMING chat completion against the user's key, straight over
 *  HTTPS. Same endpoint/auth/throttle-retry semantics as zaiChat, but the
 *  answer arrives as OpenAI-style SSE (data: lines with
 *  choices[0].delta.content) which is forwarded live through onDelta — built
 *  so the in-app AGENT chat route can run the strong GLM backbone on ANY
 *  host that has ZAI_API_KEY set (Vercel, containers…), where the
 *  sandbox-only z-ai-web-dev-sdk cannot authenticate. Reasoning deltas
 *  (reasoning_content / reasoning) are consumed but NOT forwarded — the
 *  agent's strict-JSON protocol wants the content stream only. */
export async function zaiChatStream(opts: {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  model?: string;
  thinking?: boolean;
  maxTokens?: number;
  temperature?: number;
  onDelta?: (text: string) => void;
  onServedModel?: (model: string) => void;
  maxRetries?: number;
}): Promise<string> {
  if (!ZAI_API_KEY) {
    throw new ZaiError("zai: ZAI_API_KEY is not configured (set it in .env / host env vars) — direct tier skipped", null, false);
  }
  const model = opts.model ?? ZAI_SIGNAL_MODEL;
  const retryPlan = RETRY_BACKOFF_MS.slice(0, Math.max(0, opts.maxRetries ?? RETRY_BACKOFF_MS.length));
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ZAI_BASE, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ZAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: opts.messages,
          stream: true,
          thinking: opts.thinking === true ? { type: "enabled" } : { type: "disabled" },
          ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        let code: string | null = null;
        try {
          code = (JSON.parse(body) as { error?: { code?: string | number } }).error?.code != null
            ? String((JSON.parse(body) as { error?: { code?: string | number } }).error?.code)
            : null;
        } catch {}
        const retryable = res.status === 429 || code === "1305" || res.status >= 500;
        throw new ZaiError(`zai ${model}: HTTP ${res.status}${code ? ` (code ${code})` : ""} ${body.slice(0, 180)}`, code, retryable);
      }
      if (!res.body) throw new ZaiError("zai: stream returned no body", null, false);
      // consume the SSE stream line-by-line
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let out = "";
      let buf = "";
      let modelSeen = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).replace(/\r$/, "");
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const j = JSON.parse(payload) as {
              model?: unknown;
              choices?: { delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown } }[];
            };
            if (!modelSeen && typeof j.model === "string" && j.model.length > 0) {
              modelSeen = true;
              opts.onServedModel?.(j.model);
            }
            const piece = j.choices?.[0]?.delta?.content;
            if (typeof piece === "string" && piece.length > 0) {
              out += piece;
              opts.onDelta?.(piece);
            }
          } catch {
            /* partial line / keepalive — the next chunk completes it */
          }
        }
      }
      if (!out.trim()) throw new ZaiError(`zai ${model}: stream ended with empty content`, null, true);
      return out;
    } catch (err) {
      const e = classify(err);
      const wait = retryPlan[attempt];
      if (e.retryable && wait !== undefined) {
        console.warn(`[zai-stream] ${e.message} — retrying in ${wait / 1000}s (attempt ${attempt + 1}/${retryPlan.length})`);
        await sleep(wait);
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── JSON extraction (single top-level object, fences + think tags tolerated) ──

function* topLevelJsonObjects(s: string): Generator<string> {
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf("{", i);
    if (start === -1) return;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let closed = false;
    for (let j = start; j < s.length; j++) {
      const c = s[j];
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        if (inStr) esc = true;
        continue;
      }
      if (c === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          yield s.slice(start, j + 1);
          i = j + 1;
          closed = true;
          break;
        }
      }
    }
    if (!closed) return;
  }
}

export function zaiExtractJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let s = raw.trim().replace(/<think>[\s\S]*?<\/think>/gi, "");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  for (const span of topLevelJsonObjects(s)) {
    try {
      const p = JSON.parse(span);
      if (p && typeof p === "object") return p as Record<string, unknown>;
    } catch {
      /* next span */
    }
  }
  return null;
}

/** Chat call that must answer with ONE JSON object. One repair round on
 *  unparseable output, then honest failure. The THINKING stream of the first
 *  (thinking-on) call is preserved — the agent's reasoning ships with the run. */
export async function zaiChatJson(
  opts: Parameters<typeof zaiChat>[0]
): Promise<{ parsed: Record<string, unknown>; reasoning: string | null; servedModel: string; usage: ZaiUsage | null; ms: number }> {
  const first = await zaiChat(opts);
  let parsed = zaiExtractJson(first.content);
  if (parsed) return { parsed, reasoning: first.reasoning, servedModel: first.servedModel, usage: first.usage, ms: first.ms };
  // one repair round (thinking off — a small mechanical fix-up)
  const fix = await zaiChat({
    ...opts,
    thinking: false,
    messages: [
      {
        role: "user",
        content:
          "Your previous reply was not parseable as a single JSON object. Here it is, truncated:\n" +
          first.content.slice(0, 3000) +
          "\n\nRe-send the SAME answer as EXACTLY ONE valid JSON object (no fences, no commentary). Keep every field and number.",
      },
    ],
  });
  parsed = zaiExtractJson(fix.content);
  if (parsed) return { parsed, reasoning: first.reasoning, servedModel: fix.servedModel, usage: fix.usage, ms: first.ms + fix.ms };
  throw new ZaiError("zai: unparseable JSON reply after repair", null, false);
}

/** The VISION pass — one image (base64 PNG) + prompt → text. ONE retry
 *  only: the vision tier shares the key's request-rate budget with the
 *  brain, and a chain of vision retries under overload (1305) can trip the
 *  request-rate limit (1302) and starve the run's essential brain call. */
export async function zaiVision(opts: {
  imageBase64Png: string;
  prompt: string;
  maxTokens?: number;
}): Promise<{ content: string; servedModel: string; ms: number }> {
  const res = await zaiChat({
    model: ZAI_VISION_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/png;base64,${opts.imageBase64Png}` } },
          { type: "text", text: opts.prompt },
        ],
      },
    ],
    maxTokens: opts.maxTokens ?? 1400,
    maxRetries: 1,
  });
  return { content: res.content, servedModel: res.servedModel, ms: res.ms };
}

// ── T52 — the SDK FALLBACK TIER for server-side JSON brains ─────────────────
// The direct API's free tier has overload windows (1305) that can run for
// MINUTES; the sandbox SDK's GLM-4-Plus is a SEPARATE quota pool. When the
// direct tier is unavailable (no key configured / overload exhausted), the
// autonomous agent's brain falls back here so it keeps thinking through
// the window instead of failing the whole run. Outside the sandbox the SDK
// rejects at create() and the honest direct-tier error surfaces as before.

type SdkMessage = { role: "system" | "user" | "assistant"; content: string };

let sdkPromise: Promise<Awaited<ReturnType<typeof import("z-ai-web-dev-sdk").default.create>>> | null = null;
async function getSdk() {
  if (!sdkPromise) sdkPromise = (await import("z-ai-web-dev-sdk")).default.create();
  return sdkPromise;
}

async function sdkChatRound(
  messages: SdkMessage[],
  thinking: boolean
): Promise<{ content: string; reasoning: string | null; servedModel: string }> {
  const client = await getSdk();
  // a leading "assistant" charter message is legal on the direct API but
  // some SDK backends reject it — map message[0] to a proper system role
  const mapped = messages.map((m, i) =>
    i === 0 && m.role === "assistant" ? ({ role: "system" as const, content: m.content } as SdkMessage) : m
  );
  const res = (await client.chat.completions.create({
    messages: mapped,
    thinking: { type: thinking ? "enabled" : "disabled" },
  })) as {
    model?: string;
    choices?: { message?: { content?: string; reasoning_content?: string; reasoning?: string } }[];
  };
  const content = res.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) throw new ZaiError("sdk: empty content", null, false);
  const reasoningRaw = res.choices?.[0]?.message?.reasoning_content ?? res.choices?.[0]?.message?.reasoning;
  return {
    content,
    reasoning: typeof reasoningRaw === "string" && reasoningRaw.trim().length > 0 ? reasoningRaw.trim() : null,
    servedModel: res.model ?? "glm-4-plus (sdk fallback)",
  };
}

/** One SDK round with ONE throttle backoff (6s), then honest failure. */
async function sdkChat(
  messages: SdkMessage[],
  thinking: boolean
): Promise<{ content: string; reasoning: string | null; servedModel: string; ms: number }> {
  const t0 = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await sdkChatRound(messages, thinking);
      return { ...r, ms: Date.now() - t0 };
    } catch (err) {
      const e = classify(err);
      if (attempt < 1 && (e.retryable || /rate|throttle|429|overload|1305/i.test(e.message))) {
        await sleep(6_000);
        continue;
      }
      throw e;
    }
  }
}

/** T52 — the LAYERED JSON brain: direct key first (thinking on, full retry
 *  chain), sandbox SDK second (separate quota pool). Whichever answers with
 *  a parseable JSON object wins; the served model is reported honestly so
 *  the run row records which tier actually thought. */
export async function brainJson(opts: {
  messages: { role: "system" | "user" | "assistant"; content: unknown }[];
  maxTokens?: number;
}): Promise<{ parsed: Record<string, unknown>; reasoning: string | null; servedModel: string; usage: ZaiUsage | null; ms: number; tier: "direct" | "sdk" }> {
  let directErr: unknown = null;
  try {
    const r = await zaiChatJson({ messages: opts.messages, thinking: true, maxTokens: opts.maxTokens });
    return { ...r, tier: "direct" };
  } catch (err) {
    directErr = err;
    console.warn(
      "[zai] direct brain tier unavailable — trying the sandbox SDK fallback:",
      err instanceof Error ? err.message : String(err)
    );
  }
  try {
    const messages: SdkMessage[] = opts.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));
    const first = await sdkChat(messages, true);
    let parsed = zaiExtractJson(first.content);
    if (parsed) return { parsed, reasoning: first.reasoning, servedModel: first.servedModel, usage: null, ms: first.ms, tier: "sdk" };
    // one repair round (thinking off — mechanical fix-up), same as direct
    const fix = await sdkChat(
      [
        {
          role: "user",
          content:
            "Your previous reply was not parseable as a single JSON object. Here it is, truncated:\n" +
            first.content.slice(0, 3000) +
            "\n\nRe-send the SAME answer as EXACTLY ONE valid JSON object (no fences, no commentary). Keep every field and number.",
        },
      ],
      false
    );
    parsed = zaiExtractJson(fix.content);
    if (parsed) return { parsed, reasoning: first.reasoning, servedModel: fix.servedModel, usage: null, ms: first.ms + fix.ms, tier: "sdk" };
    throw new ZaiError("sdk: unparseable JSON reply after repair", null, false);
  } catch (sdkErr) {
    console.warn(
      "[zai] SDK fallback tier also unavailable:",
      sdkErr instanceof Error ? sdkErr.message : String(sdkErr)
    );
    // both tiers failed → surface the DIRECT error (the primary brain)
    throw directErr instanceof Error ? directErr : new ZaiError(String(directErr), null, false);
  }
}

/** T52 — the layered small-fix-up chat (thinking off): direct key first,
 *  SDK fallback second. Used by the shared validation spine. */
export async function brainChat(messages: { role: "system" | "user" | "assistant"; content: string }[]): Promise<string> {
  try {
    const r = await zaiChat({ messages, thinking: false, maxTokens: 1200 });
    return r.content;
  } catch {
    const r = await sdkChat(messages, false);
    return r.content;
  }
}
