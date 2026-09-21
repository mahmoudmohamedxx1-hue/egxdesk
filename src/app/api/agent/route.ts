import { NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

import { ZAI_API_KEY, zaiChatStream } from "@/lib/zai-client";

type Zai = Awaited<ReturnType<typeof ZAI.create>>;
import { db } from "@/lib/db";
import { findAiModel, DEFAULT_AI_MODEL_ID, aiModelIdentity, type AiModel } from "@/lib/ai-models";
import { AGENT_TOOLS } from "@/lib/agent-core";
import { buildAgentSystemPrompt, extractJson, makeFinalPreviewer, verifyFinalAnswer, verificationRepairMessage, verificationFootnote } from "@/lib/agent-protocol";

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
 *  T33: the model registry now has TWO providers — the server-side z-ai
 *  gateway (GLM-4-Plus, this route) and free Puter cloud models whose loop
 *  runs CLIENT-side in the agent view (tools come back to
 *  POST /api/agent/tools). A puter id sent here (old client / hand-crafted
 *  request) falls back to the server default instead of erroring.
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

/** Consume the gateway's SSE chat stream (data: lines with
 *  choices[0].delta.content chunks), accumulating the full text. The served
 *  model id arrives in the chunk metadata — captured once so the done event
 *  can report the model the provider ACTUALLY used (honest labeling). */
async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onDelta?: DeltaFn,
  onServedModel?: ServedModelFn
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
          choices?: { delta?: { content?: unknown }; message?: { content?: unknown } }[];
          model?: unknown;
        };
        if (!modelSeen && typeof j.model === "string" && j.model.length > 0) {
          modelSeen = true;
          onServedModel?.(j.model);
        }
        const piece = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content;
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
  if (!zaiPromise) zaiPromise = ZAI.create();
  return zaiPromise;
}

