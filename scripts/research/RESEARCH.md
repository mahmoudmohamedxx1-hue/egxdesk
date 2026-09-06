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
