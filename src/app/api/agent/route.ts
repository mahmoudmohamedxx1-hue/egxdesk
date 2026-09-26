import { NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

import { ZAI_API_KEY, zaiChatStream } from "@/lib/zai-client";
import { pollinationsRound } from "@/lib/pollinations";
import { KEYLESS_MODEL_ID, KEYLESS_FALLBACK_MODEL_ID, KEYLESS_POOL_MODEL_IDS } from "@/lib/ai-models";
type Zai = Awaited<ReturnType<typeof ZAI.create>>;
import { db } from "@/lib/db";
import { findAiModel, DEFAULT_AI_MODEL_ID, aiModelIdentity, type AiModel } from "@/lib/ai-models";
import { AGENT_TOOLS } from "@/lib/agent-core";
import { buildAgentSystemPrompt, extractJson, makeFinalPreviewer, verifyFinalAnswer, verificationRepairMessage, verificationFootnote } from "@/lib/agent-protocol";
// T58 — deterministic Arabic/English briefing + the language gate the
// weak keyless tier needed (it answers Arabic questions in Portuguese).
import { composeBriefing, languageOk, languageRepairMessage, type ToolResultRef } from "@/lib/briefing-composer";

/** POST /api/agent — the in-app EGX analyst agent (inspired by the tool-loop
 *  pattern of open-source agent frameworks like shubhamsaboo/awesome-llm-apps
 *  and the agent-skills repos): an LLM with STRICT-JSON tool calling over our
 *  own live data layer — quotes, screening, technicals (the composite
 *  technical + fundamental + news signal engine), statements, dividends,
 *  news, calendar, rates, insider filings, flows, the AI signals set. The
 *  loop runs server-side (z-ai-web-dev-sdk never reaches the client), max
 *  ~10 tool calls per question, then the model writes the final markdown
 *  answer. Gateway 429s are retried with backoff; every request is metered
 *  in UsageEvent.
 *
 *  T33 → T67: the model registry is now SERVER-ONLY — every model (the
 *  z-ai gateway GLM-4-Plus, llm7's keyless GLM-5.3-Flash, the Kilo pool,
 *  Pollinations) runs through this route's SSE loop. The old client-side
 *  Puter loop was REMOVED at the user's request (T67) — puter ids sent by
 *  an old client simply fall back to the server default instead of erroring.
 *
 *  Honesty by design: tools return only real (delayed ~15-min) data; the
 *  system prompt forbids invented numbers; the response carries a fixed
 *  disclaimer that the client always renders. */

export const runtime = "nodejs";

// ── rate limiting + usage metering (per IP or device, persisted in SQLite) ──
// 60 agent questions/hour protects a personal tool from floods; since Task 19
// the counter lives in the UsageEvent table, so it survives restarts (the old
// in-memory map reset on every deploy). The upstream LLM gateway ALSO
// throttles bursts (~9-10 calls / ~90-120s window → 429) — those are retried
// with backoff below, and every request is metered for /api/usage.

const RATE_LIMIT = 60; // agent requests per hour, per IP or deviceId

const rateMap = new Map<string, number[]>();

function rateLimitedMemory(ip: string): boolean {
  const now = Date.now();
  const window = 60 * 60_000;
  const arr = (rateMap.get(ip) ?? []).filter((t) => now - t < window);
  if (arr.length >= RATE_LIMIT) {
    rateMap.set(ip, arr);
    return true;
  }
  arr.push(now);
  rateMap.set(ip, arr);
  if (rateMap.size > 500) {
    // drop stale entries so the map can never grow unbounded
    for (const [k, v] of rateMap) if (v.every((t) => now - t >= window)) rateMap.delete(k);
  }
  return false;
}

async function overLimit(ip: string, deviceId: string | null): Promise<boolean> {
  try {
    const since = new Date(Date.now() - 60 * 60_000);
    const count = await db.usageEvent.count({
      where: { createdAt: { gte: since }, OR: [{ ip }, ...(deviceId ? [{ deviceId }] : [])] },
    });
    return count >= RATE_LIMIT;
  } catch {
    return rateLimitedMemory(ip); // SQLite unreachable → in-memory fallback
  }
}

// ── platform 429 handling: a mid-loop throttle must not kill a question ──

const RETRY_BACKOFF_MS = [12_000, 25_000];
const RETRY_BUDGET_MS = 70_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isThrottleError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("429") || /too many requests/i.test(msg);
}

// ── streaming chat (Task 20: the answer streams live over SSE) ──

type DeltaFn = (text: string) => void;

type ServedModelFn = (m: string) => void;

/** T67 — LIVE THINKING: whenever the serving model streams its chain of
 *  thought (GLM `reasoning_content` deltas — emitted by GLM-5.3-Flash on
 *  the keyless cloud and by the direct Z.AI cloud when thinking is on),
 *  every token is forwarded to the client as a `think` SSE event so the
 *  user literally watches the model reason. GLM-4-Plus (pre-thinking
 *  generation) emits none — the client then shows the honest work-trace
 *  (tool steps + statuses) instead. */
type ThinkFn = (text: string) => void;

/** Consume the gateway's SSE chat stream (data: lines with
 *  choices[0].delta.content chunks), accumulating the full text. The served
 *  model id arrives in the chunk metadata — captured once so the done event
 *  can report the model the provider ACTUALLY used (honest labeling).
 *  `delta.reasoning_content` (and the `reasoning` alias) stream to onThink. */
