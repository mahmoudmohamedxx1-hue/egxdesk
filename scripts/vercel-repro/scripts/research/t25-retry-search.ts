/** T25 — retry the rate-limited searches sequentially with backoff. */
import ZAI from "z-ai-web-dev-sdk";
import { writeFileSync, existsSync } from "node:fs";

const OUT = "/home/z/my-project/scripts/research";
const RETRY: { key: string; query: string; num?: number; recency?: number }[] = [
  { key: "tradingview-ai", query: "TradingView AI features 2026 Pine Script AI assistant", num: 6, recency: 240 },
  { key: "yahoo-2026", query: "Yahoo Finance features 2026 portfolio tracker premium AI", num: 6 },
  { key: "simplywallst-2026", query: "Simply Wall St pricing snowflake fair value 2026 review", num: 6 },
  { key: "stockanalysis-2026", query: "StockAnalysis.com pro review 2026 features price", num: 6 },
  { key: "ai-native-tools", query: "Danelfin AltIndex Tickeron AI stock picker review 2026", num: 6 },
  { key: "mubasher-smart-signals", query: "Mubasher Smart Signals EGX Egyptian Exchange app", num: 6 },
  { key: "thndr-egypt", query: "Thndr Egypt investing app users funding EGX trading 2026", num: 8, recency: 365 },
  { key: "egypt-market-apps", query: "best app Egyptian stock market prices EGX بورصة المصرية تطبيق", num: 8 },
  { key: "community-social", query: "StockTwits social investing platform features 2026", num: 5 },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const zai = await ZAI.create();
  for (const { key, query, num = 6, recency } of RETRY) {
    if (existsSync(`${OUT}/t25-${key}.json`)) {
      console.log(`-- ${key} already saved, skip`);
      continue;
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await zai.functions.invoke("web_search", recency ? { query, num, recency_days: recency } : { query, num });
        if (Array.isArray(res)) {
          writeFileSync(`${OUT}/t25-${key}.json`, JSON.stringify(res, null, 2));
          console.log(`== ${key}: ${res.length} results`);
          for (const r of res.slice(0, 4)) {
            const x = r as { host_name?: string; name?: string; snippet?: string; date?: string };
            console.log(`  [${x.host_name ?? ""}${x.date ? " " + x.date : ""}] ${(x.name ?? "").slice(0, 90)}`);
            console.log(`    ${(x.snippet ?? "").replace(/\s+/g, " ").slice(0, 200)}`);
          }
          break;
        }
      } catch (e) {
        console.log(`!! ${key} attempt ${attempt} failed: ${String(e).slice(0, 90)}`);
        await sleep(8000 * attempt);
      }
    }
    await sleep(4000);
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
