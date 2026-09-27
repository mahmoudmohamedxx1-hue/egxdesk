#!/usr/bin/env python3
"""T25 report content — EGX Desk Worldwide Competitive Research & Feature Gap
Analysis (Second Edition, 2026-09-14). Encoded as block tuples consumed by
t25-gen-report.py. English-only (no RTL script); rich-text tags allowed."""

C = []  # list of blocks
def h1(t): C.append(("h1", t))
def h2(t): C.append(("h2", t))
def p(t): C.append(("p", t))
def bullets(items): C.append(("bullets", items))
def callouts(items): C.append(("callouts", items))
def table(head, rows, ratios, caption, note=None): C.append(("table", dict(head=head, rows=rows, ratios=ratios, caption=caption, note=note)))
def img(path, caption): C.append(("img", (path, caption)))
def quote(t): C.append(("quote", t))

T = "/home/z/my-project/scripts/research/t25"

# ══ 1. EXECUTIVE SUMMARY ════════════════════════════════════════════════════
h1("1. Executive Summary")
p("This report answers one question: measured against the best market-data and investment-intelligence "
  "platforms in the world, where does EGX Desk stand today, and what does it still miss? We benchmarked "
  "seventeen platforms across three tiers — eight global leaders (TradingView, Investing.com Pro, Yahoo "
  "Finance, StockAnalysis.com, Simply Wall St, Finviz, Koyfin, and the Barchart/MarketBeat family), six "
  "AI-native challengers (Danelfin, AltIndex, Tickeron, Intellectia, AInvest, and Stocktwits Edge), and "
  "seven Egypt-relevant players (Mubasher with its new Smart Signals app, Argaam, the EGX official website "
  "and app, Thndr, Stockastic, and esthmr.com). Every EGX Desk capability was re-verified against the live "
  "production build (v2.16, released 2026-09-14) before scoring, so the comparison reflects what the site "
  "actually does, not what it claims to do.")
callouts([
    ("20.5 / 28", "EGX Desk capability coverage, scored through an Egyptian investor's eyes — ahead of TradingView's 15.0 for the EGX use case"),
    ("12 of 19", "gaps from the September 9 edition already closed: alerts, portfolio, calendar, dividends, compare, exports, English news, statements, PWA, public API"),
    ("5 + 6 + 6", "open gaps sequenced: five quick wins, six big bets, six long-term differentiators"),
])
p("The headline is that EGX Desk has crossed an important threshold since the first edition of this "
  "analysis five days ago. Scored through an Egyptian retail investor's eyes — a capability only counts "
  "when it actually works for EGX-listed names — the platform now covers more of the benchmarked surface "
  "than any global leader delivers for this market, while remaining entirely free and account-optional. "
  "The twelve gaps closed since September 9 were the operational basics: price alerts with web push, a "
  "portfolio tracker, the earnings and dividend calendar, dividend history, side-by-side comparison, "
  "professional Excel workbooks, a full English news lane, structured financial statements, an installable "
  "PWA, and a documented public API. None of the global majors offers this combination for Egypt at any "
  "price; none of the local rivals offers it with this verification discipline.")
p("The uncomfortable part has moved to a new frontier. Three developments since the last edition define "
  "the competitive reality of late 2026. First, <b>Mubasher launched Smart Signals</b>, an app delivering "
  "institutional-grade BUY/SELL/HOLD signals for the Egyptian and Saudi markets from a professional "
  "research desk — a direct attack on our signals franchise with a brand institutions already trust. "
  "Second, <b>Stockastic</b> has matured into the closest direct rival: an Arabic-first, AI-native MENA "
  "platform with a chat assistant, portfolio AI analysis, visible news-sentiment tags, multi-market "
  "coverage (EGX, Tadawul, DFM, ADX), and a monetization ladder that charges institutions for exactly the "
  "API we give away free. Third, the global leaders are infusing AI into their cores — TradingView now "
  "ships AI-assisted Pine Script authoring, and conversational agents have become a category of their own. "
  "The window in which 'AI + EGX + Arabic' is a differentiator is closing; the window in which 'evidence, "
  "depth, and free' is a differentiator is open wider than ever, because the entrants monetize early.")
p("Our recommendation is therefore sequenced in three waves. Wave one closes the visible product gaps "
  "that competitors already expose in their marketing: a valuation scorecard, intraday chart timeframes, "
  "funds and ETF coverage, visible news-sentiment tags, and — the cheapest and most defensible move — "
  "exposing the walk-forward backtest engine we already run internally as a public Strategy Lab. Wave two "
  "builds the retention layer: optional accounts with cross-device sync, AI portfolio review, a bonds and "
  "treasury desk, and richer alerts. Wave three expands the perimeter: native app store presence, GCC "
  "markets, chart drawing tools, and eventually a licensed real-time feed. Each item in the roadmap "
  "chapter is tied to the competitor evidence that justifies it and the impact we expect it to produce.")

