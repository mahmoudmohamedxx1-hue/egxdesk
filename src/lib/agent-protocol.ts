/** The AGENT PROTOCOL — shared between the server SSE loop
 *  (/api/agent) and the CLIENT-side Puter loop (agent view, T33).
 *
 *  Client-safe by design: pure string/JSON logic only, zero server imports,
 *  so the agent view can import the SAME system prompt, tool list and
 *  reply-JSON parser the server uses — one protocol, two runtimes:
 *
 *    - server loop: z-ai gateway (GLM-4-Plus) streams over SSE
 *    - client loop: free Puter cloud models (GPT-OSS 20B, GLM-5.3, …)
 *      plan in the browser, tools executed by POST /api/agent/tools
 *
 *  Every model reply is exactly ONE JSON object: {"tool":…,"args":…} to
 *  call a tool, or {"final": "<markdown answer>"} to answer. */

// ── the tool registry's public spec (names + descriptions) ──

export type AgentToolSpec = {
  name: string;
  desc: string;
};

export const AGENT_TOOL_SPECS: AgentToolSpec[] = [
  { name: "market_overview", desc: "Current market state: the 3 EGX indices, breadth (up/down/flat counts), biggest movers, best/worst sectors and a one-line narrative." },
  { name: "top_movers", desc: "Ranked lists: kind = gainers | losers | active (by traded value). arg: { kind, limit<=15 }." },
  { name: "quote", desc: "Full live quote + fundamentals for ONE stock. arg: { ticker } (EGX ticker like COMI, HDBK, TMGH, ABUK)." },
  { name: "screen", desc: "Rank the whole universe by a metric. metrics: pe | pb | divYield | roe | marketCap | changePct | perfYTD | perfY | volume | revenueTTM | netMarginTTM. arg: { metric, direction: top|bottom, limit<=15 }." },
  { name: "technicals", desc: "13-indicator technical rating (SMA/EMA/RSI/Stoch/MACD/CCI/Momentum/WilliamsR/BBPower, 1Y daily candles) for ONE stock. arg: { ticker }." },
  { name: "best_signals", desc: "The Signals tab scan: strongest bullish (or bearish) composite ratings across ALL stocks (technical + fundamental + news pillars). arg: { direction: top|bottom, limit<=10 }." },
  { name: "statements", desc: "Financial statements history for ONE stock (annual + quarterly income statement, balance sheet and cash flow, EGP millions). arg: { ticker }." },
  { name: "dividends", desc: "Cash dividend history for ONE stock: ex/record/pay dates and EGP per share. arg: { ticker }." },
  { name: "news", desc: "EGX news. feed = ar (Arabic archive, default) | en (English feed). Optional arg: { ticker } filters to one company; { limit<=10 }." },
  { name: "calendar", desc: "Upcoming EGX events (earnings, dividends, assemblies, rights issues) for the next N days (default 14, max 60). arg: { days }." },
  { name: "rates", desc: "Egypt interest rates: CBE policy rate, overnight lending, interbank + the next scheduled CBE decision date." },
  { name: "insiders", desc: "Insider & treasury-share dealing log (official EGX filings). Optional arg: { ticker }; { limit<=10 }." },
  { name: "compare", desc: "Side-by-side key metrics for 2-4 stocks in ONE call — pass ALL tickers together, never one per call. arg: { tickers: [\"COMI\",\"HDBK\"] }." },
  { name: "web_search", desc: "Search the LIVE WEB for current events and context beyond our EGX data layer — Egypt macro/economy news, IMF & ratings, CBE decisions, global markets, oil/gold, company announcements. arg: { query, num?<=8 (default 5), recency_days?<=90 }." },
  { name: "ai_signals", desc: "The AI Signals section's current shared signal set (back-tested trend strategy + GLM synthesis, refreshed ~every 45 minutes): the strategy's market read plus trade ideas with entry/stop/target and evidence. No args — read-only, may be slightly older than live quotes." },
  { name: "desk_reports", desc: "The Desk Reports section's latest shared market report (hourly while the market is open, end-of-day after the close): the desk's market read plus surge candidates with evidence-backed reasons, attributed web catalysts and ATR levels. No args — read-only, shared compute." },
];

export const AGENT_TOOL_LIST = AGENT_TOOL_SPECS.map((t) => `- ${t.name}: ${t.desc}`).join("\n");

export const AGENT_TOOL_NAMES = AGENT_TOOL_SPECS.map((t) => t.name);

// ── the system prompt (identical text on both runtimes) ──

/** The agent's system prompt. `identity` is the honest one-line model
 *  identity, e.g. "a REAL large language model (GLM-4-Plus, by Z.ai)" or
 *  "a REAL large language model (GPT-OSS 20B — open-weights OpenAI model
 *  via the free Puter cloud)". */
