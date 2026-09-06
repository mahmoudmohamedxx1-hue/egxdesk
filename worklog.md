# Worklog

---
Task ID: 1
Agent: Super Z (main agent)
Task: Clone esthmr.com (Egyptian Exchange market data site) — features, views, and API routes — as a Next.js app.

Work Log:
- Explored https://esthmr.com/?view=sectors with agent-browser: mapped all views (home, market, investors, heat, sectors, exchange, today/news, watchlist, tools, company detail) and the auth model (email + 6-digit OTP, HttpOnly session cookie, demo dataset when signed out, live dataset when signed in).
- Created a temp email on mail.tm, completed the site's OTP login (POST /esthmr/api/auth/request → POST /esthmr/api/auth/verify), and recorded the authenticated data model and API surface (auth/me, watchlist GET/PUT, image proxy, static JSON data files).
- Built an original functionally-equivalent implementation (no copied source files, assets, or copy): Next.js 16 + TypeScript + Tailwind 4 + shadcn/ui + Prisma/SQLite.
- Prisma schema: Sector, Company, PricePoint, FinancialPeriod, Disclosure, NewsItem, IndexQuote, InvestorFlow, User, OtpCode, Session, WatchItem (db at db/custom.db).
- Seed script (prisma/seed.ts): 18 EGX sector classifications, 106 representative listed companies (factual tickers/names) with simulated quotes/fundamentals, 250-session price history per company, financial periods, 361 disclosures, 60 news items, index quotes, investor flows; plus a 40-company DEMO dataset for signed-out visitors.
- API routes: /api/auth/request (OTP, sandbox dev delivery returns code), /api/auth/verify (session cookie, 30d), /api/auth/me, /api/auth/signout, /api/watchlist (GET/PUT full-list sync), /api/overview, /api/companies, /api/company/[ticker], /api/sectors, /api/news, /api/investors, /api/search.
- UI: single-page app on / with client-side ?view= routing; RTL Arabic-first with English toggle; light/dark themes (next-themes); warm paper/ink palette with up/down colors; IBM Plex Sans Arabic + Plex Mono numerals; sign-in sheet (email→OTP), search dialog, watch stars, SVG price chart, heatmap, sector cards, news feed with speechSynthesis TTS, coupon calculator, footer disclaimer.
- Verified end-to-end with agent-browser: home/market/sectors/heat/investors/news/watchlist/tools/company views render; sign-in switches demo→live dataset; watchlist star persists via PUT; search works; sign-out returns demo mode; EN/LTR + dark mode + mobile 390px no-overflow; zero console errors; lint clean.