# ══ 2. METHODOLOGY ══════════════════════════════════════════════════════════
h1("2. Methodology and Scope")
p("The research combined three evidence streams, all executed on 2026-09-14. First, nineteen targeted web "
  "searches profiled the current public feature sets, pricing, and AI capabilities of the global and "
  "regional references, restricted where possible to sources dated within the last year; every load-bearing "
  "claim in this report traces to a numbered source in chapter 10. Second, direct site reads were performed "
  "for the platforms where marketing pages understate or overstate reality — most importantly a full read "
  "of Stockastic's Arabic product and pricing pages, which revealed their tier structure (free, Pro at 250 "
  "EGP per month, and an institutional API tier) and their live macro strip (USD/EGP 51.31, gold at 7,120 "
  "EGP per gram, overnight deposit rate 19.0 percent, core inflation 14.3 percent). Third, every EGX Desk "
  "capability was re-verified against the running production build: the views, the 32 API routes, the "
  "16-tool agent, the reports pipeline, and the export engine were exercised live rather than assumed from "
  "documentation.")
p("Scoring uses the same EGX-lens rule as the first edition, applied more strictly: twenty-eight "
  "capabilities are scored 1.0 for fully present, 0.5 for partial, and 0 for absent — but a capability "
  "only counts when it genuinely works for EGX-listed companies as experienced by an Egyptian retail "
  "investor. Finviz's famous screener scores zero because it does not cover the Egyptian exchange at all; "
  "TradingView's unmatched charting scores partial on intraday data because its EGX feed is delayed for "
  "free users; StockAnalysis.com earns full marks on structured statements because we verified during the "
  "September 7 probe that it serves complete EGX income, balance-sheet, and cash-flow tables. This lens "
  "deliberately measures fitness for one market rather than global ambition, which is exactly the frame a "
  "competitor analysis of an EGX-focused product requires.")
p("Limitations are stated plainly. Pricing moves frequently, and plan tiers are summarized to their "
  "published headline figures. AI performance claims made by vendors (accuracy percentages, backtested "
  "returns) are reported as claims, not verified results — we hold our own signals to a stricter standard "
  "than we apply to anyone else's marketing, and we say so where it matters. Finally, some regional "
  "platforms gate features behind logins we did not create; where a capability could not be verified "
  "outside the wall, it is scored from public documentation and marked as such in the narrative.")

# ══ 3. THE MARKET MOMENT ════════════════════════════════════════════════════
h1("3. The Market Moment")
p("EGX Desk is being built into a bull market with a structural retail story. The EGX30 rose roughly 40 "
  "percent across 2025, one of the strongest years in the exchange's modern history, and remained about 52 "
  "percent higher year-on-year into March 2026. The index closed at 56,280 points on September 10, 2026, "
  "and finished the September 13 session at 55,664.79 — the series below is drawn live from EGX Desk's own "
  "API, 207 real trading sessions from November 2025 to the present, not a vendor curve. The exchange "
  "itself reported approximately 123,000 new retail investors tapping the market over the recent period, "
  "against around 100,000 in the comparable stretch of 2024 — the local equity culture is compounding, not "
  "just recovering.")
img(f"{T}/c3-egx30.png", "Figure 1 — EGX30 daily closes, 207 real sessions (Nov 2025 to Sep 13, 2026). Source: EGX Desk live API.")
p("The distribution channel for this wave is mobile brokerage, and its scale is now measurable. Thndr, "
  "Egypt's dominant investing app, passed three million downloads, ranked first among Africa's "
  "fastest-growing companies in May 2026, and disclosed that it now accounts for roughly 18 percent of EGX "
  "equity trading value and 40 percent of total order volume — more than 200,000 trades per day — with "
  "about one billion US dollars in assets under custody. Its revenue grew from 120 thousand dollars in "
  "2021 to 8 million in 2024. Every one of those new accounts needs research, and the brokers themselves "
  "do not ship analyst tooling: Thndr's product is execution and onboarding, not market intelligence. "
  "That is the seam EGX Desk occupies: the free, Arabic-first analytics layer riding on top of a broker-driven "
  "retail boom.")
p("The macro backdrop also explains why a market-data product must behave like a savings-decision product "
  "in Egypt. The Central Bank's overnight deposit rate stood at 19.0 percent in August 2026 with overnight "
  "lending at 20.0 percent, and core inflation ran at 14.3 percent — so every EGX equity decision competes "
  "mentally with bank certificates and Treasury instruments. A terminal that shows dividend yields, "
  "treasury-related context, and honest comparisons against deposit rates (as our tools view began doing) "
  "speaks the actual language of an Egyptian saver. This is also why bond and fund coverage appears in the "
  "gap analysis: the missing asset classes are the ones the retail boom is actually deciding between.")

