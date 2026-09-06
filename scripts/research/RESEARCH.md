# Deep Research: Getting Real EGX Investor-Category Flows

*Research conducted 2026-09-06/07 · network probing from this server (Cairo-time market clock)*

## What the dataset is

The Egyptian Exchange classifies every trade by **investor category** — a 3 × 2 grid:

|                | Retail (individuals) | Institutions |
|----------------|----------------------|--------------|
| **Egyptians**  | EGY_RETAIL           | EGY_INST     |
| **Arabs**      | ARAB_RETAIL          | ARAB_INST    |
| **Foreigners** | FOR_RETAIL           | FOR_INST     |

For each category the exchange publishes (daily, per session): **buy value, sell
value, net flow (buy − sell), turnover, and share of total trading value** — plus
the same aggregates by nationality and the retail/institutions split. Scope:
equities only, OPR (block/qualified trades) included, OTC not included. This is
exactly the table the original esthmr.com mocked (its "المستثمرون" view was an
empty stub: "لم يُنشر شيء لهذا بعد").

## Sources evaluated

| # | Source | What it offers | Reachable from this server? | Verdict |
|---|--------|----------------|------------------------------|---------|
| 1 | **EGX official** — `egx.com.eg/en/InvestorsTypeCharts.aspx`, `/en/InvestorsTypePieChart.aspx` (Arabic variants too) | The authoritative daily table (buy/sell/net per category, individuals vs institutions) + charts | ❌ Connection fails (verified twice, weeks apart) | Authoritative source, documented for when network access differs |
| 2 | **Sigma Capital** — `sigma-cap.com/main/x_market_page.overview?u_sess=` | Full republish of the official table: 6 categories × buy/sell/net/turnover/trading %, nationality totals, retail-vs-inst split, block trades (OPR), live intraday | ✅ 200, no auth, static HTML | **PRIMARY — implemented** |
| 3 | **EGXBot** — `egxbot.com/en/market-report` (+ `/market-report`, archive at `/en/market-report/YYYY-MM-DD`) | Daily session report: participation % by nationality (Egyptians/Arabs/Foreigners), total traded value, EGX30 close/change, sector table; ~11-session public archive | ✅ 200, no auth | **SECONDARY — implemented** (participation-trend chart + history backfill) |
| 4 | Mubasher (`mubasher.info`) | Daily articles with net buy/sell per category in text | ❌ 403 | Rejected |
| 5 | Investing.com | Market pages | ❌ 403 | Rejected |
| 6 | Yahoo Finance | No investor-type data for EGX (quotes mirror was stale) | ❌ n/a | Rejected |
| 7 | Synergy Securities | Daily summaries with 3 aggregate net figures (Egyptian/Arab/foreign) | ✅ 200 but **stale** — last post May 13, 2025 | Rejected |
| 8 | EGX official monthly bulletins (XLSX/PDF downloads) | Monthly aggregated flow history | ❌ same host unreachable | Not implementable from here |
| 9 | Paid feeds: Bloomberg/Reuters terminals, EPFR (fund flows), EODHD (prices only) | Institutional-grade data, incl. fund-flow classification | — paid | Out of scope for a free app |

## How the implementation works

`src/lib/flows.ts` (server-only):

1. **Primary fetch** — Sigma Capital's English market page, 5-min in-memory TTL,
   in-flight dedup, stale-serve-on-error (same pattern as the quotes layer).
2. **Parsing** — text-only extraction of the labeled table (`Buy (M)`, `Sell (M)`,
   `Net (M)`, `Turnover (M)`, `Trading %` anchors → 8/8/11/8/8 numeric cells)
   plus the block-trades list.
3. **Arithmetic self-validation** — every parse is accepted only if:
   `net[i] = buy[i] − sell[i]` for all 8 columns, nationality totals = retail+inst
   nets, retail/inst totals = sums of the three nationalities. A layout change
   upstream fails loudly instead of feeding wrong numbers.
4. **As-of dating** — dates found in the page are filtered to ≤ today (Cairo) so
   future disclosure dates can't be mistaken for the session date.
5. **History** — after each session close (Sun–Thu 14:30 Cairo) the final table is
   upserted into SQLite (`FlowDay`/`FlowCat` via Prisma). The net-flow history
   chart is real from day one and grows daily.
6. **Participation history** — EGXBot's current report + its public archive
   (~11 sessions) are parsed (EN and AR phrasings, value sanity floor ≥ EGP 2bn
   to reject stock-level matches) and stored in `ParticipationDay`.
7. **API** — `GET /api/investors` returns today's table, both histories, and the
   source list. No auth, no demo numbers anywhere.

## Cross-verification (two independent public sources)

- EGX30 close on 2026-09-06: **56,676.16 / +0.72%** — identical on Sigma Capital
  and EGXBot. ✓
- One-way value traded: Sigma turnover 31,129.6 mn ÷ 2 ≈ **15,565 mn** vs EGXBot
  "قيمة تداول 15.19 مليار جنيه" (scope difference: EGXBot's figure excludes some
  OPR effects). Same ballpark. ✓
- Egyptians' share: Sigma 93.44% vs EGXBot 94.51% (different measurement scope,
  consistent). ✓

## If you need *official-direct* or deeper history later