Stage Summary:
- Deliverable: runnable Next.js app at / (dev server on port 3000) — "EGX Desk".
- Key decisions: sandbox has no SMTP, so the OTP is returned in the sign-in response and auto-filled (labeled dev note in the UI); data is simulated and labeled as demo; only tickers/sector names are factual.
- Artifacts: prisma/schema.prisma, prisma/seed.ts, src/app/api/**, src/components/market/**, src/components/views/**, src/lib/{i18n,format,auth}.ts.

---
Task ID: 2
Agent: Super Z (main agent)
Task: Replace the app's simulated dataset with real live EGX market data and remove authentication entirely.

Work Log:
- Clarified user intent: "clone the API routes" meant real (not demo/mock) data, and "remove the auth" meant no login at all.
- Verified reachable public data sources from the sandbox: TradingView Egypt screener (296 common stocks, ~15-min delayed quotes, sector/industry, P/E, EPS, div yield, 52w range, 1M hi/lo, 10d avg volume, TTM revenue, net margin, beta, perf W/1M/3M/6M/YTD/1Y/3Y/5Y), TradingView global scanner (EGX30, EGX70 EWI, EGX100 EWI index quotes + perf), Alborsaanews RSS + Amwal Alghad RSS (Arabic market news). Rejected: Yahoo (stale/delisted mirror), EGX official site (unreachable), Mubasher (403), investing.com API (403).
- Built src/lib/market.ts server data layer: typed fetchers with 60s/60s/300s in-memory TTL caches, in-flight dedup, stale-fallback on upstream failure, fast-xml-parser RSS parsing (CDATA/entities/categories), sector aggregation (equal + cap-weighted change, up/down counts, medians, movers, turnover leader), related-news matcher, companyRow mapper.
- Added src/lib/market-status.ts (shared client/server): EGX session state from Africa/Cairo time (Sun-Thu 10:00-14:30) + last-session date roll-back.
- Rewrote API routes on real data: /api/overview, /api/sectors, /api/companies, /api/company/[ticker] (quote + fundamentals vs sector medians + peers + related news), /api/news, /api/search, /api/activity (replaced investor-flows view — exchange flow data has no free public feed, so the view now shows real turnover leaders / unusual volume / breadth with an honest note).
- Deleted auth entirely: /api/auth/*, /api/watchlist, src/lib/auth.ts, src/lib/db.ts, sign-in-sheet.tsx; watchlist moved to browser localStorage (no account, no OTP).
- Client rewires: app-context (no auth, localStorage watchlist, live market-status chip), app-shell (no sign-in/out UI, live status header), useLiveData hook (60s polling + focus refresh + error/retry states), perf-chart.tsx (real performance-horizon bars + 52-week range marker replacing fake price history), all 9 views updated for real field shapes; tools-view patched off auth/nameAr.
- i18n: removed all auth/demo copy; added live-data provenance, activity, fundamentals, peers, related-news, range/perf labels; footer credits TradingView + both news feeds and delay disclosure. layout metadata updated.
- Fixed during verification: nested <button> (WatchStar inside row buttons) causing hydration error -> converted rows to role=button divs with keyboard handlers; react-hooks/set-state-in-effect lint errors (SSR-safe localStorage init with documented disable; render-adjust pattern for panel prop); DialogContent aria-describedby warning.
- Verified end-to-end with agent-browser: all views (home, market, sectors, heat, activity, news, watchlist, tools, company tabs) render real data; star -> localStorage -> watchlist works; search type-ahead returns live quotes; AR/EN toggle, dark mode, mobile 390px no-overflow; sticky footer (gap 0); console clean; lint clean; dev.log 200s only.

Stage Summary:
- The app now serves only real, live, delayed (~15 min) EGX data from public sources — zero seeded/mock data, zero auth, zero OTP.
- Key decisions: TradingView as quote source (only reliable free EGX feed reachable); company names shown in English (source provides no reliable Arabic names; old seed's Arabic names were inaccurate and were dropped); investor-flows view replaced with real market-activity metrics + explanatory note (no free public source for exchange flow data); price history replaced with real performance horizons + 52w-range position (no free daily history source).
- Artifacts: src/lib/market.ts, src/lib/market-status.ts, src/components/market/{use-live-data,perf-chart,types}.ts, rewritten src/app/api/**, rewritten views, updated i18n/shell/context.

---
Task ID: 3
Agent: Super Z (main agent)
Task: Add real charts (user: "where is the charts") and deep-research + implement real investor-category flows (user: "make deep research on how to get the investor-category flows").

Work Log:
- Deep research on investor-category flow sources (searches + endpoint probing, notes in scripts/research/RESEARCH.md): EGX official InvestorsTypeCharts.aspx is authoritative but unreachable from this network (verified again); Sigma Capital's market overview page republishes the full official table (6 categories × buy/sell/net/turnover/trading%, nationality totals, retail-vs-inst, block trades) — reachable, no auth; EGXBot daily reports give nationality participation % + totals + ~11-session archive; Mubasher/Investing 403; Synergy stale (May 2025); verified Sigma vs EGXBot cross-agreement (EGX30 56,676.16 +0.72% on both).
- Built src/lib/flows.ts: text-anchor HTML parser for Sigma's table with arithmetic self-validation (net=buy−sell per column, totals=sums; rejects bad parses), future-date filtering for as-of dating, 5-min TTL cache + stale fallback; EGXBot EN/AR parsers (participation, value with ≥EGP 2bn sanity floor, EGX30) + immutable archive cache.
- Prisma: appended FlowDay/FlowCat/ParticipationDay models to prisma/schema.prisma, recreated src/lib/db.ts client, ran db:generate + db:push.
- New /api/investors route: live today table (persisted to SQLite after session close), participation history (backfilled once per process from EGXBot archive), flow history, sources list.
- Built shared chart primitives src/components/market/charts.tsx: DivergingBars (hand-rolled diverging bar rows), DonutChart (recharts donut + side legend, LTR-safe), TrendLines (recharts multi-series lines with connectNulls + custom bilingual tooltip). Added 8-color categorical palette (--c1..--c8, light+dark) to globals.css.
- Built views/investors-view.tsx ("المستثمرون" nav tab restored): headline stats, net-flow-by-category diverging bars, trading-distribution donut, nationality participation trend (real 11-session history), net-flow-by-nationality history (starts with 1 real day, grows daily), detailed 6-category table, OPR block trades table, sources section. All AR/EN bilingual.
- Charts added to sectors-view (sector performance diverging bars + market-cap weight donut with top-7 + other bucket) and overview-view (compact full-market sector bar chart; /api/overview extended with sectorPerformance).
- Updated i18n (~40 new keys), liveNote/activityNote/footerNote now credit Sigma Capital + EGXBot; worklog + research doc updated.
- Verified end-to-end with agent-browser: /?view=investors renders all 6 categories + 15 block trades with real Sep 6 numbers (EGY retail +428mn … foreign inst −256mn), donut 6 sectors, 3 trend lines; sectors view 21 sectors + sorted bar chart + 8-slice donut; overview compact chart; EN toggle, dark mode, mobile 390px no horizontal overflow; clean reload = zero console errors (one benign hydration warning only when emulating prefers-color-scheme mid-session); lint clean; dev.log 200s only; API first call 5.4s (backfill) then ~30ms cached.

Stage Summary:
- The app now has real charts everywhere the user asked: sectors view (2 charts), overview (1 chart), investors view (4 charts + 2 tables).
- Investor-category flows are REAL, live from Sigma Capital's republish of the official EGX table, with a real history that accumulates day by day in SQLite, plus EGXBot-based participation trend — the original esthmr.com never actually shipped this feature (its investors view is an empty stub).
- Key artifacts: src/lib/flows.ts, src/lib/db.ts, prisma/schema.prisma (FlowDay/FlowCat/ParticipationDay), src/app/api/investors/route.ts, src/components/market/charts.tsx, src/components/views/investors-view.tsx, updated sectors/overview/app-shell/i18n/globals.css, scripts/research/RESEARCH.md.

---
Task ID: 4
Agent: Super Z (main agent)
Task: Real price charts for every stock and index; full news archive newest→oldest (not today-only); make investor-category flows discoverable.

Work Log:
- Probed sources (scripts/research/probe2.ts, probe3.ts + ad-hoc; notes appended to RESEARCH.md): Yahoo chart API has full EGX stock history (.CA suffix) but only 1 point for indices; EGXBot serves ARBITRARY past dates /en/market-report/{date} with all 3 index closes + participation; both news publishers expose public WP REST APIs with full post history; Sigma's historical-flows endpoint requires login (rejected); Stooq JS-blocked.
- Prisma: added IndexDay (real daily EGX30/70/100 closes) + NewsPost (archived news) models; db push; regenerated client (dev server restarted to pick it up).
- Price charts: new src/lib/history.ts (Yahoo fetcher, ranges 1M/3M/6M/1Y daily + 5Y weekly, Cairo-day date labeling, null-candle filtering, 5-min cache + stale fallback); new /api/chart?symbol=&range= (stocks validated against the live universe; indices from IndexDay with background warm-up + warming flag); new PriceChart component (recharts area+volume, range tabs, bilingual tooltip/labels, up/down coloring, warming poll).
- Integrated charts: company view — "حركة السعر / Price chart" card at top of the overview panel (COMI 6M +15.66%, 1Y +49.84% verified); overview view — new "رسوم مؤشرات البورصة" section with EGX30/70/100 tabs (index cards now select+scroll to it); 52w-range + performance panels kept below.
- Index history backfill: flows.ts parseEgxbot now extracts EGX70/EGX100 (EWI optional, range-validated) and EGX30 with a robust fallback; ensureHistory iterates all Sun–Thu sessions of the last 98 days (concurrency 5, null-marker rows for holidays) and persists IndexDay + ParticipationDay; indexHistory() reads it. 57 real sessions stored (Jun 14 → Sep 6), growing daily.
- News archive: new src/lib/news-archive.ts — WP REST backfill per site (resume-from-known-page, ~90-day coverage target, 45-page cap, per-site error isolation, page retries with backoff, 400ms inter-page delay); RSS items synced every call for freshness; /api/news rewritten with page/limit pagination (total 8,500 posts, coverage since Jul 1); news view rebuilt with "load older" pager, coverage line, 2-min silent refresh; related news now matches Arabic brand names via an alias map (COMI/TMGH verified) and falls back to RSS matching.
- Investors discoverability: "تدفقات المستثمرين / Investor flows" added to the PRIMARY nav (4th tab) with a clearer label; participation trend now spans 57 real sessions; /api/investors backfill wait bounded to 12s (background completion); /api/news bounded to 10s.
- Fixed during verification: stale Prisma client in dev (restart); SQLite has no Prisma skipDuplicates → in-memory dedupe; one WP publisher throttling → retries + per-site isolation; EN archive pages omit the "EWI" suffix in index names → optional-suffix regex; duplicate i18n block cleanup; company beta field now returned by the API (latent type error); tsc src errors 0.
- Verified with agent-browser: company price chart (5 ranges, volume bars, real data), overview index-chart tabs (EGX30 56,676.16 +9.0% 3M; EGX70 switch works), news view 6,000→8,500 items with working load-older (40→80 articles), investors view with primary-nav entry + 3 trend lines + 57-session history, EN toggle ("Price chart", TMGH 97.80 +25.56%), mobile 390px no overflow, dark mode, clean console, lint clean, dev.log 200s only.

Stage Summary:
- Price charts for EVERY stock (Yahoo real candles) and every index (real EGX session closes from EGXBot, ~3-month series that accumulates daily) — no free source offers multi-year EGX index history; honestly noted in the UI.
- News is now the full real archive (8,500 articles, ~10 weeks deep, newest→oldest, paginated) instead of today's RSS only.
- Investor-category flows: one tap away in the top nav, with live Sigma table + deeper real history.
- Key artifacts: src/lib/{history,news-archive}.ts, src/app/api/chart/route.ts, rewritten /api/news, src/components/market/price-chart.tsx, prisma/schema.prisma (IndexDay, NewsPost), updated flows/company/overview/news views + i18n.

---
Task ID: 5
Agent: Super Z (main agent)
Task: Deep gap analysis — compare esthmr.com's full feature surface against our app and identify what is missing (user: "NOW MAKE DEEP ANALYSIS AND TELL ME WHAT WE MISS").

Work Log:
- Re-audited esthmr.com in the browser (all views; re-login now impossible — the site rejects disposable emails, old session cookie expired): sectors cards (median P/E, median P/B, dividend yield, biggest mover), market view 4 tabs (prices / ranking+compare / unusual volume / sector+metrics), company 3 tabs (overview / financial statements with 5 periods incl. balance sheet + cash flow + debt-structure / disclosures with signals + filing archive), exchange view (indices + traded value + 5 EGP FX rates + economic indicators), tools (coupon calc with payback + stocks-vs-bank-vs-gold comparison + plain-Arabic glossary), news (impact annotations, publisher logos, TTS, disclosures interleaved), home (behind-the-move flows summary, ranking widget, heatmap, breadth, movers, top news+signals), Arabic search normalization.
- Probed data feasibility for every gap: Yahoo has NO fundamentals for .CA symbols (crumb flow works, data absent — verified COMI/TMGH); TradingView scanner historical-period columns return null; TradingView DOES serve 14 extra populated fields for EGX (price_book_fq, debt_to_equity, return_on_equity, net_income_ttm, dividends_yield_current, dividend_payout_ratio_ttm, gross_margin_ttm, revenue_growth_quarterly, net_debt, total_current_assets, number_of_employees, float_shares_outstanding, earnings_release_date, beta_1_year); open.er-api.com free live FX incl. EGP; api.gold-api.com free XAU spot; CBE site blocked.
- Wrote full analysis to scripts/research/GAP-ANALYSIS.md (13 gaps, each with feasibility verdict; thin-data areas; where we lead esthmr; P1/P2/P3 priority plan).

Stage Summary:
- 13 missing features identified: full statements tab (blocked), disclosures archive (blocked), signals engine (lite buildable), exchange/economy view (buildable: FX+gold+value), ranking metrics incl. P/B/D/E/ROE/net-profit (easy — TV columns verified), sector-card medians (easy), tools comparison+glossary (trivial), 1W chart range (trivial), home behind-the-move summary (easy), Arabic names (curation), Arabic search normalization (minor), company brief (auto-gen), news impact chips (partial).
- Key unlocks found: TradingView extended columns (verified live values for COMI/SWDY) fill ranking + sector medians + fundamentals gaps; open.er-api + gold-api fill the exchange view.
- Delivered as in-chat analysis + scripts/research/GAP-ANALYSIS.md.