# ══ 4. THE COMPETITIVE LANDSCAPE ═════════════════════════════════════════════
h1("4. The Competitive Landscape")
h2("4.1 The global leaders")
p("TradingView remains the reference standard for charting and community, and it is not standing still: "
  "its 2026 plan ladder runs from Essential (about 14.95 dollars per month, 20 price alerts) through Plus "
  "(about 24.95 dollars, 100 alerts and more indicators per chart) to Premium and Ultimate tiers carrying "
  "800 and 2,000 active alerts respectively, and its Pine Screener plus AI-assisted Pine Script authoring "
  "(third-party tools report roughly 85 percent first-pass code quality) push it toward AI-native "
  "territory. Investing.com Pro wraps its massive portal in a fair-value engine that averages more than "
  "fifteen valuation models per stock. Yahoo Finance remains the free default for Western retail with "
  "portfolios, alerts, and a premium tier near 50 dollars per year. StockAnalysis.com — quietly one of the "
  "most important references for us — sells Pro at about 79 dollars per year with 300-plus indicators and "
  "10-40 years of history, and, as verified in our September 7 probe, serves complete EGX financial "
  "statements. Simply Wall St markets its five-axis Snowflake visual verdict at roughly 240 dollars per "
  "year for its unlimited tier. Finviz Elite unlocks real-time data, backtesting, and API exports — but "
  "for US-centric universes that exclude EGX entirely. Koyfin packages institutional-grade dashboards from "
  "a free tier (two years of financials, two watchlists) to 79 dollars per month.")
table(
    head=["Platform", "Entry price", "What the paid tier unlocks", "EGX relevance"],
    rows=[
        ["TradingView", "USD 14.95/mo", "More charts, alerts (20 to 2,000), indicators, Pine Screener", "Charts + delayed quotes; no EGX fundamentals"],
        ["Investing.com Pro", "Freemium", "Fair value (15+ models), health scores, ad-free", "EGX quotes and news; shallow per-stock depth"],
        ["Yahoo Finance", "USD ~50/yr", "Premium research, portfolio tools", "Delayed EGX quotes; no Arabic"],
        ["StockAnalysis.com", "USD 79/yr", "300+ indicators, 10-40y history, exports", "Full EGX statements (verified) — no Arabic, no AI"],
        ["Simply Wall St", "USD ~240/yr", "Unlimited Snowflake reports, fair value", "Limited Egyptian coverage"],
        ["Finviz Elite", "USD ~40/mo", "Real-time, backtests, alerts, API", "None — EGX not covered"],
        ["Koyfin", "USD 79/mo", "Unlimited dashboards, global screeners", "Thin frontier-market coverage"],
        ["Barchart/MarketBeat", "Freemium", "Screeners, ratings, newsletters", "US-focused; EGX absent"],
    ],
    ratios=[0.16, 0.13, 0.36, 0.35],
    caption="Table 1 — Global leaders: published entry pricing and what it buys, with the EGX-lens verdict.",
)
h2("4.2 The AI-native generation")
p("A new cohort treats AI as the product rather than a feature. Danelfin markets AI stock ratings with a "
  "backtested headline — its Best Stocks strategy claims +376 percent from January 2017 to June 2025 "
  "against the S&P 500's +166 percent — and its mixed Trustpilot scores show the skepticism such claims "
  "deserve. AltIndex sells 'buy before the spike' analytics built on alternative data such as app "
  "downloads and social traction. Intellectia positions itself explicitly as a conversational Financial AI "
  "Agent that conducts deep research and generates signals through chat; AInvest's Aime assistant plays "
  "the same role for a broader retail audience. Stocktwits Edge packages real-time social sentiment as a "
  "subscription. The strategic lesson from this cohort is not their models — it is their grammar: they "
  "prove that conversational interfaces, visible sentiment, and track-record claims are now table stakes "
  "for credibility among retail investors. EGX Desk already speaks this grammar natively in Arabic, which "
  "none of this cohort does; the gap they expose is that we under-communicate our own published, "
  "walk-forward backtest (58.1 percent hit rate, profit factor 2.47 over three years of real candles) — a "
  "discipline most of these vendors never submit to.")
h2("4.3 The Egypt-focused battlefield")
p("The regional tier is where the fight for this exact user happens. Mubasher's July 2026 launch of Smart "
  "Signals is the most significant event of the quarter for us: a dedicated app delivering what it calls "
  "institutional-grade, real-time BUY/SELL/HOLD signals for the Egyptian and Saudi markets, powered by a "
  "human research desk. It validates our signals thesis with a budget we cannot match — and it charges "
  "accordingly, which leaves the free layer ours to own. The EGX itself shipped an official mobile app in "
  "November 2025 offering market data directly from the exchange, commoditizing basic quotes but not "
  "analytics. Argaam remains the Gulf's Arabic financial-news reference and expanded its interactive "
  "charting to more than 120 GCC companies in June 2026, with Egypt as secondary coverage. Thndr owns "
  "onboarding and execution but deliberately partners on research rather than building it. And esthmr.com "
  "— the original inspiration for much of our data model — continues as a capable but login-gated "
  "reference with statements, disclosures, and rules-based signals.")
p("Stockastic deserves its own paragraph because it is the closest mirror of our positioning. Read live "
  "on September 14, 2026, the platform presents an Arabic-first intelligence suite for MENA investors: a "
  "chat assistant (StookyDoo), portfolio aggregation across brokers with AI analysis, real-time news "
  "sentiment tags, market dashboards across EGX, Tadawul, DFM and ADX, live FX and precious-metals "
  "pricing, and macro indicators. Its free tier is genuinely useful; its Pro tier at 250 EGP per month "
  "unlocks AI workspaces, 50 assistant messages, market recommendations, a stock scorecard, and alerts; "
  "and its institutional tier sells the API and real-time feed we currently give away. Its claims (1,200+ "
  "companies, 99.9 percent accuracy, 24/7 monitoring) are marketing figures. Our verified advantages "
  "against it are depth of uniquely-Egyptian data (investor flows, breadth history, insider log, official "
  "disclosure press coverage), the evidence discipline of our signals and hourly desk reports, "
  "professional Excel workbooks, the free public API, and zero-login privacy. Its advantages over us are "
  "accounts, visible sentiment on every news item, multi-market coverage, a funds-and-metals portfolio "
  "model, and a monetization engine.")