- From a network that can reach `www.egx.com.eg`, scrape
  `InvestorsTypeCharts.aspx` directly (same table, authoritative) and/or download
  the monthly bulletins for multi-year backfill.
- The app's SQLite history removes the need for a long public archive over time —
  every session close adds one immutable real row.
- Paid route (Bloomberg `EGX30 Index` + broker flow reports, EPFR) only if
  fund-classification granularity is needed.

## Task 4 — price charts / full news archive / flows discoverability (2026-09-07)

**Price history sources (verified reachable, no auth):**
- Yahoo Finance chart API `query1.finance.yahoo.com/v8/finance/chart/{TICKER}.CA` — full EGX stock daily history (1y = 253 sessions; 5y weekly), EGP, Africa/Cairo session dates. 10/10 sampled tickers OK. Last candle can be null until Yahoo finalizes (parser drops nulls).
- Yahoo EGX index symbols exist (^CASE30, ^EGX70EWI.CA, ^EGX100EWI.CA, ^EGX30CAPPED.CA, ^SHARIAH.CA) but carry only ~1 point of history — unusable for charts.
- EGXBot dated archive pages `/en/market-report/{date}` serve EVERY past Sun–Thu session (arbitrary dates work; 404 on holidays) with the summary table "EGX30 X / EGX70 EWI Y / EGX100 EWI Z" (older EN pages omit the "EWI" suffix — regex accepts both, value ranges validated). → real index history backfilled ~98 days into IndexDay.
- Stooq blocked (JS challenge). Sigma "Historical Investors Distribution" endpoint requires login (rejected). EGX official site unreachable.

**News archive sources:**
- Both publishers run WordPress with public REST APIs: `/wp-json/wp/v2/posts?per_page=100&page=N&_fields=id,date,link,title,excerpt,categories` (title/date/excerpt/categories). Category maps via `/wp-json/wp/v2/categories`.
- Backfill persisted in SQLite (NewsPost, link-unique, in-memory dedupe because Prisma skipDuplicates is unsupported on SQLite).
- Related news for companies: Arabic brand-name alias map (COMI→التجاري الدولي/CIB etc.) since Arabic titles never contain English tickers.

## Task 5 — financial statements & disclosures sources (2026-09-07, evening)

**User asked:** deep research on company financial statements and disclosure data availability.

### Financial statements — ✅ FOUND & IMPLEMENTED

| # | Source | What | Reachable | Verdict |
|---|--------|------|-----------|---------|
| 1 | **stockanalysis.com** `/quote/egx/{TICKER}/financials/` (+ `/balance-sheet/`, `/cash-flow-statement/`, `?p=quarterly`) | FULL statements: income (TTM + 5 FY + quarterly), balance sheet (4 sections, ~47 lines), cash flow (~29 lines), segment breakdowns. EGP millions, cumulative as filed. HTML SSR tables, no key, no auth | ✅ 200 (also verified from Node runtime) | **IMPLEMENTED** — `src/lib/statements.ts` + `/api/statements/[ticker]` |
| 2 | Yahoo quoteSummary | Fundamentals per symbol | ✅ but "No fundamentals data found for symbol: *.CA" (verified COMI, TMGH, with valid crumb; EGX30 index works) | Rejected |
| 3 | TradingView scanner historical-period columns (`total_revenue__FY__2024` etc.) | Per-period financials | ✅ but returns null for all patterns tried | Rejected (TTM ratios only) |
| 4 | Sigma Capital `fund_research_fl.landingpage` | Company financial analysis | 200 but login-gated error page ("حدث خطأ") without session | Rejected (auth) |
| 5 | Mubasher / Investing / EGX official / marketscreener | — | 403 / 403 / unreachable / blocked | Rejected |
| 6 | CBE (cbe.org.eg) | FX official | Request rejected by WAF | Rejected (FX from open.er-api.com instead) |

**Coverage measured:** 52/80 sampled universe tickers have statements (all liquid large/mid caps; the misses are small caps and bond/warrant codes). Cross-verified COMI FY2025 net income 61,634 mn EGP and TMGH FY2025 net income 14,384 mn EGP — both match the published figures.

**Parser design** (src/lib/statements.ts): table-scoped regex extraction — the primary label from the `row-label` div (avoids the "Growth" echo text), balance/cash pages merge their 4 consecutive sections, ratio/margin tables are skipped by first-label marker, growth rows dropped, `—`-cells → null. 6-hour TTL cache + stale fallback, 15s timeout, per-page isolation. Values cross-checked against TradingView TTM fields (COMI net income TTM 71.4bn TV vs 66.4bn SA — different snapshots, consistent).

### Disclosures — official archive unreachable, press-derived implemented

- EGX official disclosure archive: unreachable from this network.
- Mubasher (heaviest republisher of EGX filings): Cloudflare-blocked even from a real browser (verified again).
- **Implemented instead:** a per-company disclosure LOG from our 9,000-article news archive — company aliases (Arabic brand names) + disclosure-type keywords (إفصاح/توزيعات/القوائم المالية/نتائج/أرباح/عمومية/اكتتاب/استحواذ/صفقة). Honest labeling in the UI: "press coverage, not the official archive". TMGH: 6 real filings (H1-2026 results 9.94bn EGP etc.); COMI: 11.
- Scan window widened from 1200/1500 recent rows to the full archive (9k rows, low-ms regex cost).
