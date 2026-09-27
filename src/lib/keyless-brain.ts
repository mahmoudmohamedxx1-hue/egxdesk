/** T71 — the KEYLESS synthesis brain (LLM7.io's anonymous GLM-5.3-Flash).
 *
 *  GLM-4-Plus was removed ENTIRELY at the user's request (its live thinking
 *  never streamed and answers took a while to end) — and the sandbox
 *  z-ai-web-dev-sdk gateway turned out to serve glm-4-plus for EVERY chat
 *  call (probe-verified: the default AND an explicit glm-4.7-flash request
 *  both came back served-model glm-4-plus). The background shared-compute
 *  brains that used to ride that gateway (AI signals, desk reports, the
 *  hermes fallback) now ride THIS keyless tier instead: a REAL GLM brain,
 *  no key, no sign-in, works on every host — the same cloud the interactive
 *  agent and the assistant popup already run on.
 *
 *  Non-streaming JSON synthesis rounds (stream:false, no thinking flag —
 *  exactly the pattern /api/assistant has served through since T65). The
 *  callers keep their own retry budgets, validation gates and deterministic
 *  fallbacks; this module only moves the text. */

const LLM7_URL = "https://api.llm7.io/v1/chat/completions";

export type KeylessMessage = { role: "system" | "user" | "assistant"; content: string };

/** One keyless GLM-5.3-Flash chat round, non-streaming.
 *  429/5xx retry: up to `retries` times with the pool's own suggested
 *  backoff (10s, then 20s); a hard timeout aborts so a hung stream can
 *  never stall a scheduled pipeline. */
export async function keylessBrainChat(
  messages: KeylessMessage[],
  opts: { retries?: number; timeoutMs?: number } = {}
): Promise<string> {
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const waits = [10_000, 20_000];
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(LLM7_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "GLM-5.3-Flash",
          messages,
          stream: false,
        }),
        signal: ctrl.signal,
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, waits[attempt] ?? 20_000));
          continue;
        }
        throw new Error(`keyless brain http ${res.status}`);
      }
      if (!res.ok) {
        throw new Error(`keyless brain http ${res.status}: ${(await res.text().catch(() => "")).slice(0, 140)}`);
      }
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = j.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) throw new Error("keyless brain: empty content");
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}