# ══ 5. FEATURE BENCHMARK MATRIX ══════════════════════════════════════════════
h1("5. Feature Benchmark Matrix")
p("The twenty-eight capabilities are grouped into six families for the matrix; the detailed ledger "
  "follows in table 4. Marks are Y (full), P (partial), or – (absent), always through the EGX lens "
  "defined in chapter 2. Two structural facts jump out of the global table. First, no global leader "
  "combines EGX data depth with Arabic UX — the rightmost two columns are a wall of P and – for every "
  "one of them. Second, the capabilities where the global leaders are genuinely unbeatable (chart "
  "drawing tools, analyst estimates, real-time streaming) are precisely the ones that cost them the "
  "most to operate, which is why they monetize them — and why a free product must choose its battles "
  "there carefully rather than imitate the whole surface.")
table(
    head=["Platform", "Market data", "Charting", "Screening", "Fundamentals", "Workflow", "News", "AI layer", "Platform", "Score / 28"],
    rows=[
        ["EGX Desk", "P", "P", "Y", "Y", "Y", "Y", "Y", "Y", "20.5"],
        ["TradingView", "P", "Y", "Y", "P", "Y", "P", "P", "Y", "15.0"],
        ["Investing.com", "P", "P", "P", "P", "Y", "P", "P", "P", "10.5"],
        ["Yahoo Finance", "P", "P", "–", "P", "Y", "P", "–", "P", "9.0"],
        ["Simply Wall St", "P", "P", "P", "P", "P", "–", "P", "P", "6.5"],
        ["StockAnalysis.com", "P", "P", "P", "Y", "P", "P", "–", "P", "6.0"],
        ["Koyfin", "P", "P", "P", "P", "P", "P", "–", "P", "4.5"],
        ["Finviz", "–", "Y", "Y", "P", "P", "P", "–", "P", "2.0"],
    ],
    ratios=[0.15, 0.095, 0.095, 0.095, 0.105, 0.095, 0.09, 0.09, 0.09, 0.09],
    caption="Table 2 — Global tier: capability families through the EGX lens (Y full · P partial · – absent).",
    note="Market data: live quotes for EGX names (delayed feeds score P). Charting: intraday timeframes, drawing tools, indicator library. Fundamentals: statements, valuation models, analyst coverage, dividends. AI layer: chat assistant, generated reports, signals with a published record.",
)
table(
    head=["Platform", "Market data", "Charting", "Screening", "Fundamentals", "Workflow", "News", "AI layer", "Platform", "Score / 28"],
    rows=[
        ["EGX Desk", "P", "P", "Y", "Y", "Y", "Y", "Y", "Y", "20.5"],
        ["Mubasher ecosystem", "Y", "P", "P", "Y", "Y", "Y", "P", "P", "14.0"],
        ["Stockastic (Pro)", "Y", "P", "Y", "Y", "Y", "Y", "Y", "P", "14.0"],
        ["esthmr.com", "P", "P", "P", "Y", "P", "P", "P", "–", "11.0"],
        ["Thndr", "Y", "P", "–", "–", "Y", "P", "–", "P", "10.0"],
        ["EGX official", "Y", "–", "–", "P", "–", "P", "–", "P", "9.0"],
        ["Argaam", "P", "P", "–", "P", "–", "Y", "–", "–", "8.0"],
    ],
    ratios=[0.15, 0.095, 0.095, 0.095, 0.105, 0.095, 0.09, 0.09, 0.09, 0.09],
    caption="Table 3 — Regional tier: same families, same lens. Mubasher and Stockastic lead the paid pack.",
    note="Mubasher scores Y on market data via real-time paid terminals and the Smart Signals app. Stockastic's Y on AI reflects the Pro tier; its free tier is closer to our partial marks.",
)
p("Read together, the two matrices and the coverage chart quantify the strategic position: EGX Desk holds "
  "the highest EGX-lens coverage of any platform measured, at 20.5 of 28 capabilities, roughly five points "
  "clear of the strongest paid regional rivals and the TradingView-for-EGX experience. The margin was "
  "built in five days of shipping the operational basics the first edition called quick wins — and it is "
  "a fragile margin, because the two regional leaders can close their gaps with money while we must close "
  "ours with craft.")