async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onDelta?: DeltaFn,
  onServedModel?: ServedModelFn,
  onThink?: ThinkFn
): Promise<string> {
  const reader = body.getReader();
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
          choices?: { delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown } }[];
          model?: unknown;
        };
        if (!modelSeen && typeof j.model === "string" && j.model.length > 0) {
          modelSeen = true;
          onServedModel?.(j.model);
        }
        const d = j.choices?.[0]?.delta;
        const thinkPiece = d?.reasoning_content ?? d?.reasoning;
        if (typeof thinkPiece === "string" && thinkPiece.length > 0) {
          onThink?.(thinkPiece);
        }
        const piece = d?.content;
        if (typeof piece === "string" && piece.length > 0) {
          out += piece;
          onDelta?.(piece);
        }
      } catch {
        /* partial line / keepalive — the next chunk completes it */
      }
    }
  }
  return out;
}

let zaiPromise: Promise<Zai> | null = null;

function getZai(): Promise<Zai> {
  if (!zaiPromise) {
    zaiPromise = ZAI.create();
    // T67 — a FAILED create must not poison the cache forever (a cold-start
    // hiccup used to sink every later request to the keyless tier even
    // after the gateway recovered): clear the cache so the next request
    // retries the SDK path.
    zaiPromise.catch(() => {
      zaiPromise = null;
    });
  }
  return zaiPromise;
}

/** GET /api/agent — the HOST BACKBONE report the model switcher shows before
 *  the user ever asks a question: which engine actually serves answers on
 *  THIS host (sdk GLM-4-Plus / direct GLM-4-Plus via ZAI_API_KEY / keyless
 *  GLM-5.3-Flash), so "why did GLM-5.3-Flash answer when I picked
 *  GLM-4-Plus?" is answered in the open, up front, with the fix (set
 *  ZAI_API_KEY) spelled out. Cheap: one SDK create race + env check. */
