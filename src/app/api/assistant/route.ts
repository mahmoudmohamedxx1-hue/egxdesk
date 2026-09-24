import { NextRequest, NextResponse } from "next/server";
import { zaiChat } from "@/lib/zai-client";
import { pollinationsRound } from "@/lib/pollinations";
// T58 — the answer stage gets the same crash-text guard as the agent: the
// keyless tier answers Arabic questions in the wrong language, so a failed
// languageOk() reroutes to the deterministic briefing composer.
import { composeBriefing, languageOk } from "@/lib/briefing-composer";

/** POST /api/assistant — the CLOUD brain of the AI assistant popup
 *  (the "EGX Desk Cloud" model option). Two stages, both stateless:
 *
 *  1. stage "plan": given the chat history + live app context, the model
 *     decides ONE next action and answers with STRICT JSON —
 *     {"tool":"...","args":{...}} or {"reply":"..."} — which the CLIENT then
 *     executes against the website (navigation, watchlist, alerts, paper
 *     trades, data fetches all run in the browser where the app lives).
 *  2. stage "answer": after the client executed the tool, the model writes
 *     the final bilingual markdown answer from the REAL tool result.
 *
 *  T50 — the brain now goes through the app's OWN Z.AI key
 *  (src/lib/zai-client.ts — glm-4.7-flash, plain HTTPS) instead of the
 *  sandbox-only SDK, so the assistant works identically on the preview
 *  server AND on any external host (Vercel…). The key stays server-side;
 *  free Puter cloud models still run client-side and never touch this
 *  endpoint. The tool list mirrors the client registry in
 *  src/lib/assistant-tools.ts (kept in sync by hand — it is a prompt
 *  constant, not shared code, so the client lib never loads here). */

export const runtime = "nodejs";

// light endpoint, generous limit: 240 calls/hour per IP (plan+answer pairs)
const RATE_LIMIT = 240;
const rateMap = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
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
    for (const [k, v] of rateMap) if (v.every((t) => now - t >= window)) rateMap.delete(k);
  }
  return false;
}

// ── the brain: FOUR layered providers, whichever answers first wins ──
//  T50: the popup must stay snappy on EVERY host, including during the free
//  tier's 1305 overload windows (which can run minutes):
//   1. direct Z.AI chat (glm-4.7-flash via the app's own key) — works on
//      ANY host (sandbox, Vercel, anywhere); ONE throttle backoff max so an
//      overload window fails over fast instead of hanging the popup.
//   2. the sandbox SDK's GLM-4-Plus — instant when available, throws
//      immediately outside the sandbox.
//   3. Pollinations keyless cloud (GPT-OSS-20B) — no key, no sign-in; T59:
//      excellent Modern Standard Arabic (the llm7 mistral tier answered
//      Arabic questions in Portuguese soup — the "crash text").
//   4. LLM7.io keyless cloud (Mistral Nemo) — no key, no sign-in; last
//      resort when Pollinations' shared tier is busy.
//  All four fail honestly → the client shows its generic error card.

const WHY = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 140);

// 1 — direct Z.AI key
async function zaiDirectRound(messages: { role: "system" | "user" | "assistant"; content: string }[]): Promise<string> {
  const r = await zaiChat({
    messages,
    // planning/answering is mechanical JSON work — thinking off keeps
    // the popup snappy (the autonomous agent keeps thinking ON)
    thinking: false,
    temperature: 0.4,
    maxRetries: 1,
  });
  if (!r.content.trim()) throw new Error("zai: empty content");
  return r.content;
}

// 2 — the sandbox SDK (GLM-4-Plus). Lazy import + lazy singleton: outside
// the sandbox ZAI.create() rejects almost instantly and we move on.
let sdkPromise: Promise<Awaited<ReturnType<typeof import("z-ai-web-dev-sdk").default.create>>> | null = null;
async function sdkRound(messages: { role: "system" | "user" | "assistant"; content: string }[]): Promise<string> {
  const ZAI = (await import("z-ai-web-dev-sdk")).default;
  if (!sdkPromise) sdkPromise = ZAI.create();
  const client = await sdkPromise;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await client.chat.completions.create({ messages, thinking: { type: "disabled" } });
      const c = res as { choices?: { message?: { content?: string } }[] };
      const text = c.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) throw new Error("sdk: empty content");
      return text;
    } catch (err) {
      const e = err as { status?: number; message?: string };
      if (attempt < 1 && (e?.status === 429 || /rate|throttle|429/i.test(String(e?.message ?? "")))) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw err;
    }
  }
}

// 3 — keyless LLM7.io (shared anonymous tier; the same cloud the agent view
// offers as "no sign-in" models). Non-streaming is fine for JSON rounds.
const LLM7_URL = "https://api.llm7.io/v1/chat/completions";
async function llm7Round(messages: { role: "system" | "user" | "assistant"; content: string }[]): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45_000);
    try {
      const res = await fetch(LLM7_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "mistral-Nemo-Instruct-2407", messages, stream: false }),
        signal: ctrl.signal,
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt < 1) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        throw new Error(`llm7 http ${res.status}`);
      }
      if (!res.ok) throw new Error(`llm7 http ${res.status}: ${(await res.text().catch(() => "")).slice(0, 120)}`);
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = j.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) throw new Error("llm7: empty content");
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}