// ── T56 — the DIRECT GLM backbone (plain HTTPS, user's ZAI_API_KEY) ──────────
// Outside the sandbox (Vercel, containers…) the z-ai SDK cannot authenticate,
// but the agent must NOT sink to the weak keyless tier when a perfectly good
// strong model is one fetch away. When the key is configured, glm-4.7-flash
// via the direct API becomes the backbone: the tool loop, the verification
// failovers and the final synthesis all run on it, exactly like the GLM-4-Plus
// backbone runs inside the sandbox.
const DIRECT_GLM: AiModel = {
  id: "zai-direct:glm-4.7-flash",
  provider: "zai",
  providerModel: "glm-4.7-flash",
  label: "GLM-4.7-Flash",
  labelAr: "GLM-4.7-Flash",
  note: "Direct Z.AI cloud via the server key — the strong backbone on any host",
  noteAr: "سحابة Z.AI المباشرة عبر مفتاح الخادم — العمود الفقري القوي على أي مستضيف",
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

async function llm7Round(
  providerModel: string,
  opts: { messages: { role: "user" | "assistant" | "system"; content: string }[] },
  retry: { budgetLeft: number },
  onDelta?: DeltaFn,
  onStatus?: (note: string) => void,
  onServedModel?: ServedModelFn
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(LLM7_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: providerModel,
          messages: opts.messages,
          stream: true,
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        // T37 — a DAILY-QUOTA 429 is not transient: the shared anonymous
        // pool is spent and no backoff will revive it inside this request.
        // Throw immediately so the auto-failover re-routes to GLM in <1s
        // instead of burning the 12s/25s backoff budget first.
        if (res.status === 429) {
          const bodyText = await res.text().catch(() => "");
          if (/quota/i.test(bodyText)) throw new Error(`llm7 http 429 quota: ${bodyText.slice(0, 120)}`);
        }
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
        return await consumeSse(res.body, onDelta, onServedModel);
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
  onServedModel?: ServedModelFn
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
        return await consumeSse(res as ReadableStream<Uint8Array>, onDelta, onServedModel);
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

  // T33/T36 — free cloud model selection, validated against the registry; the
  // SERVER loop runs the z-ai provider AND the keyless LLM7.io provider — a
  // puter id (client-side loop) or an unknown id falls back to the server
  // default instead of erroring, so old clients and hand-crafted requests
  // never break
  const picked: AiModel | null = findAiModel(body.model);
  // T37 — `let`: when the keyless LLM7 pool is quota-exhausted the loop
  // transparently re-routes to the always-on GLM backbone (auto-failover)
  let model: AiModel =
    picked && (picked.provider === "zai" || picked.provider === "llm7")
      ? picked
      : findAiModel(DEFAULT_AI_MODEL_ID)!;

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
      const done = (answer: string) => {
        send({
          type: "done",
          answer: sanitizeAgentAnswer(answer),
          steps,
          model: servedModel || model.label,
          modelId: model.id,
          disclaimer: true,
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
                ? "النموذج الخلفي غير متاح على هذا المستضيف — سيتم الرد عبر السحابة المجانية بلا تسجيل"
                : "backbone model unavailable on this host — answering via the keyless free cloud",
          });
          model = findAiModel("llm7:mistral-Nemo-Instruct-2407")!;
          msgs[0] = { role: "assistant", content: buildAgentSystemPrompt(lang, aiModelIdentity(model)) };
        }
      }
      // T56 — the backbone the failovers re-route to: SDK GLM-4-Plus in the
      // sandbox, direct GLM-4.7-Flash on keyed hosts, keyless cloud otherwise.
      const backboneModel = (): AiModel =>
        zai ? findAiModel(DEFAULT_AI_MODEL_ID)! : ZAI_API_KEY ? DIRECT_GLM : findAiModel("llm7:mistral-Nemo-Instruct-2407")!;
      const hasBackbone = () => zai !== null || ZAI_API_KEY.length > 0;
      // T36 — the per-provider round runner: z-ai gateway (GLM-4-Plus) or the
      // keyless LLM7.io cloud. Same strict-JSON protocol either way; LLM7
      // gets the system prompt as a proper "system" role (no thinking
      // toggle — the anonymous tier doesn't support one).
      const runRound = (thinking: "enabled" | "disabled", onDelta?: DeltaFn): Promise<string> =>
        model.provider === "llm7" || (!zai && !ZAI_API_KEY)
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
              noteServedModel
            )
          : zai
            ? createChatStream(
                zai,
                { messages: msgs, model: model.providerModel, thinking },
                retry,
                onDelta,
                (note) => send({ type: "status", note }),
                noteServedModel
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
              });

      const toolJsons: string[] = []; // T38 — raw tool payloads for final-answer verification
      let verifyRetried = false; // T38 — one repair round max per request
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
            const preview = makeFinalPreviewer((text) => send({ type: "delta", text }));
            raw = await runRound(deepRound ? "enabled" : "disabled", preview);
            usage.llmCalls++;
          } catch (err) {
            // T37 — AUTO-FAILOVER: LLM7.io's anonymous tier is one globally
            // shared daily token pool (500k tokens/24h for EVERY anonymous
            // user on the internet), so it can be exhausted by total
            // strangers at any moment. Instead of failing the request, the
            // conversation transparently re-routes to the always-on
            // GLM-4-Plus backbone: an honest status note is streamed, the
            // system prompt is rebuilt with the fallback identity, and the
            // done event reports the model that ACTUALLY served the answer.
            if (model.provider === "llm7" && !failedOver && hasBackbone()) {
              failedOver = true;
              send({
                type: "status",
                note:
                  lang === "ar"
                    ? "حصة السحابة المجانية المشتركة (LLM7) مستنفدة حاليًا — سيتم الرد تلقائيًا عبر نموذج GLM القوي"
                    : "The shared free LLM7 cloud quota is exhausted right now — answering automatically via the strong GLM backbone",
              });
              model = backboneModel();
              msgs[0] = { role: "assistant", content: buildAgentSystemPrompt(lang, aiModelIdentity(model)) };
              continue; // retry the SAME round on the backbone
            }
            // gateway 429s retry with backoff inside createChatStream; if
            // throttling persists, answer honestly instead of a bare error
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
            const finalText = parsed.final.trim();
            const verdict = verifyFinalAnswer(finalText, toolJsons, userQuestion);
            if (!verdict.ok && !verifyRetried) {
              verifyRetried = true;
              msgs.push({ role: "user", content: verificationRepairMessage(verdict, lang) });
              continue; // same conversation, corrected rewrite requested
            }
            if (!verdict.ok && model.provider === "llm7" && !failedOver && hasBackbone()) {
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
            const preview = makeFinalPreviewer((text) => send({ type: "delta", text }));
            const raw = await runRound("enabled", preview);
            usage.llmCalls++;
            if (debug) debugRaw.push(raw.slice(0, 800));
            const parsed = extractJson(raw);
            if (parsed && typeof parsed.final === "string" && parsed.final.trim().length > 0) {
              // T38 — the forced-synthesis answer passes the same gate
              const finalText = parsed.final.trim();
              const verdict = verifyFinalAnswer(finalText, toolJsons, userQuestion);
              return void done(verdict.ok ? finalText : finalText + verificationFootnote(verdict, lang));
            }
          } catch {
            // fall through to the honest fallback below
          }
        }

        // no tools ever ran / synthesis also failed — honest fallback, never invented
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
