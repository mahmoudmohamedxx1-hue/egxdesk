/** T59 — Pollinations.ai KEYLESS cloud tier (GPT-OSS-20B, "openai-fast").
 *
 *  Why this exists: on hosts without the z-ai SDK gateway and without
 *  ZAI_API_KEY (eg. the public Vercel deployment), the agent used to sink to
 *  the LLM7.io anonymous tier, which serves Mistral-Nemo-Instruct-2407 — a
 *  model that answers ARABIC questions in Portuguese/Spanish soup (the
 *  "crash text" / "encrypted text" the user reported). Live probing
 *  (scripts/t59-probe-pollinations.mjs) showed Pollinations' anonymous tier:
 *    - serves GPT-OSS-20B with EXCELLENT Modern Standard Arabic,
 *    - follows the agent's strict {"tool"|"final"} JSON protocol,
 *    - answers real-size agent prompts (system+history) in 6-25s,
 *    - rate-limits CONCURRENT requests (429) — sequential use is fine, and
 *      the shared retry budget + the llm7 failover absorb the bursts.
 *
 *  Non-streaming by design: keyless rounds never stream raw deltas to the
 *  client (the T58 crash-text guard) — the clean answer ships with `done`.
 *
 *  Shared by /api/agent (tool loop + synthesis) and /api/assistant
 *  (plan/answer stages). Dependency-free (plain fetch). */

export const POLLINATIONS_URL = "https://text.pollinations.ai/openai";
export const POLLINATIONS_MODEL_ID = "openai-fast"; // catalog id → serves gpt-oss-20b
/** Anonymous-tier identity: apps that send a referrer get their own token
 *  bucket instead of sharing the whole anonymous pool. */
export const POLLINATIONS_REFERRER = "egxdesk.vercel.app";

export type PollinationsMessage = { role: "system" | "user" | "assistant"; content: string };

export async function pollinationsRound(
  opts: {
    messages: PollinationsMessage[];
    model?: string;
    timeoutMs?: number;
    /** extra attempts on 429/5xx (one built-in backoff retry by default) */
    maxRetries?: number;
    onStatus?: (note: string) => void;
    onServedModel?: (model: string) => void;
  }
): Promise<string> {
  const maxRetries = opts.maxRetries ?? 1;
  const timeoutMs = opts.timeoutMs ?? 75_000;
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(POLLINATIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: opts.model ?? POLLINATIONS_MODEL_ID,
          referrer: POLLINATIONS_REFERRER,
          messages: opts.messages,
          stream: false,
        }),
        signal: ctrl.signal,
      });
      if (res.status === 429 || res.status >= 500) {
        // shared anonymous tier is busy — one short backoff, then surface so
        // the caller's failover chain (llm7 / briefing) takes over fast
        if (attempt < maxRetries) {
          opts.onStatus?.("keyless cloud busy — retrying");
          await new Promise((r) => setTimeout(r, 2500));
          continue;
        }
        const body = await res.text().catch(() => "");
        throw new Error(`pollinations http ${res.status}: ${body.slice(0, 120)}`);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`pollinations http ${res.status}: ${body.slice(0, 140)}`);
      }
      const j = (await res.json()) as {
        choices?: { message?: { content?: unknown } }[];
        model?: unknown;
      };
      if (typeof j.model === "string" && j.model.length > 0) opts.onServedModel?.(j.model);
      const text = j.choices?.[0]?.message?.content;
      // GPT-OSS occasionally emits reasoning-only turns with empty content —
      // treat as a transport failure so the correction/failover logic reruns
      if (typeof text !== "string" || text.trim().length === 0) {
        if (attempt < maxRetries) continue;
        throw new Error("pollinations: empty content");
      }
      return text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries && !msg.startsWith("pollinations http 4")) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