// 3 — keyless Pollinations (GPT-OSS-20B, strong Arabic; T59). JSON/plain
// rounds, non-streaming is fine.
async function pollinationsTier(messages: { role: "system" | "user" | "assistant"; content: string }[]): Promise<string> {
  return await pollinationsRound({ messages, timeoutMs: 45_000 });
}

async function createChat(messages: { role: "system" | "user" | "assistant"; content: string }[]): Promise<string> {
  try {
    return await zaiDirectRound(messages);
  } catch (err) {
    console.warn("[assistant] direct zai tier unavailable:", WHY(err));
  }
  try {
    return await sdkRound(messages);
  } catch (err) {
    console.warn("[assistant] sdk tier unavailable:", WHY(err));
  }
  try {
    return await pollinationsTier(messages);
  } catch (err) {
    console.warn("[assistant] pollinations tier unavailable:", WHY(err));
  }
  return await llm7Round(messages);
}

/** Tolerant JSON extraction — mirrors the client parser (fences, thinking
 *  tags, surrounding prose all tolerated; first balanced object wins) plus
 *  envelope normalization: models emit {"tool":..,"args":..}, {"tool":..,
 *  <inline args>}, {"<tool>":{..}} (tool-as-key), {"<tool>":"value"} and
 *  {"action":..} — all normalize to the canonical {tool, args}|{reply}. */
function extractJson(out: string): { tool?: string; args?: Record<string, unknown>; reply?: string } | null {
  let s = String(out ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return normalizeAction(JSON.parse(s.slice(start, i + 1)));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const PRIMARY_ARG: Record<string, string> = {
  open_view: "view", open_ticker: "ticker", quote: "ticker", search: "q",
  news: "q", watch_add: "ticker", watch_remove: "ticker", paper_buy: "ticker",
  paper_sell: "ticker", alert_create: "ticker", alert_delete: "ticker",
  set_language: "lang", set_theme: "theme",
};

function normalizeAction(obj: unknown): { tool?: string; args?: Record<string, unknown>; reply?: string } | null {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const toolRaw = typeof o.tool === "string" ? o.tool : typeof o.action === "string" ? o.action : null;
  if (toolRaw) {
    const tool = toolRaw.trim();
    const argsObj = o.args && typeof o.args === "object" && !Array.isArray(o.args) ? (o.args as Record<string, unknown>) : null;
    const inline: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (k !== "tool" && k !== "action" && k !== "args" && k !== "reply") inline[k] = v;
    }
    const args = argsObj ?? inline;
    return { tool, args: Object.keys(args).length ? args : {} };
  }
  const keys = Object.keys(o).filter((k) => k !== "reply");
  if (keys.length === 1 && KNOWN_TOOLS.has(keys[0])) {
    const v = o[keys[0]];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return { tool: keys[0], args: v as Record<string, unknown> };
    }
    const sv = String(v);
    const prim = PRIMARY_ARG[keys[0]];
    const args: Record<string, string> = { q: sv, ticker: sv, name: sv };
    if (prim) args[prim] = sv;
    return { tool: keys[0], args };
  }
  if (typeof o.reply === "string") return { reply: o.reply };
  return null;
}

const TOOLS_SPEC = [
  'open_view: {"view":"home|market|screener|sectors|heat|activity|investors|calendar|funds|compare|gcc|lab|reports|watchlist|paper|tools|news|signals"}',
  'open_ticker: {"ticker":"COMI","panel":"overview|chart|technicals|news|financials|insiders"} — open a stock page',
  "quote: {ticker} — live delayed price",
  "search: {q} — find tickers by English/Arabic name",
  "movers: {} — top gainers & losers",
  "market_overview: {} — EGX indices & breadth",
  "technicals: {ticker} — RSI/MACD/MA20/MA50/volume ratio",
  "news: {q?} — latest news headlines",
  "gcc: {} — Tadawul/DFM/ADX index snapshot",
  "watch_add: {ticker} · watch_remove: {ticker} · watch_list: {}",
  'alert_create: {"ticker":"COMI","conditions":[{"kind":"priceAbove|priceBelow|chgAbove|chgBelow|rsiAbove|rsiBelow|macdAbove|macdBelow|maCrossUp|maCrossDown|volRatioAbove","value":90}]}',
  "alert_list: {} · alert_delete: {id or ticker}",
  "paper_buy: {ticker, qty} · paper_sell: {ticker, qty} — simulated EGP trades at the live price",
  "paper_portfolio: {} — positions + P&L",
  'set_language: {"lang":"ar|en"} · set_theme: {"theme":"dark|light"}',
].join("\n");