export async function GET() {
  let sdk = false;
  try {
    await Promise.race([
      getZai(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("sdk probe timeout")), 3_000)),
    ]);
    sdk = true;
  } catch {
    sdk = false;
  }
  const backbone: "sdk" | "direct" | "keyless" = sdk ? "sdk" : ZAI_API_KEY ? "direct" : "keyless";
  return NextResponse.json(
    {
      backbone,
      engine:
        backbone === "keyless"
          ? "GLM-5.3-Flash"
          : "GLM-4-Plus",
      needsKey: backbone === "keyless",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// ── T56 → T65 — the DIRECT GLM-4-Plus backbone (plain HTTPS, user's ZAI_API_KEY)
// Outside the sandbox (Vercel, containers…) the z-ai SDK cannot authenticate,
// but the agent must NOT sink to the weak keyless tier when a perfectly good
// strong model is one fetch away. T65 — the user asked for GLM-4-PLUS as the
// MAIN model: when the key is configured, glm-4-plus via the direct API is
// now the backbone (was glm-4.7-flash) — the tool loop, the verification
// failovers and the final synthesis all run on it, exactly like the GLM-4-Plus
// backbone runs inside the sandbox.
const DIRECT_GLM: AiModel = {
  id: "zai-direct:glm-4-plus",
  provider: "zai",
  providerModel: "glm-4-plus",
  label: "GLM-4-Plus",
  labelAr: "GLM-4-Plus",
  note: "Direct Z.AI cloud via the server key — the GLM-4-Plus backbone on any host",
  noteAr: "سحابة Z.AI المباشرة عبر مفتاح الخادم — العمود الفقري GLM-4-Plus على أي مستضيف",
};

// T56 — weak-model output hygiene: keyless models (Mistral Nemo…) sometimes
// emit literal "\n" escapes as TEXT and markdown tables whose headers carry
// garbage foreign-script fragments (e.g. Cyrillic inside an Arabic answer).
// Both are cleaned here so the user never sees transport artifacts; the
// content itself is untouched — numbers still pass the T38 verification gate.
const FOREIGN_SCRIPT = /[\u0370-\u03FF\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;
const ZERO_WIDTH = /[\u200B\u200C\u200D\uFEFF]/g;

function sanitizeAgentAnswer(text: string): string {
  let s = text;
  // 1 — literal escape sequences emitted as text ("\\n" as two characters)
  if (/\\[nrt]/.test(s)) {
    s = s.replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\t/g, " ").replace(/\\"/g, '"');
  }
  // 2 — broken markdown tables: foreign-script garbage in the header, or a
  // "table" with no data rows at all → drop the block entirely
  s = s.replace(/(^\|[^\n]*\|\s*\n?)+/gm, (block) => {
    const rows = block.trim().split("\n").filter((r) => r.trim().length > 0);
    const header = rows[0] ?? "";
    if (FOREIGN_SCRIPT.test(header)) return "";
    if (rows.length < 3) return ""; // header + separator only = no data
    return block;
  });
  // 3 — zero-width junk + runaway blank lines
  s = s.replace(ZERO_WIDTH, "");
  s = s.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+$/gm, "").trim();
  return s;
}

// ── T36 — LLM7.io KEYLESS cloud rounds ─────────────────────────────────────
// The Puter sign-in flow can be blocked (popup blockers, Cloudflare
// Turnstile, corporate networks), so the agent also ships genuinely
// KEYLESS cloud models: LLM7.io's anonymous tier serves a small set of
// real models (Mistral Nemo, Codestral, MiniMax M2.7 — live-verified) with
// zero auth, zero sign-in and zero keys, from the server side (no CORS
// constraints). Shared anonymous pool → 429s retry with the same backoff
// budget as the z-ai gateway, then degrade honestly.

const LLM7_URL = "https://api.llm7.io/v1/chat/completions";

// T66 — the Kilo Gateway keyless pool (adopted from the freellmpool catalog,
// github.com/0xzr/freellmpool): an OpenAI-compatible aggregator of vetted
// FREE models, keyless, 200 requests/hour per IP — capacity INDEPENDENT of
// LLM7's shared anonymous pool. Three routes live-verified from this box:
// strict-JSON tool protocol compliance, clean MSA Arabic, streamed SSE,
// 2-3s per round.
const KILO_URL = "https://api.kilo.ai/api/gateway/v1/chat/completions";

async function kiloRound(
  providerModel: string,
  opts: { messages: { role: "user" | "assistant" | "system"; content: string }[] },
  retry: { budgetLeft: number },
  onDelta?: DeltaFn,
  onStatus?: (note: string) => void,
  onServedModel?: ServedModelFn,
  onThink?: ThinkFn
): Promise<string> {
  // Kilo's free routes are fast (~2-3s live); 75s covers slowest thinking
  // rounds, then the chain hops to the next pool instead of stalling.
  const ROUND_TIMEOUT_MS = 75_000;
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ROUND_TIMEOUT_MS);
    try {
      const res = await fetch(KILO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: providerModel,
          messages: opts.messages,
          stream: true,
        }),
        signal: ctrl.signal,
      });
      if (res.status === 429 || res.status === 402) {
        // the free pool's per-IP quota — fail over INSTANTLY to the next tier
        const bodyText = await res.text().catch(() => "");
        throw new Error(`kilo http ${res.status}: ${bodyText.slice(0, 120)}`);
      }
      if (res.status >= 500) {
        const err = new Error(`kilo http ${res.status}`);
        const wait = RETRY_BACKOFF_MS[attempt];
        if (wait !== undefined && retry.budgetLeft >= wait) {
          retry.budgetLeft -= wait;
          onStatus?.(attempt === 0 ? "keyless pool busy — retrying" : "keyless pool busy — retrying again");
          await sleep(wait);
          continue;
        }
        throw err;
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`kilo http ${res.status}: ${detail.slice(0, 140)}`);
      }
      if (res.body) {
        return await consumeSse(res.body, onDelta, onServedModel, onThink);
      }
      throw new Error("kilo returned no body");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const wait = RETRY_BACKOFF_MS[attempt];
      if (isThrottleError(err) && wait !== undefined && retry.budgetLeft >= wait && !msg.startsWith("kilo http ")) {
        retry.budgetLeft -= wait;
        onStatus?.("keyless pool busy — retrying");
        await sleep(wait);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function llm7Round(
  providerModel: string,
  opts: { messages: { role: "user" | "assistant" | "system"; content: string }[] },
  retry: { budgetLeft: number },
  onDelta?: DeltaFn,
  onStatus?: (note: string) => void,
  onServedModel?: ServedModelFn,
  onThink?: ThinkFn
): Promise<string> {
  // T65 — HARD TIMEOUT per attempt: a hung keyless stream used to hang the
  // whole SSE response forever (no abort anywhere). 95s covers GLM-5.3-Flash's
  // slowest thinking rounds on the shared pool; beyond that the round fails
  // over to the next tier instead of stalling the user's question.
  const ROUND_TIMEOUT_MS = 95_000;
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ROUND_TIMEOUT_MS);
    try {
      const res = await fetch(LLM7_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: providerModel,
          messages: opts.messages,
          stream: true,
        }),
        signal: ctrl.signal,
      });
      if (res.status === 429) {
        // T65 — ANY 429 from the shared anonymous pool fails over INSTANTLY:
        // the pool is saturated and burning the 12s/25s backoffs first (the
        // old behavior) made the whole keyless chain feel dead for minutes
        // under load. The auto-failover re-routes to a DIFFERENT provider
        // (separate capacity) in <1s, with an honest status note.
        const bodyText = await res.text().catch(() => "");
        throw new Error(`llm7 http 429: ${bodyText.slice(0, 120)}`);
      }
      if (res.status >= 500) {
        const err = new Error(`llm7 http ${res.status}`);
        const wait = RETRY_BACKOFF_MS[attempt];
        if (wait !== undefined && retry.budgetLeft >= wait) {
          retry.budgetLeft -= wait;
          onStatus?.(attempt === 0 ? "keyless cloud busy — retrying" : "keyless cloud busy — retrying again");
          await sleep(wait);
          continue;
        }
        throw err;
      }
      if (!res.ok) {
        // model pulled / bad request — surface honestly, no retry helps
        const detail = await res.text().catch(() => "");
        throw new Error(`llm7 http ${res.status}: ${detail.slice(0, 140)}`);
      }
      if (res.body) {
        return await consumeSse(res.body, onDelta, onServedModel, onThink);
      }
      throw new Error("llm7 returned no body");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const wait = RETRY_BACKOFF_MS[attempt];
      if (isThrottleError(err) && wait !== undefined && retry.budgetLeft >= wait && !msg.startsWith("llm7 http 4")) {
        retry.budgetLeft -= wait;
        onStatus?.("keyless cloud busy — retrying");
        await sleep(wait);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** One LLM round with streaming + the same 429 backoff as before. Falls back
 *  gracefully if the gateway ignores stream:true (returns a plain object). */
async function createChatStream(
  zai: Zai,
  opts: { messages: { role: "user" | "assistant"; content: string }[]; thinking: "enabled" | "disabled"; model?: string },
  retry: { budgetLeft: number },
  onDelta?: DeltaFn,
  onStatus?: (note: string) => void,
  onServedModel?: ServedModelFn,
  onThink?: ThinkFn
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await zai.chat.completions.create({
        ...(opts.model ? { model: opts.model } : {}),
        messages: opts.messages,
        thinking: { type: opts.thinking },
        stream: true,
      });
      // the SDK hands back the raw SSE body when the gateway streams
      if (res && typeof (res as { getReader?: unknown }).getReader === "function") {
        return await consumeSse(res as ReadableStream<Uint8Array>, onDelta, onServedModel, onThink);
      }
      // non-streaming shape — still surface the text for the live preview
      const c = res as { choices?: { message?: { content?: string } }[]; model?: unknown };
      if (!attempt && typeof c.model === "string" && c.model.length > 0) onServedModel?.(c.model);
      const text = c.choices?.[0]?.message?.content ?? "";
      if (text) onDelta?.(text);
      return text;
    } catch (err) {
      const wait = RETRY_BACKOFF_MS[attempt];
      if (isThrottleError(err) && wait !== undefined && retry.budgetLeft >= wait) {
        retry.budgetLeft -= wait;
        onStatus?.(attempt === 0 ? "provider busy — retrying" : "provider busy — retrying again");
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
}

type ChatMsg = { role: "user" | "assistant"; content: string };

type AgentStep = { tool: string; args: Record<string, unknown>; ok: boolean };

// ── the agent loop (Task 20: streamed over SSE) ──

const MAX_TOOL_CALLS = 10;

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";

  let body: { messages?: unknown; lang?: unknown; debug?: unknown; deviceId?: unknown; deep?: unknown; model?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const deviceId =
    typeof body.deviceId === "string" && body.deviceId.length >= 8 ? body.deviceId.slice(0, 64) : null;
  // Task 22-b — the composer's "extended thinking" toggle: when ON, even
  // round 0 (tool picking / quick conversational replies) runs with
  // chain-of-thought enabled; the default behavior is unchanged.
  const deep = body.deep === true;

  // T33/T36/T67 — model selection, validated against the registry; an
  // unknown id (incl. stale "puter:" ids from old clients) falls back to
  // the server default instead of erroring, so old clients and
  // hand-crafted requests never break
  const picked: AiModel | null = findAiModel(body.model);
  // T37 — `let`: when a keyless pool is quota-exhausted the loop
  // transparently re-routes to the backbone / the next keyless tier
  // (auto-failover)
  let model: AiModel = picked ?? findAiModel(DEFAULT_AI_MODEL_ID)!;

  // persisted hourly limit (per IP or device) — UsageEvent survives restarts
  if (await overLimit(ip, deviceId)) {
    return NextResponse.json({ error: "rate limited — try again later" }, { status: 429 });
  }

  // validate the conversation the client sends (last 24 turns, last is user)
  const lang = body.lang === "en" ? "en" : "ar";
  const rawMsgs = Array.isArray(body.messages) ? body.messages : [];
  const history: ChatMsg[] = rawMsgs
    .filter(
      (m): m is ChatMsg =>
        m !== null &&
        typeof m === "object" &&
        ((m as ChatMsg).role === "user" || (m as ChatMsg).role === "assistant") &&
        typeof (m as ChatMsg).content === "string" &&
        (m as ChatMsg).content.length > 0 &&
        (m as ChatMsg).content.length <= 8000
    )
    .slice(-24);
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "messages required (last must be user)" }, { status: 400 });
  }

  const msgs: { role: "user" | "assistant"; content: string }[] = [
    { role: "assistant", content: buildAgentSystemPrompt(lang, aiModelIdentity(model)) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];
  const steps: AgentStep[] = [];
  const seenCalls = new Set<string>(); // T36 — duplicate-tool-call guard
  let corrections = 0;
  let failedOver = false; // T37 — llm7 → GLM auto-failover (once per request)
  const debugRaw: string[] = [];
  const debug = body.debug === true;

  // usage metering — one UsageEvent row per request, written on completion
  const t0 = Date.now();
  const usage = { llmCalls: 0, webSearches: 0 };
  const retry = { budgetLeft: RETRY_BUDGET_MS };
  const meter = (ok: boolean) => {
    void db.usageEvent
      .create({
        data: {
          ip,
          deviceId,
          route: "agent",
          llmCalls: usage.llmCalls,
          toolCalls: steps.length,
          webSearches: usage.webSearches,
          ok,
          ms: Date.now() - t0,
        },
      })
      .catch(() => {}); // metering must never break a reply
  };

  // ── SSE response: step / status / delta / done / error events ──
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          closed = true; // client disconnected — keep the loop honest
        }
      };
      // T30 — the model the provider actually served (read from the stream
      // metadata), so the done event stays honest even if a gateway reroutes
      let servedModel = "";
      const noteServedModel: ServedModelFn = (m) => {
        if (!servedModel) servedModel = m;
      };
      // T67 — LIVE THINKING streamer: every reasoning token the serving
      // model emits (GLM-5.3-Flash keyless / direct-cloud GLMs) reaches the
      // client the instant it arrives, and accumulates into the done event
      // so the reasoning trail stays attached to the answer. GLM-4-Plus
      // emits none (pre-thinking generation) — the client then shows the
      // honest work-trace (tool steps + statuses) instead.
      let thinkingAccum = "";
      const emitThink: ThinkFn = (text) => {
        if (thinkingAccum.length < 24_000) thinkingAccum += text;
        send({ type: "think", text });
      };
      const done = (answer: string) => {
        send({
          type: "done",
          answer: sanitizeAgentAnswer(answer),
          steps,
          model: servedModel || model.label,
          modelId: model.id,
          disclaimer: true,
          ...(thinkingAccum ? { thinking: thinkingAccum.slice(0, 24_000) } : {}),
          ...(debug ? { debugRaw } : {}),
        });
        meter(true);
        closed = true;
        try {
          controller.close();
        } catch {}
      };
      const fail = (message: string, status: number, detail?: string) => {
        send({ type: "error", message, status, ...(detail ? { detail } : {}) });
        meter(false);
        closed = true;
        try {
          controller.close();
        } catch {}
      };

      // T50/T56 — outside the sandbox (Vercel…) the z-ai SDK can't authenticate,
      // so the request would die HERE before a single token streams. The
      // backbone is now layered: DIRECT GLM cloud via the server key when
      // ZAI_API_KEY is configured (strong model, works on any host), otherwise
      // the keyless LLM7 cloud (no key, no sign-in) keeps the conversation
      // alive on the weak tier.
      let zai: Zai | null = null;
      try {
        zai = await getZai();
      } catch {
        zai = null;
        if (ZAI_API_KEY) {
          send({
            type: "status",
            note:
              lang === "ar"
                ? "البوابة المحلية غير متاحة — سيتم الرد عبر سحابة GLM المباشرة (نموذج قوي)"
                : "gateway unavailable on this host — answering via the direct GLM cloud (strong model)",
          });
          model = DIRECT_GLM;
          msgs[0] = { role: "assistant", content: buildAgentSystemPrompt(lang, aiModelIdentity(model)) };
        } else {
          send({
            type: "status",
            note:
              lang === "ar"
                ? "البوابة المحلية غير متاحة — سيتم الرد عبر سحابة GLM-5.3-Flash المجانية (بلا تسجيل ولا مفاتيح)"
                : "gateway unavailable on this host — answering via the keyless GLM-5.3-Flash cloud (no key, no sign-in)",
          });
          // T65/T67 — the keyless backbone is now LLM7's anonymous GLM-5.3-Flash
          // tier: a REAL GLM brain (clean MSA Arabic + strict-JSON protocol
          // compliance, probe-verified live), so the public deployment keeps
          // a GLM main even before ZAI_API_KEY is set. The Kilo pool and
          // Pollinations GPT-OSS are the fallback hops.
          model = findAiModel(KEYLESS_MODEL_ID)!;
          msgs[0] = { role: "assistant", content: buildAgentSystemPrompt(lang, aiModelIdentity(model)) };
        }
      }
      // T67 — HOST BACKBONE meta, FIRST event on the wire: tells the client
      // which engine actually serves answers on this host (sdk GLM-4-Plus /
      // direct GLM-4-Plus via key / keyless GLM-5.3-Flash) BEFORE any answer
      // streams, so the "why did GLM-5.3-Flash answer when I picked
      // GLM-4-Plus?" question is answered up front, every time.
      send({
        type: "meta",
        backbone: zai ? "sdk" : ZAI_API_KEY ? "direct" : "keyless",
        engine: zai || ZAI_API_KEY ? "GLM-4-Plus" : "GLM-5.3-Flash",
        needsKey: !zai && !ZAI_API_KEY,
      });

      // T66/T67 — the keyless provider chain (strictly DOWN, no loops): the
      // GLM keyless brain first, then the freellmpool-style KILO POOL (three
      // independent routes with their own 200 req/hr per-IP quota), then
      // GPT-OSS as the final hop. (T67: the old llm7-mistral last hop was
      // pruned — probes showed crash-text Arabic from that tier.)
      const KEYLESS_CHAIN = [KEYLESS_MODEL_ID, ...KEYLESS_POOL_MODEL_IDS, KEYLESS_FALLBACK_MODEL_ID];
      // T56/T59/T65/T67 — the backbone the failovers re-route to: SDK
      // GLM-4-Plus in the sandbox, DIRECT GLM-4-Plus on keyed hosts (the
      // user's pick), keyless GLM-5.3-Flash otherwise; the Kilo pool and
      // Pollinations GPT-OSS are the keyless hops.
      const backboneModel = (): AiModel =>
        zai ? findAiModel(DEFAULT_AI_MODEL_ID)! : ZAI_API_KEY ? DIRECT_GLM : findAiModel(KEYLESS_MODEL_ID)!;
      const keylessFallbackModel = (): AiModel => findAiModel(KEYLESS_FALLBACK_MODEL_ID)!;
      const hasBackbone = () => zai !== null || ZAI_API_KEY.length > 0;
      // T59/T65/T67 — WEAK keyless tiers never stream raw deltas (crash-text
      // guard). The GLM-5.3-Flash keyless tier is a STRONG tier (verified
      // MSA Arabic + protocol compliance) — it streams like a backbone so
      // the answer visibly types in; if it ever fails verification, the
      // final-answer gate still replaces the text before it ships. (T67:
      // only Pollinations remains a weak tier — the broken llm7 models were
      // pruned from the registry.)
      const isWeakKeyless = () => model.provider === "pollinations";
      const isKeyless = () => model.provider === "llm7" || model.provider === "pollinations" || model.provider === "kilo";
      // T36 — the per-provider round runner: z-ai gateway (GLM-4-Plus) or the
      // keyless LLM7.io cloud. Same strict-JSON protocol either way; LLM7
      // gets the system prompt as a proper "system" role (no thinking
      // toggle — the anonymous tier doesn't support one).
      const runRound = (thinking: "enabled" | "disabled", onDelta?: DeltaFn): Promise<string> =>
        model.provider === "pollinations"
          ? pollinationsRound({
              messages: msgs.map((m, i) => (i === 0 ? { role: "system" as const, content: m.content } : m)),
              model: model.providerModel,
              onStatus: (note) => send({ type: "status", note }),
              onServedModel: noteServedModel,
            })
          : model.provider === "kilo"
          ? kiloRound(
              model.providerModel,
              {
                messages: msgs.map((m, i) =>
                  i === 0 ? { role: "system" as const, content: m.content } : m
                ),
              },
              retry,
              onDelta,
              (note) => send({ type: "status", note }),
              noteServedModel,
              emitThink
            )
          : model.provider === "llm7" || (!zai && !ZAI_API_KEY)
          ? llm7Round(
              model.providerModel,
              {
                messages: msgs.map((m, i) =>
                  i === 0 ? { role: "system" as const, content: m.content } : m
                ),
              },
              retry,
              onDelta,
              (note) => send({ type: "status", note }),
              noteServedModel,
              emitThink
            )
          : zai
            ? createChatStream(
                zai,
                { messages: msgs, model: model.providerModel, thinking },
                retry,
                onDelta,
                (note) => send({ type: "status", note }),
                noteServedModel,
                emitThink
              )
            : // T56 — direct GLM cloud (keyed hosts without the SDK gateway):
              // bounded retry chain so a dead direct tier hands the request
              // back to the honest error path instead of hanging the stream.
              zaiChatStream({
                messages: msgs.map((m, i) => (i === 0 ? { role: "system" as const, content: m.content } : m)),
                model: model.providerModel,
                thinking: thinking === "enabled",
                maxRetries: 2,
                onDelta,
                onServedModel: noteServedModel,
                onThink: emitThink,
              });

      const toolJsons: string[] = []; // T38 — raw tool payloads for final-answer verification
      const toolResults: ToolResultRef[] = []; // T58 — structured tool outputs for the deterministic composer
      let verifyRetried = false; // T38 — one repair round max per request
      let langRetried = false; // T58 — one LANGUAGE repair round max per request
      // T38 — the user's own question text: its numbers are trusted
      const userQuestion = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
      try {
        for (let round = 0; round < MAX_TOOL_CALLS + 3; round++) {
          if (steps.length >= MAX_TOOL_CALLS) break;
          let raw = "";
          try {
            // reasoning depth: round 0 (fast JSON tool-picking or a quick
            // conversational reply) runs with thinking off; every later round —
            // i.e. once real tool data is on the table, the synthesis moment —
            // runs with chain-of-thought ON so the final answer is genuine
            // reasoning, not a shallow template. With the composer's
            // extended-thinking toggle ON, round 0 thinks too.
            const deepRound = round > 0 || deep;
            // T58/T65 — never stream raw deltas from WEAK keyless tiers: the
            // weak pool's garbage (Portuguese/Telugu soup) used to flash on
            // screen BEFORE the final answer replaced it. Weak tiers stream
            // status only; the GLM keyless tier streams like the backbone.
            const preview =
              isWeakKeyless() ? undefined : makeFinalPreviewer((text) => send({ type: "delta", text }));
            raw = await runRound(deepRound ? "enabled" : "disabled", preview);
            usage.llmCalls++;
          } catch (err) {
            // T37/T59 — AUTO-FAILOVER: a keyless pool (LLM7's globally shared
            // anonymous quota / Pollinations' shared tier) can be exhausted
            // by total strangers at any moment. Instead of failing the
            // request, the conversation transparently re-routes: to the
            // always-on GLM backbone when one exists (sandbox SDK or the
            // direct key), otherwise down the keyless chain. An honest status note is streamed and the done
            // event reports the model that ACTUALLY served the answer.
            // T65/T67 — the KEYLESS CHAIN: GLM-5.3-Flash → Kilo nemotron →
            // Kilo step → Kilo router → GPT-OSS-20B (each a SEPARATE provider
            // with its own capacity). One busy pool no longer kills the answer — we
            // hop DOWN the chain with an honest note, and only fail after
            // every keyless pool is exhausted (then: the deterministic
            // briefing whenever tool data was already collected).
            if (isKeyless()) {
              const chainIdx = KEYLESS_CHAIN.indexOf(model.id);
              if (chainIdx >= 0 && chainIdx < KEYLESS_CHAIN.length - 1) {
                const next = hasBackbone() ? backboneModel() : findAiModel(KEYLESS_CHAIN[chainIdx + 1])!;
                if (next.id !== model.id) {
                  failedOver = true;
                  send({
                    type: "status",
                    note:
                      lang === "ar"
                        ? "السحابة المجانية مشغولة حاليًا — سيتم الرد تلقائيًا عبر نموذج بديل"
                        : "The free cloud tier is busy right now — answering automatically via a backup model",
                  });
                  model = next;
                  msgs[0] = { role: "assistant", content: buildAgentSystemPrompt(lang, aiModelIdentity(model)) };
                  continue; // retry the SAME round on the next tier
                }
              }
            }
            // every pool exhausted — NEVER waste the data already collected:
            // ship the deterministic briefing when tools ran, else answer
            // honestly instead of a bare error
            if (steps.length > 0) {
              const briefing = composeBriefing(lang, toolResults);
              if (briefing) {
                send({
                  type: "status",
                  note:
                    lang === "ar"
                      ? "جميع المستويات السحابية مشغولة — تم توليد ملخص البيانات مباشرة"
                      : "All cloud tiers are busy — composed the briefing directly from the tool data",
                });
                return void done(briefing);
              }
            }
            const throttled = isThrottleError(err);
            return void fail(
              throttled
                ? lang === "ar"
                  ? "خدمة الذكاء الاصطناعي مشغولة مؤقتًا (ضغط على المزود) — جرّب بعد دقيقة"
                  : "The AI service is briefly busy (provider throttling) — please retry in a minute"
                : "model unavailable",
              throttled ? 503 : 502,
              err instanceof Error ? err.message : "unknown"
            );
          }
          if (debug) debugRaw.push(raw.slice(0, 800));

          const parsed = extractJson(raw);
          if (!parsed || (!("tool" in parsed) && !("final" in parsed))) {
            corrections++;
            if (corrections > 2) break;
            msgs.push({
              role: "user",
              content:
                'Format error. Reply with exactly ONE JSON object, no fences: {"tool": "<name>", "args": {...}} to call a tool, or {"final": "<markdown answer>"} to answer.',
            });
            continue;
          }

          if (typeof parsed.final === "string" && parsed.final.trim().length > 0) {
            // T38 — ANTI-FABRICATION GATE: verify every significant number
            // in the answer against the tool data it was built from, and
            // reject CJK leakage into Arabic/English. One repair round on
            // failure; if a keyless model STILL fabricates, the request
            // quality-falls-back to the GLM-4-Plus backbone (same pattern
            // as the quota failover) so the user never receives invented
            // numbers; the backbone's own failures ship with an honest
            // verification footnote instead.
            // T58 — LANGUAGE GATE: the numbers can be perfectly copied while
            // the answer itself is Portuguese/Spanish/exotic-script soup (the
            // live "crash text"). languageOk() fails it → one repair round →
            // then the deterministic composer takes over so NO wrong-language
            // answer is ever shipped.
            const finalText = parsed.final.trim();
            const verdict = verifyFinalAnswer(finalText, toolJsons, userQuestion);
            const langOk = languageOk(finalText, lang);
            if (!verdict.ok && !verifyRetried) {
              verifyRetried = true;
              msgs.push({ role: "user", content: verificationRepairMessage(verdict, lang) });
              continue; // same conversation, corrected rewrite requested
            }
            if (verdict.ok && !langOk && !langRetried) {
              langRetried = true;
              msgs.push({ role: "user", content: languageRepairMessage(lang) });
              continue; // numbers verified; only the LANGUAGE needs a rewrite
            }
            if (!verdict.ok && isKeyless() && !failedOver && hasBackbone()) {
              failedOver = true;
              send({
                type: "status",
                note:
                  lang === "ar"
                    ? "تعذّر التحقق من أرقام هذا النموذج المجاني — سيتم الرد عبر نموذج GLM القوي لضمان الدقة"
                    : "This free model's numbers could not be verified — answering via the strong GLM backbone for accuracy",
              });
              model = backboneModel();
              msgs[0] = { role: "assistant", content: buildAgentSystemPrompt(lang, aiModelIdentity(model)) };
              verifyRetried = false; // the backbone gets its own repair budget
              continue; // re-answer the SAME conversation on the backbone
            }
            // T58/T59 — LAST GUARD before shipping: a WRONG-LANGUAGE answer is
            // never usable (any model); a failed number verification on a
            // KEYLESS tier is crash-text territory too. In both cases, when
            // real tool data is on the table, ship the deterministic briefing —
            // its numbers are copied verbatim from the tools and its language
            // is templated, so it is correct by construction. With NO tool
            // data (a general knowledge question), a wrong-language answer is
            // STILL never shipped: the honest degrade message replaces it.
            // A STRONG model (zai/direct tier) with only re-formatted numbers
            // keeps the old honest path: rich answer + verification footnote.
            if (!langOk || (!verdict.ok && isKeyless())) {
              const briefing = composeBriefing(lang, toolResults);
              if (briefing) {
                send({
                  type: "status",
                  note:
                    lang === "ar"
                      ? "تعذّر تشكيل رد سليم عبر النموذج المجاني — تم توليد ملخص البيانات مباشرة"
                      : "The free model could not compose a sound answer — composing the briefing directly from the tool data",
                });
                return void done(briefing);
              }
              if (!langOk) {
                // T59 — no tool data + wrong language = unusable raw text.
                // Never ship it; degrade honestly instead.
                return void done(
                  lang === "ar"
                    ? "عذرًا — تعذّر تكوين رد سليم بالعربية عبر النموذج المجاني الآن. أسئلة البيانات (السوق والأسهم والمؤشرات والتدفقات) تعمل كاملة — جرّب واحدة، أو أعد المحاولة بعد قليل."
                    : "Sorry — the free cloud model could not compose a sound answer right now. Data questions (market, quotes, indices, flows) work fully — try one, or retry shortly."
                );
              }
            }
            const shipped = verdict.ok ? finalText : finalText + verificationFootnote(verdict, lang);
            return void done(shipped);
          }

          const toolName = typeof parsed.tool === "string" ? parsed.tool : "";
          const tool = AGENT_TOOLS.find((t) => t.name === toolName);
          if (!tool) {
            msgs.push({
              role: "user",
              content: `Unknown tool "${toolName}". Available tools: ${AGENT_TOOLS.map((t) => t.name).join(", ")}.`,
            });
            continue;
          }

          const args = (parsed.args && typeof parsed.args === "object" ? parsed.args : {}) as Record<string, unknown>;

          // T36 — duplicate-call guard: small keyless models (Mistral Nemo,
          // MiniMax…) sometimes loop calling the SAME tool with the SAME args
          // until the budget dies. One nudge, then the loop forces synthesis.
          const callKey = `${toolName}:${JSON.stringify(args)}`;
          if (seenCalls.has(callKey)) {
            msgs.push({
              role: "user",
              content:
                'You already called this tool with these EXACT arguments and its result is above in the conversation. Do NOT call it again. Reply NOW with your final answer in the format {"final": "<markdown answer>"} using the data you already have.',
            });
            continue;
          }
          seenCalls.add(callKey);

          let result: unknown;
          try {
            result = await tool.run(args);
          } catch (err) {
            result = { error: err instanceof Error ? err.message : "tool failed" };
          }
          const ok = !(result && typeof result === "object" && "error" in (result as Record<string, unknown>));
          steps.push({ tool: toolName, args, ok });
          send({ type: "step", tool: toolName, args, ok });
          if (toolName === "web_search" && ok) usage.webSearches++;

          msgs.push({ role: "user", content: JSON.stringify(result).slice(0, 9000) });
          toolJsons.push(JSON.stringify(result).slice(0, 9000));
          toolResults.push({ tool: toolName, result });
        }

        // loop exhausted without a final answer — NEVER waste the collected
        // data: force one synthesis round from the tool results in context
        if (steps.length > 0) {
          msgs.push({
            role: "user",
            content:
              'Tool budget exhausted. Reply NOW with your final answer using ONLY the tool data collected above — do not request more tools; if a requested stock was not found, say so plainly. Format: {"final": "<markdown answer>"}',
          });
          try {
            // T58/T65 — weak keyless rounds never stream raw deltas (crash-text guard)
            const preview =
              isWeakKeyless() ? undefined : makeFinalPreviewer((text) => send({ type: "delta", text }));
            const raw = await runRound("enabled", preview);
            usage.llmCalls++;
            if (debug) debugRaw.push(raw.slice(0, 800));
            const parsed = extractJson(raw);
            if (parsed && typeof parsed.final === "string" && parsed.final.trim().length > 0) {
              // T38/T58 — the forced-synthesis answer passes the SAME gates;
              // wrong language or weak-tier number failure reroutes to the
              // deterministic briefing, a strong model keeps its footnote.
              const finalText = parsed.final.trim();
              const verdict = verifyFinalAnswer(finalText, toolJsons, userQuestion);
              if (!languageOk(finalText, lang) || (!verdict.ok && isKeyless())) {
                const briefing = composeBriefing(lang, toolResults);
                if (briefing) return void done(briefing);
              }
              return void done(verdict.ok ? finalText : finalText + verificationFootnote(verdict, lang));
            }
          } catch {
            // fall through to the honest fallback below
          }
        }

        // no tools ever ran / synthesis also failed — T58: if real tool data
        // IS on the table, ship the deterministic briefing before the generic
        // "rephrase" message — the data already answers the question.
        const briefing = composeBriefing(lang, toolResults);
        if (briefing) return void done(briefing);
        const fallback =
          lang === "ar"
            ? "وصلتُ لحد الأدوات المتاحة دون إجابة كاملة. جرّب إعادة السؤال بصيغة أبسط (مثال: «ما حالة السوق الآن؟» أو «quote لسهم COMI»)."
            : "I ran out of tool budget without a complete answer. Try rephrasing (e.g. \"market overview\" or \"quote for COMI\").";
        return void done(fallback);
      } catch (err) {
        return void fail("agent loop error", 500, err instanceof Error ? err.message : "unknown");
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
