/** T71 → T74 — the KEYLESS synthesis brain (LLM7.io's anonymous cloud).
 *
 *  GLM-4-Plus was removed ENTIRELY at the user's request (its live thinking
 *  never streamed and answers took a while to end) — and the sandbox
 *  z-ai-web-dev-sdk gateway turned out to serve glm-4-plus for EVERY chat
 *  call. The background shared-compute brains that used to ride that gateway
 *  (AI signals, desk reports, the hermes fallback) now ride THIS keyless tier
 *  instead: a REAL GLM brain, no key, no sign-in, works on every host.
 *
 *  Non-streaming JSON synthesis rounds (stream:false, no thinking flag —
 *  exactly the pattern /api/assistant has served through since T65). The
 *  callers keep their own retry budgets, validation gates and deterministic
 *  fallbacks; this module only moves the text.
 *
 *  T74 FIX — MODEL ROT: LLM7 retired "GLM-5.3-Flash" from its keyless tier
 *  (HTTP 400 model_unavailable, probe-verified 2026-09-29; glm-5.3/glm-5.2
 *  now need a paid key). The brain therefore now runs a MODEL FALLBACK CHAIN
 *  over the currently-keyless turbo models — verified live before being
 *  listed — so a retired upstream model can never again take every scheduled
 *  pipeline (ai-signals, hourly-report, hermes) down silently:
 *    1. GLM-5.3-Flash        (the original — first whenever it returns)
 *    2. DeepSeek-V4-Flash-0731 (turbo, keyless, reasoning + JSON mode)
 *    3. mistral-Nemo-Instruct-2407 (turbo, keyless — verified answering
 *       strict JSON today; kept LAST because T67 found its Arabic weak for
 *       the interactive agent — background rounds have validation gates)
 *  400 invalid/unavailable-model and 401/402 missing-key responses skip to
 *  the next model immediately; 429/5xx keep the backoff-retry-then-next shape. */

const LLM7_URL = "https://api.llm7.io/v1/chat/completions";

export type KeylessMessage = { role: "system" | "user" | "assistant"; content: string };

/** The keyless model chain (see the module header). T74 correction:
 *  mistral-Nemo was REMOVED after the live refresh re-confirmed T67's
 *  crash-text Arabic ("Rodrigue Driving School" soup inside summaryAr —
 *  the language-purity gate rejected the whole run): a model that produces
 *  plausible-looking garbage is WORSE than no model, because it burns a
 *  full pipeline pass. The llm7 reserve below only keeps models whose
 *  failures are loud (400/hang), never quiet garbage. */
const KEYLESS_MODELS = ["GLM-5.3-Flash", "DeepSeek-V4-Flash-0731"] as const;

/** Which model actually served the last successful round (for honest
 *  provenance in the pipelines' run logs). */
let lastServedModel: string | null = null;

export function keylessLastServedModel(): string | null {
  return lastServedModel;
}

async function roundOnce(
  model: string,
  messages: KeylessMessage[],
  timeoutMs: number
): Promise<{ ok: true; text: string } | { ok: false; status: number; body: string; skipModel: boolean }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(LLM7_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: ctrl.signal,
    });
    if (res.ok) {
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = j.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) return { ok: false, status: 200, body: "empty content", skipModel: false };
      return { ok: true, text };
    }
    const body = (await res.text().catch(() => "")).slice(0, 160);
    // 400 model_unavailable / retired model, 401 missing key, 402 payment:
    // THIS model cannot serve a keyless host — skip to the next one now.
    const skipModel = res.status === 400 || res.status === 401 || res.status === 402 || res.status === 404;
    return { ok: false, status: res.status, body, skipModel };
  } catch (err) {
    // timeout / network: transient — do not skip the model
    return { ok: false, status: 0, body: err instanceof Error ? err.message : "network", skipModel: false };
  } finally {
    clearTimeout(timer);
  }
}