const KNOWN_TOOLS = new Set([
  "open_view", "open_ticker", "quote", "search", "movers", "market_overview",
  "technicals", "news", "gcc", "watch_add", "watch_remove", "watch_list",
  "alert_create", "alert_list", "alert_delete", "paper_buy", "paper_sell",
  "paper_portfolio", "set_language", "set_theme",
]);

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  let body: {
    stage?: string;
    lang?: string;
    context?: { view?: string; ticker?: string };
    messages?: { role?: string; content?: string }[];
    question?: string;
    tool?: string;
    args?: Record<string, unknown>;
    result?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  const lang = body.lang === "en" ? "en" : "ar";
  const view = String(body.context?.view ?? "home");
  const ticker = String(body.context?.ticker ?? "");
  const marketNow = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

  try {
    if (body.stage === "answer") {
      const question = String(body.question ?? "").slice(0, 2000);
      const tool = String(body.tool ?? "");
      const args = body.args ?? {};
      const result = body.result ?? null;
      const sys = [
        `You are the EGX Desk assistant (Egyptian Exchange market app). A tool just executed in the user's browser.`,
        `Tool: ${tool}`,
        `Args: ${JSON.stringify(args).slice(0, 800)}`,
        `Result (real delayed market data — the ONLY numbers you may use): ${JSON.stringify(result).slice(0, 4000)}`,
        `User question: ${question}`,
        `Write the final answer in ${lang === "ar" ? "Arabic" : "English"}: concise plain markdown (2-6 lines), only real numbers from the result, never invented data. For navigation actions, confirm briefly what you did. No JSON.`,
        lang === "ar"
          ? `LANGUAGE RULE (critical): the ENTIRE answer must be written in Arabic script — real Arabic words and sentences. Answering in Portuguese, Spanish, French or English prose is a rejected defect. Only tickers (COMI) and standard abbreviations (P/E) stay Latin.`
          : `LANGUAGE RULE (critical): the entire answer must be in English prose.`,
      ].join("\n");
      let reply = "";
      try {
        reply = await createChat([
          { role: "system", content: sys },
          // the gateway rejects a messages array with no user turn — the
          // question rides along as the user message
          { role: "user", content: question || "Compose the final answer." },
        ]);
      } catch {
        reply = "";
      }
      // T58 — crash-text guard: a wrong-language reply (the keyless tier's
      // failure mode) never ships. Fall back to the deterministic briefing
      // composed straight from the tool result — same data, clean language.
      if (!reply.trim() || !languageOk(reply, lang)) {
        const briefing = composeBriefing(lang, [{ tool, result }]);
        if (briefing) return NextResponse.json({ reply: briefing });
        if (!reply.trim()) return NextResponse.json({ error: "empty answer" }, { status: 502 });
      }
      return NextResponse.json({ reply });
    }

    // default: plan stage
    const history = (body.messages ?? [])
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-8)
      .map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content).slice(0, 1500) }));

    if (!history.length) return NextResponse.json({ error: "no messages" }, { status: 400 });

    const sys = [
      `You are the PLANNER of the EGX Desk web assistant (Egyptian Exchange market app). You control the website: the user asks, you pick ONE next action.`,
      `App state: view=${view}${ticker ? `, ticker=${ticker}` : ""}, language=${lang}, time=${marketNow}.`,
      ``,
      `Respond ONLY with compact JSON on a single line — NO markdown, NO code fences, NO explanation:`,
      `{"tool":"<name>","args":{...}}   → to run a tool (args may be {})`,
      `{"reply":"<text>"}              → only for general questions no tool can answer`,
      ``,
      `TOOLS:`,
      TOOLS_SPEC,
      ``,
      `Rules:`,
      `- Navigation/control requests (open, show, buy, alert, watch, theme, language) → the matching tool. Assume imperative intent.`,
      `- Ticker/name fields accept full company names (e.g. {"ticker":"Eastern Tobacco"}) — never emit a separate search step for an imperative action.`,
      `- Market data questions → the data tool; the final answer is composed AFTER execution.`,
      `- Use search only when the user asks to find/list companies.`,
      `- Ask a clarifying question via {"reply": ...} only when truly impossible to guess.`,
      `- Output MUST be valid JSON, nothing else.`,
    ].join("\n");

    let out = await createChat([{ role: "system", content: sys }, ...history]);
    let parsed = extractJson(out);
    if (!parsed) {
      // one repair round — small chance the model wrapped the JSON in prose
      out = await createChat([
        { role: "system", content: sys },
        ...history,
        { role: "assistant", content: out.slice(0, 800) },
        { role: "user", content: "That was not valid JSON. Respond again with ONLY the JSON object." },
      ]);
      parsed = extractJson(out);
    }
    if (!parsed) return NextResponse.json({ reply: "", error: "unparseable" }, { status: 200 });

    if (parsed.tool && KNOWN_TOOLS.has(parsed.tool)) {
      return NextResponse.json({ tool: parsed.tool, args: parsed.args ?? {} });
    }
    if (parsed.reply && parsed.reply.trim()) return NextResponse.json({ reply: parsed.reply.trim() });
    return NextResponse.json({ error: "no action" }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "assistant unavailable";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