img(f"{T}/c1-coverage.png", "Figure 2 — Capability coverage across all seventeen benchmarked platforms (EGX-lens, 28 capabilities).")
table(
    head=["#", "Capability", "Best-in-class setter", "EGX Desk v2.16"],
    rows=[
        ["1", "Live quotes (real-time or delayed)", "TradingView / Mubasher terminals", "P — 15-min delayed, honestly labeled"],
        ["2", "Intraday chart timeframes (1D/1W)", "TradingView, Yahoo", "– — daily and weekly candles only"],
        ["3", "Multi-year price history", "TradingView, Koyfin", "Y — 5Y real daily candles"],
        ["4", "Chart drawing tools", "TradingView", "–"],
        ["5", "Technical indicator library", "TradingView (100+)", "P — computed panel, not chart overlays"],
        ["6", "Stock screener", "Finviz, TradingView", "Y — persisted filters, TV-sourced metrics"],
        ["7", "Market heatmap", "Finviz, TradingView", "Y"],
        ["8", "Market breadth history", "EGX Desk (unique)", "Y"],
        ["9", "Investor-flow breakdown by category", "EGX Desk (unique for free)", "Y — live table + history + charts"],
        ["10", "Insider/treasury-share log", "Mubasher (partial, paid)", "Y — official snapshot + press strip"],
        ["11", "Financial statements (IS/BS/CF)", "StockAnalysis.com", "Y — annual + quarterly, bilingual"],
        ["12", "Valuation models / fair value", "Simply Wall St, InvestingPro, Finbox", "– — ratios only, no models"],
        ["13", "Analyst ratings & estimates", "Koyfin, MarketBeat", "–"],
        ["14", "Dividend history & yield", "StockAnalysis.com", "Y"],
        ["15", "Earnings/dividend calendar", "Investing.com, Koyfin", "Y — EGX-tailored, holidays-aware"],
        ["16", "Portfolio tracker", "Yahoo, Stockastic", "Y — device-local by design"],
        ["17", "Price alerts + push", "TradingView, Yahoo apps", "Y — in-app + web push, server-side loop"],
        ["18", "News archive (AR/EN)", "Mubasher, Argaam", "Y — 9,857 items, AR + EN lanes"],
        ["19", "Per-item news sentiment", "Stockastic (visible tags)", "P — narrative AI, not surfaced per item"],
        ["20", "AI chat assistant", "Intellectia, AInvest, Stockastic", "Y — 16 tools, streaming, extended thinking"],
        ["21", "AI-generated market reports", "None in region", "Y — hourly + EOD desk reports, evidence charter"],
        ["22", "AI signals with published backtest", "Danelfin (claimed)", "Y — walk-forward, 58.1% hit, PF 2.47"],
        ["23", "Professional data export", "Finviz Elite, Koyfin", "Y — XLSX analyst workbooks, free"],
        ["24", "Public API", "Finviz (paid), Stockastic (paid)", "Y — documented, free, rate-limited"],
        ["25", "Arabic-first bilingual UX", "Mubasher, Stockastic", "Y — AR-first + EN, ~774 strings"],
        ["26", "Mobile app / installable PWA", "All majors", "Y — PWA v12 + push"],
        ["27", "Accounts & cross-device sync", "All majors", "– — deliberate privacy stance"],
        ["28", "Community / social layer", "TradingView, Stocktwits", "–"],
    ],
    ratios=[0.05, 0.30, 0.30, 0.35],
    caption="Table 4 — The 28-capability ledger: who sets the bar, and where EGX Desk stands (verified live).",
)

# ══ 6. WHERE EGX DESK LEADS ═════════════════════════════════════════════════
h1("6. Where EGX Desk Leads")
p("The verified production inventory at v2.16 reads as follows: eighteen analytical views, thirty-two API "
  "routes, a 295-company live universe, a 9,857-item bilingual news archive, a sixteen-tool AI agent "
  "running on GLM-4-Plus with streaming answers and an extended-thinking mode, an hourly-while-open plus "
  "end-of-day desk-report pipeline, walk-forward backtested signals, analyst-grade Excel workbooks, an "
  "installable PWA with web push, shareable URL state for every view, and full Arabic/English parity. "
  "Beyond the inventory, four capabilities have no free equivalent anywhere in the region:")
bullets([
    "<b>Evidence-first AI.</b> The signals charter is a written, deterministic contract whose core was walk-forward backtested on three years of real candles (58.1 percent hit rate, profit factor 2.47, +340 percent cumulative against the market's +175 percent, max drawdown −8 percent), with entry, stop and target fixed by ATR mathematics the model cannot alter. Every hourly report names its sources, attributes catalysts to dated URLs, and carries disclaimers. No regional competitor publishes anything comparable; several global AI vendors publish claims we would not accept from ourselves.",
    "<b>The Egypt-only data moat.</b> Live investor-flow tables by category (Egyptian/Arab/foreign × retail/institutional), market-breadth history with a runtime writer, the insider and treasury-share log linked to official disclosure documents, and press-derived disclosure coverage updating daily. Mubasher has pieces of this behind paywalls; nobody assembles it free.",
    "<b>Analyst tooling for everyone.</b> Excel workbooks with branded covers, table of contents, conditional formatting, print setup and a methodology appendix — exported free, where Finviz and Koyfin put exports and API behind subscriptions, and Stockastic reserves its API for institutions.",
    "<b>Zero-login privacy with full depth.</b> Watchlists, alerts, portfolios and preferences live on the device; the AI runs on shared compute with visible fair-use metering, so personalization costs no account. Every competitor in this report gates depth behind login; most gate it behind payment.",
])
p("These leads are real but not permanent. They compound only if the operational basics keep pace — the "
  "lesson of the first edition, whose eight 'quick wins' became this edition's closed-gap list, is that "
  "credibility is built by shipping the boring things competitors mock us for missing. The same logic now "
  "applies to the five gaps the next chapter labels P0: each one is visible in a competitor's marketing "
  "within two clicks of their homepage.")