/** One keyless chat round, non-streaming, across the model chain.
 *  429/5xx retry per model: up to `retries` times with backoff (10s, 20s);
 *  a hard timeout aborts so a hung request can never stall a pipeline.
 *  The chain ends at the KILO pool (verified live 2026-09-29 — clean MSA
 *  Arabic, strict JSON) so a degraded llm7 can never take the scheduled
 *  pipelines down: the background cadence (~a few rounds/hour) sits far
 *  inside Kilo's 200 req/hr per IP. */
const KILO_URL = "https://api.kilo.ai/api/gateway/v1/chat/completions";
const KILO_ROUTES = ["nvidia/nemotron-3-super-120b-a12b:free", "stepfun/step-3.7-flash:free"] as const;

async function kiloRound(messages: KeylessMessage[], timeoutMs: number): Promise<{ ok: true; text: string } | { ok: false; err: string }> {
  // T74 — collect EVERY route's error (the old last-wins hid which hop
  // actually broke: "stepfun: empty content" told us nothing about nemotron)
  const errs: string[] = [];
  for (const model of KILO_ROUTES) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(KILO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // T74 — 8192, not 4096: the ai-signals synthesis (bias + picks +
        // theses in two languages) ran past 4096 tokens and the truncated
        // JSON arrived unparseable — the refresh burned a whole pass.
        body: JSON.stringify({ model, messages, max_tokens: 8192 }),
        signal: ctrl.signal,
      });
      if (res.ok) {
        const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const text = j.choices?.[0]?.message?.content ?? "";
        if (text.trim()) return { ok: true, text };
        errs.push(`${model}: empty content (http 200)`);
        continue;
      }
      const detail = (await res.text().catch(() => "")).slice(0, 100);
      errs.push(`${model}: http ${res.status}${detail ? ` ${detail}` : ""}`);
    } catch (err) {
      errs.push(`${model}: ${err instanceof Error ? err.message : "network"}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, err: errs.join(" ; ") };
}

export async function keylessBrainChat(
  messages: KeylessMessage[],
  opts: { retries?: number; timeoutMs?: number } = {}
): Promise<string> {
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  // llm7's shared tier can HANG (DeepSeek-V4-Flash stalled 120s at probe
  // time) — cap each llm7 hop well under the pipeline timeout so a stuck
  // upstream can never eat the schedule; the Kilo pool gets the full budget.
  const llm7Timeout = Math.min(timeoutMs, 45_000);
  const waits = [10_000, 20_000];
  const failures: string[] = [];

  // FIRST hop — the Kilo pool (fast, reliable, verified live 2026-09-29;
  // the background cadence sits far inside its 200 req/hr per IP).
  const kilo = await kiloRound(messages, timeoutMs);
  if (kilo.ok) {
    lastServedModel = `kilo:${KILO_ROUTES[0].split("/")[1] ?? "kilo"}`;
    return kilo.text;
  }
  failures.push(`kilo: ${kilo.err}`);

  // reserve — the llm7 keyless models (GLM-5.3-Flash returns instantly with
  // 400 while retired; DeepSeek/mistral answer when their shared pool is up)
  for (const model of KEYLESS_MODELS) {
    for (let attempt = 0; ; attempt++) {
      const r = await roundOnce(model, messages, llm7Timeout);
      if (r.ok) {
        lastServedModel = model;
        return r.text;
      }
      if (r.skipModel) {
        failures.push(`${model}: http ${r.status} ${r.body}`);
        break; // next model in the chain
      }
      if (r.status === 429 || r.status >= 500) {
        if (attempt < retries) {
          await new Promise((res) => setTimeout(res, waits[attempt] ?? 20_000));
          continue;
        }
        failures.push(`${model}: http ${r.status} ${r.body}`);
        break; // exhausted retries on this model → next model
      }
      // other transport-level failure (timeout/network) → next model
      failures.push(`${model}: ${r.body || `http ${r.status}`}`);
      break;
    }
  }
  throw new Error(`keyless brain exhausted the model chain [${failures.join(" | ")}]`);
}