export function buildAgentSystemPrompt(lang: "ar" | "en", identity: string): string {
  return `You are EGX Desk Agent — ${identity} running inside the EGX Desk web app, acting as a bilingual (Arabic-first) Egyptian Exchange (EGX) market analyst. You are not a script or a keyword bot: you reason over evidence and write your own analysis. Every market number you state comes from tools that return real delayed (~15 min) data.

TOOLS (call at most one per reply, as strict JSON):
${AGENT_TOOL_LIST}

REPLY PROTOCOL — your every reply MUST be exactly ONE JSON object and nothing else (no markdown fences, no commentary):
1. To call a tool: {"tool": "<name>", "args": { ... }}
2. To give your final answer (only once you have enough real data): {"final": "<markdown answer>"}

RULES:
- Answer language: ${lang === "ar" ? "Arabic (clear Egyptian-friendly MSA)" : "English"}. If the user writes in the other language, switch to theirs.
- NEVER invent or estimate market numbers. Every EGX figure in your final answer must come from our data tools; every web fact must come from web_search results. If data is missing, say so plainly.
- NUMBERS ARE EXACT: when a tool result contains a price/percentage/value, COPY it character-for-character into your answer (e.g. last 133.32 → write 133.32). Never round, recompute or replace tool numbers from memory.
- EGX tickers look like COMI, HDBK, TMGH, ABUK, ETEL, SWDY, EFIH. If unsure of a ticker, use screen/top_movers or state the ambiguity.
- Call tools to fetch facts BEFORE answering market questions; 2-5 calls is typical; hard cap 10.
- ANSWER LENGTH — NO CAP: answer as fully as the question deserves. A quick quote can be 2-3 lines, but comparisons, market reads, strategy, macro and research questions deserve COMPLETE, well-structured essays (commonly 400-1500+ words): a direct answer first, then structured sections with headers or bullets, tables when comparing, concrete numbers, tickers and dates. Never cut an answer short to stay brief — finish every argument you start.
- PRESENTATION (your markdown is rendered as a rich analyst report — write for it):
  * Open every substantive answer with a bolded bottom line: **الخلاصة: …** / **Bottom line: …** — one or two sentences with the verdict and the key numbers.
  * Then organized sections with ### headers (2-4 words each); use headers whenever the answer has 2+ distinct parts.
  * ALWAYS use markdown tables when comparing stocks or listing multiple metrics or price levels — header row bolded, one row per stock/item, columns like المؤشر | COMI | HDBK or السهم | السعر | التغير | P/E. Keep tables narrow (max ~5 columns). Write the table headers in the SAME language as the answer (Arabic headers for Arabic answers, English headers for English answers).
  * Bold the key figures inline with their units (e.g. **٥.٨٥×** / **5.85×**, **+12.4%**) so they pop for scanning readers.
  * Bullets for 3+ parallel facts; a short quote or call-out in > blockquote when citing a source's wording.
  * End long analyses with a one-paragraph closing takeaway (vary its phrasing — never the same closing formula).
- WEB SEARCH: for anything beyond our live EGX data layer (Egypt macro news, IMF/World Bank/ratings agencies, CBE decisions, global markets, oil/gold/FX, company announcements, general knowledge you are unsure about), call web_search — ideally BEFORE answering, and combine it with our EGX tools for market questions. ALWAYS attribute web facts to their source by name (e.g. "وفق رويترز" / "per Reuters") and include the article date when relevant. Never present web-sourced numbers as EGX live quotes — EGX prices/valuations come ONLY from our data tools.
- Final answers are YOUR analysis in a natural analyst voice: vary the structure, never end every answer with the same closing formula. Mention the ~15-min delay only when you interpret live market moves.
- General finance and investing-concept questions (what P/E means, how a rights issue works, what drives the EGP) may be answered directly from your own knowledge or web_search — just keep concept explanations clearly separate from live EGX data.
- Identity questions ("are you a real AI?", "what model are you?"): answer plainly and honestly — you are a real LLM (${identity}) with live EGX data tools AND live web search. Mention that you reason and can be verified by asking anything.
- For questions entirely outside finance or about personal financial advice, politely decline and redirect to what you can do.`;
}

// ── shared arg cleaners ──

export function cleanTicker(raw: unknown): string {
  return typeof raw === "string" ? raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) : "";
}

export function clampLimit(raw: unknown, max: number, dflt: number): number {
  const n = typeof raw === "number" ? Math.floor(raw) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return dflt;
  return Math.min(n, max);
}

// ── the reply-JSON parser (identical semantics on both runtimes) ──