# ══ 7. GAP ANALYSIS ══════════════════════════════════════════════════════════
h1("7. Gap Analysis: What We Miss")
p("Seventeen open gaps remain, organized below by priority. Each row names the competitor evidence that "
  "proves users see this capability elsewhere, the effort estimate in engineering terms, and the expected "
  "impact. Effort is rated S (days), M (weeks), or L (quarters).")
h2("7.1 Priority 0 — quick wins, days not quarters")
table(
    head=["Gap", "Who ships it", "Effort", "Impact"],
    rows=[
        ["Valuation scorecard: composite cheapness/quality verdict per stock from ratios we already fetch (P/E, P/B, ROE, yield vs sector medians)", "Simply Wall St Snowflake; InvestingPro fair value; Stockastic scorecard (Pro)", "S", "Answers the #1 retail question — is this stock expensive — inside our data, in Arabic, free"],
        ["Intraday chart timeframes (1D/1W bars from intraday candles)", "TradingView, Yahoo Finance", "S", "Removes the most visible charting gap at zero data cost"],
        ["Funds & ETF pages: EGX30 ETF (64.20 EGP, Sep 12) plus listed treasury-bond funds", "Thndr (funds + gold); EGX listed-securities directory", "S", "Speaks to the certificate-vs-equity decision every Egyptian saver is making"],
        ["Per-item news sentiment chips (AI-scored, ticker-attributed)", "Stockastic — visible tags on every item", "S", "Makes our archive feel alive; sentiment exists in our engine but is not surfaced"],
        ["Public Strategy Lab: expose the walk-forward backtest and charter as a view with per-signal history", "Nobody in the region; Danelfin markets an unverifiable version", "S", "The cheapest trust differentiator we own — publish what others only claim"],
    ],
    ratios=[0.42, 0.26, 0.08, 0.24],
    caption="Table 5 — P0 gaps: each is already visible in a competitor's marketing.",
)
h2("7.2 Priority 1 — big bets")
table(
    head=["Gap", "Who ships it", "Effort", "Impact"],
    rows=[
        ["Optional accounts with cross-device sync (OTP-based, sync watchlists/alerts/portfolios)", "Every major; Stockastic; esthmr", "M", "Retention layer; must stay optional to preserve the zero-login stance"],
        ["AI portfolio review: agent reads the local portfolio, weighs concentration vs flows/breadth, plain-Arabic verdict", "Stockastic Pro (AI portfolio analysis)", "M", "Converts our data moat into personal advice without touching execution"],
        ["Bonds & treasury desk: T-bill auction calendar, yield curve context, savings-certificate comparison", "Stockastic macro strip; brokers' content", "M", "Completes the Egyptian saver's decision table; deepens the tools view"],
        ["Multi-condition and technical alerts (price AND indicator conditions)", "TradingView (multi-condition tiers)", "M", "Alerts are a daily-open habit; richer conditions deepen it"],
        ["Native app-store presence (wrap the PWA; iOS push via store distribution)", "Mubasher, EGX, Thndr, Stockastic apps", "M", "Discoverability where the retail boom actually browses"],
        ["GCC market extension (Tadawul/DFM/ADX basics from existing free feeds)", "Stockastic, Mubasher, Argaam", "L", "Follows the user diaspora and the Egyptian investor's regional interests"],
    ],
    ratios=[0.42, 0.26, 0.08, 0.24],
    caption="Table 6 — P1 gaps: the retention and perimeter layer.",
)
h2("7.3 Priority 2 — long-term differentiators and structural moves")
table(
    head=["Gap", "Who ships it", "Effort", "Impact"],
    rows=[
        ["Chart drawing tools and annotations (lightweight canvas layer)", "TradingView's core moat", "L", "Expensive to match; ship a minimal trendline/level set first"],
        ["Community/social layer per ticker, Arabic-moderated", "Stocktwits; TradingView ideas", "L", "High engagement, high moderation cost; do last and carefully"],
        ["Paper-trading simulator on our live delayed feed", "TradingView, Schwab ($100k virtual), Webull", "L", "Education flywheel for the 123k new annual investors"],
        ["Licensed real-time EGX feed (ICE Consolidated Feed carries EGX Level 1/2)", "Mubasher terminals; EGX data services", "L", "Structural cost; justified only at partnership or revenue scale"],
        ["Institutional API tier and data licensing", "Stockastic sells exactly this", "L", "Monetization path that funds the free tier without ads"],
        ["Brokerage/trading integration", "Thndr, Egypt Stocks Online", "L", "Regulatory (CMA/FRA licensing); partnership-first if ever"],
    ],
    ratios=[0.42, 0.26, 0.08, 0.24],
    caption="Table 7 — P2 gaps: long-horizon structural options.",
)
p("One deliberate non-gap deserves a note: we do not treat 'accounts for everyone' as a goal. The "
  "zero-login stance is a feature — privacy by architecture — and the product should keep it optional "
  "even after accounts exist for those who want sync. Similarly, we do not treat the 15-minute data delay "
  "as a gap to apologize for; it is labeled honestly everywhere, and every hourly-report competitor "
  "claiming 'real-time' on retail EGX data deserves the same scrutiny we apply to ourselves.")

