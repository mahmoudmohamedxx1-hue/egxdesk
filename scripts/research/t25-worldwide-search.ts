/** T25 — fresh worldwide competitive research (2026-09-14).
 *  Runs a battery of targeted web searches, saves each result set to
 *  scripts/research/t25-*.json and prints a compact digest to stdout.
 *  Server-side only (z-ai-web-dev-sdk contract). */
import ZAI from "z-ai-web-dev-sdk";
import { writeFileSync } from "node:fs";

const OUT = "/home/z/my-project/scripts/research";

const QUERIES: { key: string; query: string; num?: number; recency?: number }[] = [
  // ── global leaders: current feature sets & pricing ──
  { key: "tradingview-2026", query: "TradingView plans pricing 2026 Essential Plus Premium features charts indicators alerts", num: 8 },
  { key: "tradingview-ai", query: "TradingView AI features 2026 assistant Pine Script AI", num: 6, recency: 240 },
  { key: "investingpro-2026", query: "Investing.com InvestingPro features pricing 2026 fair value model screener", num: 8 },
  { key: "yahoo-2026", query: "Yahoo Finance premium features 2026 portfolio tracker AI", num: 6, recency: 365 },
  { key: "simplywallst-2026", query: "Simply Wall St features pricing 2026 snowflake fair value dividend", num: 6 },
  { key: "finviz-2026", query: "Finviz Elite features 2026 screener filters charts real-time", num: 6 },
  { key: "koyfin-2026", query: "Koyfin pricing features 2026 dashboards watchlists market data", num: 6 },
  { key: "stockanalysis-2026", query: "stockanalysis.com pro features 2026 financial statements DCF", num: 6 },
  { key: "barchart-marketbeat", query: "Barchart MarketBeat stock research platform features 2026", num: 6 },
  // ── AI-native competitors ──
  { key: "ai-native-tools", query: "AI stock analysis platforms 2026 Danelfin AltIndex Fiscal AI stock screener", num: 8, recency: 365 },
  { key: "ai-chat-finance", query: "AI chatbot stock market assistant app 2026 conversational finance data", num: 8, recency: 240 },
  // ── regional / Egypt-specific ──
  { key: "mubasher-smart-signals", query: "Mubasher Smart Signals Egyptian Exchange EGX app signals research", num: 6 },
  { key: "thndr-egypt", query: "Thndr app Egypt stock market trading features 2026 retail investors EGX", num: 8, recency: 365 },
  { key: "egx-market-2026", query: "EGX30 performance 2026 Egyptian stock market retail investors record", num: 8, recency: 120 },
  { key: "egypt-market-apps", query: "Egypt stock market app EGX data app بورصة مصر تطبيق أسعار الأسهم", num: 8 },
  { key: "argaam-regional", query: "Argaam Mubasher financial portal Arabic market data Egypt coverage", num: 5 },
  // ── category references for gaps ──
  { key: "community-social", query: "StockTwits Reddit social trading community stock platform 2026", num: 5 },
  { key: "paper-trading", query: "paper trading simulator practice portfolio tool 2026 brokers", num: 5 },
  { key: "egx-bonds-etf", query: "EGX bonds treasury bills Egypt ETF ETFX EGX30 mutual funds retail investors 2026", num: 6 },
];

async function main() {
  const zai = await ZAI.create();
  const results: Record<string, unknown[]> = {};
  // modest concurrency: batches of 4
  for (let i = 0; i < QUERIES.length; i += 4) {
    const batch = QUERIES.slice(i, i + 4);
    const settled = await Promise.allSettled(
      batch.map(({ query, num = 6, recency }) =>
        zai.functions.invoke("web_search", recency ? { query, num, recency_days: recency } : { query, num })
      )
    );
    settled.forEach((s, j) => {
      const { key } = batch[j];
      if (s.status === "fulfilled" && Array.isArray(s.value)) {
        results[key] = s.value;
        writeFileSync(`${OUT}/t25-${key}.json`, JSON.stringify(s.value, null, 2));
      } else {
        results[key] = [];
        console.log(`!! ${key} failed: ${s.status === "rejected" ? String(s.reason).slice(0, 120) : "empty"}`);
      }
    });
    console.log(`batch ${i / 4 + 1}/${Math.ceil(QUERIES.length / 4)} done`);
  }
  // digest
  for (const { key, query } of QUERIES) {
    const rs = (results[key] ?? []) as { host_name?: string; name?: string; snippet?: string; date?: string }[];
    console.log(`\n=== ${key} (${rs.length}) :: ${query}`);
    for (const r of rs.slice(0, 5)) {
      console.log(`  [${r.host_name ?? ""}${r.date ? " " + r.date : ""}] ${r.name ?? ""}`.slice(0, 140));
      console.log(`    ${(r.snippet ?? "").replace(/\s+/g, " ").slice(0, 220)}`);
    }
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
