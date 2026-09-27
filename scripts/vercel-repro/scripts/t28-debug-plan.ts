/** Debug: what does GLM actually return for the assistant plan prompt? */
import ZAI from "z-ai-web-dev-sdk";

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
  "alert_list: {} · alert_delete: {id}",
  "paper_buy: {ticker, qty} · paper_sell: {ticker, qty} — simulated EGP trades at live price",
  "paper_portfolio: {} — positions + P&L",
  'set_language: {"lang":"ar|en"} · set_theme: {"theme":"dark|light"}',
].join("\n");

const sys = [
  "You are the PLANNER of the EGX Desk web assistant (Egyptian Exchange market app). You control the website: the user asks, you pick ONE next action.",
  "App state: view=home, language=en.",
  "",
  "Respond ONLY with compact JSON on a single line — NO markdown, NO code fences, NO explanation:",
  '{"tool":"<name>","args":{...}}   → to run a tool (args may be {})',
  '{"reply":"<text>"}              → only for general questions no tool can answer',
  "",
  "TOOLS:",
  TOOLS_SPEC,
  "",
  "Rules:",
  "- Navigation/control requests (open, show, buy, alert, watch, theme, language) → the matching tool. Assume imperative intent.",
  "- Market data questions → the data tool; the final answer is composed AFTER execution.",
  "- Ambiguous ticker names → use search first.",
  "- Ask a clarifying question via {\"reply\": ...} only when truly impossible to guess.",
  "- Output MUST be valid JSON, nothing else.",
].join("\n");

async function main() {
  const client = await ZAI.create();
  const res = await client.chat.completions.create({
    messages: [
      { role: "system", content: sys },
      { role: "user", content: "add Eastern Tobacco to my watchlist" },
    ],
    thinking: { type: "disabled" },
  });
  const c = res as { choices?: { message?: { content?: string } }[] };
  console.log("=== RAW OUTPUT ===");
  console.log(JSON.stringify(c.choices?.[0]?.message?.content));
  console.log("=== FINISH ===");
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