# ══ 8. STRATEGIC POSITION ════════════════════════════════════════════════════
h1("8. Strategic Position")
img(f"{T}/c2-positioning.png", "Figure 3 — Positioning map: Egypt/EGX focus versus AI-native depth. EGX Desk and Stockastic occupy the same quadrant; only one of them is free.")
table(
    head=["", "Strengths", "Weaknesses"],
    rows=[
        ["Internal",
         "Highest EGX-lens coverage measured (20.5/28); evidence-first AI with published backtest; unique Egypt data moat (flows, breadth, insiders); free XLSX + public API; Arabic-first bilingual PWA; zero-login privacy",
         "No intraday charts, valuation models, analyst estimates or drawing tools; EGX-only; no accounts/sync; 15-min delayed data; no native apps; no community; shared-compute AI limits"],
        ["External",
         "Retail boom (123k new investors; Thndr 40% of order volume needs an analytics companion); competitors monetize early leaving the free layer open; EGX statements and news remain freely harvestable; ICE feed exists as an RT upgrade path",
         "Mubasher Smart Signals attacks our signals franchise with an institutional brand; Stockastic mirrors our positioning with monetization; global leaders keep adding AI; official EGX app commoditizes basic data"],
    ],
    ratios=[0.08, 0.46, 0.46],
    caption="Table 8 — SWOT, September 2026.",
)
p("The verdict, stated plainly: EGX Desk is the most capable free market-intelligence product for the "
  "Egyptian exchange measured today, and it is no longer a prototype — it is a daily-usable terminal with "
  "a data and discipline moat that neither the global majors (wrong market focus) nor the regional portals "
  "(wrong engineering culture) replicate easily. It is simultaneously not yet the most complete product "
  "experience in its category: Stockastic's logged-in, multi-market, sentiment-tagged surface and "
  "Mubasher's real-time signal brand each beat us on specific visible dimensions that users can name. "
  "Strategy therefore reduces to a race: close the five visible P0 gaps before the regional rivals close "
  "their depth gaps, and convert the backtest discipline we already own into public trust marketing they "
  "cannot answer. The free constraint is not a handicap in this race — it is the reason the open layer "
  "stays ours while they retreat up the pricing ladder.")

# ══ 9. PRIORITIZED ROADMAP ══════════════════════════════════════════════════
h1("9. Prioritized Roadmap")
p("The roadmap sequences the seventeen gaps into three waves, each tied to the competitive evidence that "
  "justifies it. Wave one is deliberately shallow-and-wide: five shippable items, all S-effort, that "
  "neutralize the most visible comparisons in competitors' marketing. Wave two builds retention and the "
  "saver's decision surface. Wave three expands the perimeter and the business model. The sequencing "
  "principle throughout: ship what users can see competitors doing, before investing in what nobody does.")
table(
    head=["Wave", "Items", "Competitive trigger", "Expected effect"],
    rows=[
        ["Wave 1 — 30 days",
         "Valuation scorecard v1; intraday 1D/1W charts; funds & ETF pages; news sentiment chips; public Strategy Lab",
         "Simply Wall St / InvestingPro scorecards; Stockastic sentiment tags and scorecard; TradingView timeframes",
         "Neutralizes every two-click comparison; converts our hidden backtest into visible trust"],
        ["Wave 2 — 60-90 days",
         "Optional accounts + sync; AI portfolio review; bonds & treasury desk; multi-condition alerts; PWA app-store wrap; Arabic education hub",
         "Stockastic Pro portfolio AI; TradingView alert tiers; broker content desks; 123k new investors needing onboarding",
         "Turns daily visitors into retained users; completes the saver's decision table"],
        ["Wave 3 — quarters",
         "GCC market extension; chart drawing tools (minimal set); community layer; paper trading; institutional API tier; licensed real-time feed",
         "Argaam/Mubasher regional coverage; TradingView's moat; Stocktwits engagement model; ICE EGX feed availability",
         "Perimeter growth and the monetization engine that funds the free tier without ads"],
    ],
    ratios=[0.14, 0.34, 0.30, 0.22],
    caption="Table 9 — Three-wave roadmap, September 2026 edition.",
)
p("Two disciplines govern execution. First, every wave-one item ships bilingual on day one — the "
  "Arabic-first experience is half the moat, and shipping English-first would squabble away the regional "
  "advantage for a week of engineering convenience. Second, nothing in the AI layer ever ships without "
  "its evidence line: the Strategy Lab publishes its walk-forward record, the portfolio review cites the "
  "flows and breadth data behind each observation, and the sentiment chips carry confidence rather than "
  "certainty. That discipline is the one thing no competitor can copy quickly, because it is easier to "
  "build an AI feature than to submit one to an honest backtest.")