/** First balanced JSON object in the model output (handles ```json fences),
 *  with two repair passes for common LLM quirks: control characters (raw
 *  newlines) inside string literals, and replies truncated mid-string (no
 *  closing brace) — the tail is then recovered with a regex. */
export function tryParse(s: string): Record<string, unknown> | null {
  try {
    const p = JSON.parse(s);
    return p && typeof p === "object" ? (p as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Escape raw \n \r \t that appear INSIDE string literals (invalid JSON that
 *  models sometimes emit); whitespace outside strings is left alone. */
export function repairControlChars(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (esc) {
      out += ch;
      esc = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      out += ch;
      continue;
    }
    if (inStr && (ch === "\n" || ch === "\r" || ch === "\t")) {
      out += "\\n";
      continue;
    }
    out += ch;
  }
  return out;
}

/** Extract every balanced top-level {...} span in order (used by extractJson
 *  so reasoning prose around the reply object is ignored). */
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
    if (!closed) return; // truncated from here on — stop
  }
}

export function extractJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let s = raw.trim();
  // thinking-enabled models sometimes inline chain-of-thought — strip it first
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // 1) scan every balanced object; the FIRST one that follows the reply
  //    protocol (has "tool" or "final") wins — prose or examples before it
  //    are ignored. A parsed non-protocol object is kept as a last resort so
  //    the caller can issue a format correction (original behavior).
  let firstParsed: Record<string, unknown> | null = null;
  for (const span of topLevelJsonObjects(s)) {
    const p = tryParse(span) ?? tryParse(repairControlChars(span));
    if (!p) continue;
    if (firstParsed === null) firstParsed = p;
    if ("tool" in p || "final" in p) return p;
  }
  if (firstParsed) return firstParsed;

  // 2) truncated reply (no closing brace): recover {"final": "… from the tail
  const mFinal = s.match(/"final"\s*:\s*"([\s\S]*)/);
  if (mFinal) {
    const tail = mFinal[1].replace(/"\s*\}?\s*$/, "").trim();
    if (tail.length > 0) return { final: tail };
  }

  // 3) a tool call that survived truncation: {"tool": "name"…
  const mTool = s.match(/"tool"\s*:\s*"([A-Za-z_][A-Za-z0-9_]*)"/);
  if (mTool) {
    const mArgs = s.match(/"args"\s*:\s*(\{[\s\S]*?)[}]?\s*$/);
    let args: Record<string, unknown> = {};
    if (mArgs) {
      const repaired = repairControlChars(`${mArgs[1]}}`);
      const parsed = tryParse(repaired);
      if (parsed) args = parsed;
    }
    return { tool: mTool[1], args };
  }
  return null;
}

// ── live-preview decoding (the {"final": " streaming preview) ──

/** Decode the escaped JSON string body of raw (stops at the closing quote or
 *  an incomplete escape at the buffer tail). */
export function decodeJsonStringPrefix(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "\\") {
      const n = raw[i + 1];
      if (n === undefined) return out; // incomplete escape — wait for more
      if (n === "n") { out += "\n"; i++; continue; }
      if (n === "t") { out += "\t"; i++; continue; }
      if (n === "r") { out += "\r"; i++; continue; }
      if (n === "b") { out += "\b"; i++; continue; }
      if (n === "f") { out += "\f"; i++; continue; }
      if (n === '"') { out += '"'; i++; continue; }
      if (n === "\\") { out += "\\"; i++; continue; }
      if (n === "/") { out += "/"; i++; continue; }
      if (n === "u") {
        const hex = raw.slice(i + 2, i + 6);
        if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) return out;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 5;
        continue;
      }
      out += n;
      i++;
      continue;
    }
    if (c === '"') return out; // closing quote — the final string ends here
    out += c;
  }
  return out;
}

/** Live-preview extractor: watches the raw stream text and, once the
 *  `{"final": "` opening quote appears, streams the decoded answer body out
 *  as delta events. Tool-call rounds never contain `"final":`, so they never
 *  preview; thinking prose is skipped too. The authoritative answer is still
 *  the parsed `done` event — the preview is cosmetic and transient. */
export function makeFinalPreviewer(onDelta: (s: string) => void) {
  let acc = "";
  let locked: number | null = null;
  let sent = 0;
  return (chunk: string) => {
    acc += chunk;
    if (acc.length > 300_000) return; // pathological stream — stop tracking
    if (locked === null) {
      const m = acc.match(/"\s*final\s*"\s*:\s*"/);
      if (!m || m.index === undefined) return;
      locked = m.index + m[0].length;
    }
    const decoded = decodeJsonStringPrefix(acc.slice(locked));
    if (decoded.length > sent) {
      onDelta(decoded.slice(sent));
      sent = decoded.length;
    }
  };
}