# ══ 10. SOURCES ══════════════════════════════════════════════════════════════
h1("10. Sources")
C.append(("srcs", [
    "TradingView — plans, alerts and Pine Screener documentation; Supa.is plan comparison (Mar 4, 2026); StockBrokers.com TradingView review (Aug 19, 2026); Tickerly plan guide (Sep 24, 2025).",
    "TradersPost — 'Best AI Trading Tools for TradingView' (Apr 13, 2026); LuxAlgo — Quant Pine Script AI (Feb 26, 2026); Pine Script v6 AI-assisted coding announcement (Dec 10, 2025).",
    "Investing.com — InvestingPro Fair Value documentation; InvestingSupport — InvestingPro+ 15-model fair value (Aug 8, 2026); MatchMyBroker InvestingPro review with live model example (Aug 4, 2026); Strike.money Investing.com review (Jan 14, 2026).",
    "Koyfin — pricing pages and FAQ; Capterra and CFO Club Koyfin reviews (Aug 31, 2026; Jan 27, 2026).",
    "Finviz — Elite feature pages; StockBrokers.com Finviz review (Aug 25, 2026); BullishBears Finviz review (Sep 4, 2026).",
    "StockAnalysis.com — Pro pages (300+ indicators, 60-day guarantee); WallStreetSurvivor review with pricing (Apr 19, 2026); RyanOConnellFinance review (2026); Trustpilot ratings.",
    "Simply Wall St — Snowflake documentation (Jun 17, 2025); Simply Wall St vs Investing.com comparison (Jun 26, 2025); StockUnlock review (Feb 1, 2026).",
    "Yahoo Finance — subscription plans page; RhinoInvestory '13 Best Stock Screeners 2026' premium pricing; DonkyCapital alternatives review (May 27, 2026).",
    "Danelfin — 'How it Works' methodology and +376% vs +166% S&P backtest claim (Jan 2017 – Jun 2025); Trustpilot reviews.",
    "AltIndex — Danelfin vs AltIndex comparison (2026); HowStuffWorks '5 Best AI Stock Pickers' (Feb 19, 2026).",
    "Intellectia — Finder.com 'Best AI Trading Bot' review describing the conversational Financial AI Agent (Jul 10, 2026); AInvest Aime — Assistents.ai '16 Best AI for Stock Market Analysis' (Jun 25, 2026).",
    "Stocktwits — app store listings; Stocktwits Edge real-time sentiment subscription page (Sep 9, 2026).",
    "Mubasher Smart Signals — Google Play listing (Jul 22, 2026) and App Store listing: 'institutional-grade investment signals for Egyptian and Saudi markets, real-time BUY/SELL/HOLD'; AppBrain listing (Sep 4, 2026).",
    "The Egyptian Exchange — official app on Google Play (Nov 23, 2025); egx.com.eg new-retail-investor figures; listed-securities directory including treasury-bond funds.",
    "Thndr — thndr.app 'Africa's Fastest-Growing Companies' #1 ranking (May 14, 2026) with 18% of EGX value / 40% of order volume / 200k+ daily trades / USD 1bn AUC; Google Play 'Trading app drives change' (Jun 8, 2026) with USD 120k (2021) to USD 8mn (2024) revenue; App Store listing (3M+ downloads); StartupIntros profile (Jul 13, 2026).",
    "Stockastic — live site read of stockastic.app Arabic home and pricing pages (Sep 14, 2026): free / Pro 250 EGP per month / institutional API tiers; StookyDoo assistant; multi-market dashboards; macro strip (USD/EGP 51.31, gold 24k 7,120 EGP/g, overnight deposit 19.0%, lending 20.0%, core inflation 14.3%); 1,200+ companies and 99.9% accuracy marketing claims.",
    "Argaam — 'Argaam expands CHARTS with GCC market coverage' (Jun 28, 2026): 120+ GCC companies, 100+ interactive analytical pages; Wikipedia Argaam profile; Finlight Arabic financial news API coverage notes (Aug 16, 2026).",
    "EGX30 market data — TradingEconomics EGX30 quote (Sep 10, 2026, 56,280); Afrivestia EGX 30 performance guide (+40% in 2025, +52% YoY Mar 2026, Apr 1, 2026); Amwal Al Ghad record-high coverage (Jul 16, 2025); Investing.com EGX30ETF quote (64.20 EGP, Sep 12, 2026); EGX Desk live API — 207 real sessions to Sep 13, 2026 (55,664.79).",
    "Egypt macro and flows — EGX Desk /api/rates (CBE overnight deposit 19.0%, lending 20.0%, Aug 2026 reference); Sigma Capital market-page flow table (primary source documented in the flows research note, 2026-09-06/07).",
    "ICE Consolidated Feed — developer.ice.com Egyptian Exchange (EGX) streaming Level 1/2 data availability.",
    "Paper trading — TradingView paper trading documentation; Schwab paper trading ($100,000 virtual); Webull paperTrade; StockBrokers.com '6 Best Paper Trading Apps' (2026).",
    "Prior internal research — esthmr.com browser audit and data-source probes (2026-09-06/07); first-edition competitive benchmark EGX-Desk-Competitive-Research-Gap-Analysis.pdf (2026-09-09); EGX Desk production build v2.16 verified live on 2026-09-14 (views, API routes, agent tools, reports, exports).",
]))

CONTENT = C
