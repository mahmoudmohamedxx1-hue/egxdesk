# EGX Desk — Deep Competitive Research & Strategic Self-Analysis

*Research cycle: September 2026 (v2.16 baseline report expanded for v2.22).
Method: live web research across 20+ competitor surfaces, source-verified data probing from the
production server, a full feature audit of this repository (19 views, 28 API routes, 43 engine
modules, 11 test suites), and side-by-side benchmarking. Every claim below is tied to a source in
§10 or to code in this repo.*

---

## 1. Executive Summary

EGX Desk is a **free, zero-login, Arabic-first market intelligence desk for the Egyptian Exchange**,
now differentiated by three things no competitor combines:

1. **A composite Technical + Fundamental signal engine** (shipped v2.22) — 13 technical indicators
   blended at 55/45 with a 7-component fundamental pillar score (valuation vs sector medians,
   quality, income). The only free TA+FA rating for the whole EGX universe.
2. **An agentic AI assistant** that *executes* site actions (navigation, watchlist, alerts, paper
   trades) across **1,000+ free cloud models** (GLM-5.3 default via Puter, plus the app's own
   GLM-4-Plus gateway and an offline Instant router).
3. **Honest free data depth**: 295-name universe, ~9,900-article bilingual news archive, investor
   flows, full financial statements for ~52 large/mid caps, GCC markets, paper trading, PWA install.

**Where we are:** the product is feature-dense and technically green (tsc clean, 11/11 test suites
passing, production build stable), and it now matches or beats every *free* alternative on EGX
depth while leading all of them on Arabic-first UX and agentic AI. **Where we lag:** real-time
quotes (we are ~15-min delayed), fundamental history depth (5FY vs StockAnalysis's 10–40y),
fair-value modeling (InvestingPro's 15+ models), community (Stocktwits/TradingView ideas),
app-store presence (PWA vs native), and brand/SEO footprint. **What to do:** a three-wave
roadmap (§9) that converts our data-depth moat into public proof (track record, SEO pages),
then locks retention (portfolio import, push channels, Arabic morning brief), then scales
(real-time feed partnership, store wrappers, community).

---

## 2. Method

- **Competitor surfaces studied** (2025–2026 sources): TradingView (plans ladder, AI/Pine tooling),
  Investing.com/InvestingPro (Fair Value models), Koyfin, Finviz Elite, StockAnalysis.com,
  Simply Wall St, Barchart/MarketBeat, Yahoo Finance, Mubasher Smart Signals (EGX/KSA), Argaam
  (GCC), the official EGX app (launched Aug 2025), Thndr (Egypt brokerage app), Stockastic
  (AI EGX platform), esthmr.com (Egyptian fundamental portal), Danelfin/AltIndex/Tickeron
  (AI pickers), Stocktwits (community), Schwab/Webull/TradingView paper trading.
- **Data-source verification** (from the production server, documented in
  `scripts/research/RESEARCH.md`): EGX official site unreachable from our network; Mubasher and
  Investing.com Cloudflare-blocked; Yahoo Finance serves full daily candles for 209 EGX tickers;
  TradingView scanner exposes TTM fundamentals for the whole universe; stockanalysis.com serves
  full financial statements without auth; Sigma Capital republishes the official investor-flows
  table. Where a capability is impossible for free today, we say so instead of faking it.
- **Self-audit:** code inventory (views/routes/modules/tests), live API verification, and the
  worklog (`worklog.md`, Tasks 1–30) covering every feature's implementation and QA trail.

---

## 3. The Market Moment (why this product, why now)

- **EGX30 rose ~40% in 2025** and was still up roughly 52% year-on-year by March 2026
  (afrivestia.com); the index traded around **56,280 on 10 Sep 2026** (tradingeconomics.com).
- **~123,000 new retail investors** entered the market in the first half of 2026 vs ~100,000 in
  the same period of 2024 (EGX official statements) — an accelerating retail wave with no
  signs of cooling.
- **Thndr alone** (Egypt's #1 brokerage app) reports 3M+ downloads, ~18% of EGX equity trading
  value, ~40% of total order volume, 200k+ trades/day, ~$1bn assets under custody — proof that
  mobile-first Arabic retail finance is exploding.
- The official **EGX mobile app only launched 17 Aug 2025** — the exchange itself is new to
  mobile, leaving room for third-party desks.
- Simultaneously, global platforms are **paywalling intelligence**: TradingView's 2026 ladder
  starts at ~$12.95–14.95/month (20 alerts, limited indicators); Koyfin's useful tiers run to
  $79/month; InvestingPro gates Fair Value behind subscription; Mubasher sells "Smart Signals"
  for EGX/KSA as a paid app. The free Arabic-first EGX research desk position is **open**.

---

## 4. The Competitive Landscape

### 4.1 Global leaders (broad, deep, paid beyond basics)

| Platform | What they are | Free tier reality (2026) | Paid from | EGX depth |
|---|---|---|---|---|
| **TradingView** | Reference standard for charting + community; 2026 plans Essential→Ultimate (20→2,000 alerts) | 1 chart/layout, ~3 indicators, ads, 1 price alert | ~$12.95–14.95/mo | EGX tickers with delayed data; English-first |
| **Investing.com / InvestingPro** | Portal + premium analytics; Fair Value from 15+ models, health scores | Delayed quotes, ads, thin fundamentals | InvestingPro subscription | EGX quotes/news; Arabic edition exists |
| **Koyfin** | Pro-grade dashboards, macro | 2 watchlists, 2 screens, 2Y financials | ~$79/mo | Minimal EGX |
| **Finviz** | Screener king (Elite: real-time, 20+ advanced filters, exports) | Capable screener, delayed | Elite ~$39.50/mo | No EGX |
| **StockAnalysis.com** | Clean statements/research | Most data free, ads | Pro ~$79/yr (10–40y history, exports) | **Full EGX statements** — our own source |
| **Simply Wall St** | Snowflake visual fair-value scores | Limited reports/week | Subscription | Thin EGX |
| **Yahoo Finance** | Free quotes/portfolios | Solid basics | — | EGX quotes, no fundamentals |

### 4.2 Regional & EGX-specific (our real battleground)

| Player | Model | Strengths | Weaknesses (verified) |
|---|---|---|---|
| **Mubasher Smart Signals** | Paid app; "institutional-grade" BUY/SELL/HOLD signals for EGX + Saudi from Mubasher's research desk | Professional signal branding, analyst desk, Arabic | **Paid**; no zero-login exploration; Cloudflare-walled web |
| **EGX official app** (Aug 2025) | Free official mobile app | Real-time official data, listing rules | Data terminal, not analysis: no signals, no screener depth, no AI |
| **Thndr** | Freemium brokerage | 3M+ downloads, real trading, funds/gold, education | Requires brokerage account; research tools are onboarding-oriented, not desk-grade |
| **Stockastic** | AI EGX platform (direct quadrant rival) | AI-driven analysis, EGX screening | Paid tiers, English-leaning, no flows/statements depth we verified |
| **esthmr.com** | Arabic fundamentals portal | Deep company statements UI, signals-lite | Login-gated live data (signed-out = demo market); empty investors stub; no English |
| **Argaam** | GCC financial news + 120-company GCC analytical pages | Arabic GCC authority | EGX is secondary; tools are article-adjacent |

### 4.3 AI-native pickers (context for our AI positioning)

Danelfin (AI stock ratings with published strategy returns, +376% 2017–2025 vs S&P +166%),
AltIndex, Tickeron, AInvest's "Aime" chatbot — all paid, all US/global-focused, none Arabic,
none execute actions inside a market desk. Our assistant is not a chat bolted onto a page; it
is an **operator** with 20 bilingual tools over the live app.

---

## 5. Feature Benchmark Matrix

Legend: ✅ full · 🟡 partial/limited · ❌ absent.

| Capability | EGX Desk | TradingView | Investing.com | Mubasher SS | EGX app | Thndr | Stockastic | esthmr |
|---|---|---|---|---|---|---|---|---|
| Price, free | ✅ | 🟡 | ✅ | ❌ paid | ✅ | ✅ | 🟡 | ❌ login |
| **TA+FA composite signals, whole market, free** | ✅ (v2.22) | ❌ (tech ratings only; alerts paid) | 🟡 (Fair Value paid) | 🟡 (paid, analyst) | ❌ | ❌ | 🟡 (AI, paid tiers) | 🟡 (signals-lite, login) |
| Technical indicators per chart | 21 (free) | 100+ (3 free) | ~30 (most free) | 🟡 | ❌ | 🟡 | 🟡 | 🟡 |
| Fundamentals | TTM ratios + 5FY statements (~52 names) + sector medians | 🟡 paid depth | 🟡 Pro | 🟡 | 🟡 | 🟡 | 🟡 | ✅ statements |
| Financial statements, free | ✅ | ❌ | 🟡 | ❌ | ❌ | 🟡 | ❌ | ✅ (login) |
| Investor flows (retail/inst/foreign) | ✅ live + history | ❌ | ❌ | ❌ | 🟡 official raw | ❌ | ❌ | ❌ (stub) |
| News archive, bilingual, free | ✅ ~9.9k items | 🟡 | ✅ | ✅ (Arabic) | 🟡 | 🟡 | ❌ | ❌ |
| Alerts, multi-condition, free | ✅ price+RSI+MACD+MA+vol AND-logic, web push | ❌ paid beyond 1–20 | 🟡 | 🟡 | ❌ | 🟡 | ❌ | ❌ |
| Paper trading, free | ✅ EGP 100k, fees, P&L, CSV | ✅ | ❌ | ❌ | ❌ | 🟡 (real) | ❌ | ❌ |
| Agentic AI that executes actions | ✅ (1,000+ free cloud models) | ❌ (AI writes Pine, paid) | 🟡 chatbot Q&A | ❌ | ❌ | ❌ | 🟡 chat analysis | ❌ |
| GCC markets beside EGX | ✅ TASI/DFM/ADX | ✅ (global) | ✅ | ✅ (KSA) | ❌ | ❌ | ❌ | ❌ |
| Arabic-first UI + bilingual | ✅ native | 🟡 translation | 🟡 edition | ✅ | ✅ | ✅ | 🟡 | ✅ (AR only) |
| PWA install / offline shell | ✅ | ❌ | 🟡 | ❌ app | ✅ app | ✅ app | ❌ | ❌ |
| Zero login for everything | ✅ | 🟡 (community login) | 🟡 | ❌ | 🟡 | ❌ (brokerage) | ❌ | ❌ |
| Real-time quotes | ❌ ~15-min delayed | 🟡 paid RT | 🟡 paid RT | ✅ | ✅ official | ✅ | 🟡 | 🟡 |
| Community/social | ❌ | ✅ ideas | 🟡 | 🟡 | ❌ | 🟡 | ❌ | ❌ |

---

## 6. Deep Dive: The Signals Space (our headline battleground)

The product ask — *signals based on technical AND fundamental analysis* — lands in a market where:

- **TradingView** shows *technical-only* oscillator/MA aggregates per symbol ("Sell 7 · Neutral
  7 · Buy 6") and gates the useful alerting (multi-condition alerts start at Plus, ~$24.95/mo).
- **Investing.com** wraps technical aggregates plus analyst targets; its differentiated
  "Fair Value" (15+ models) is InvestingPro-only.
- **Mubasher Smart Signals** sells analyst-generated BUY/SELL/HOLD on EGX/Saudi — opaque weights,
  paid, no self-serve exploration.
- **Danelfin-style AI ratings** are global-only and paid.
- **Nobody** publishes a *free, whole-market, formula-transparent TA+FA composite* for EGX.

**Our engine (v2.22)** answers precisely: per stock, a Technical half (the same 13-indicator
aggregate as our chart panel: SMA20/50/200, EMA20/50/100, RSI-14, Stoch %K/%D, MACD hist, CCI-20,
Momentum-10, Williams %R, BBPower — score −1…+1) and a Fundamental half computed **only from
reported scanner fields**: Valuation (P/E and P/B vs *sector medians*, log₂-ratio, loss-makers
penalized; weight .40), Quality (ROE anchored 8%→0/25%→+1, net margin 10%→0/25%→+1, debt/equity
1.2→0; weight .35), Income (dividend yield 10%→+1/0%→−0.4, payout sanity >100%→−0.8; weight .25).
Composite = **55% TA + 45% FA**, null-safe per component (a stock with <2 fundamental components
falls back honestly to technical-only), every reason line is a real number ("P/E 6.4 vs sector
7.6"), and the same math feeds the ranked table, the XLSX export, the AI-signals evidence pack,
and the agent's `technicals` tool. Sector medians come from the live universe itself (≥5 names,
else market-wide). This is *inspectable* signal construction — the anti-Mubasher.

---

## 7. Where EGX Desk Leads (evidence)

1. **Free composite TA+FA engine over the whole universe** — §6; no rival ships it free for EGX.
2. **Agentic AI, 1,000+ free cloud models** — the assistant *operates* the desk (20 tools:
   navigate, quote, watch, alert, paper-trade, switch language…) with GLM-5.3 default; the
   Instant router works with zero network. TradingView's AI writes Pine scripts for paid users;
   nobody's AI drives the product.
3. **Investor flows** — the live official-category table + growing history, which even esthmr
   ships as an empty stub and global platforms ignore entirely.
4. **Zero-login everything** — quotes, statements, alerts, paper trading, AI; esthmr gates live
   data, Mubasher gates the app, Thndr gates behind brokerage.
5. **Arabic-first AND full English** with ~841 bilingual UI keys, RTL-correct layouts, Arabic
   search normalization — TradingView/Investing are translation-tier Arabic, not native.
6. **Free depth**: full statements (via stockanalysis.com), 9.9k-article archive, dividends,
   insider transactions, hourly AI desk reports during the session, XLSX/CSV exports with
   methodology sheets, PWA with shortcuts and offline shell.
7. **Honesty engineering**: every panel labels its source and delay; milestone-fallback charts
   for the 86 history-less names are explained, never faked.

## 8. Gap Analysis (what we still miss)

| # | Gap | Who has it | Effort | Impact |
|---|---|---|---|---|
| 1 | Real-time quotes (~15-min delay today) | EGX app, Mubasher, Thndr | L (feed deal) | High for traders |
| 2 | Multi-year fundamental history (we: 5FY+TTM) | StockAnalysis (10–40y) | S–M | Medium |
| 3 | Fair-value models (DCF/multiples) | InvestingPro (15+), SimplyWallSt | M | Medium-high for fundamentalists |
| 4 | Intraday 1m/5m charts | TradingView, Investing | M | Medium |
| 5 | Community/social per ticker | TradingView ideas, Stocktwits | M–L | Retention |
| 6 | Brokerage/portfolio import (CSV/API) | Thndr, Yahoo | S–M | High (real users track real books) |
| 7 | App-store presence (native wrappers) | All local rivals | S (TWA/Capacitor) | Distribution |
| 8 | Public signal track record page | Danelfin (published returns) | S–M | Trust moat |
| 9 | Multi-year index history (3mo→) | TradingView | M | Medium |
| 10 | SEO footprint / per-ticker landing pages | Everyone | S–M | Traffic |

## 9. Strategic Position & Prioritized Roadmap

**Positioning statement:** *The free, Arabic-first, AI-native research desk for the Egyptian
Exchange — every number sourced, every method inspectable, no login, no paywall.*

**SWOT** — *Strengths:* §7 (signal engine, agentic AI, flows, honesty, bilingual, zero-login).
*Weaknesses:* delayed data, brand unknown, single-maintainer velocity, no community.
*Opportunities:* 123k new retail investors/half-year with no free Arabic desk; EGX's own app is
a terminal not a desk; rivals paywall intelligence; Puter-class free cloud AI removes model costs.
*Threats:* a funded rival (Stockastic-class) copying the composite engine; upstream free feeds
tightening (Yahoo/TradingView scanner policy); regulatory data licensing.

**Wave 1 — Prove it publicly (weeks):**
1. Signal track-record page: persist every daily composite snapshot, render historical ratings
   vs forward returns (Danelfin-style transparency; nobody in EGX shows this).
2. Per-ticker SEO landing routes (`/stock/COMI`) with SSR quote/meta + sitemap.
3. Brokerage/portfolio CSV import into the paper/portfolio tools.
4. TWA store wrapper to publish the PWA on Google Play (cheap distribution vs native rebuilds).
5. Multi-year index history via EGXBot archive deep-backfill (free, verified source).

**Wave 2 — Lock retention (1–2 months):**
6. Fair-value layer: transparent multiples model (sector-median P/E·P/B re-rating bands) on top
   of the pillar engine — "our" answer to InvestingPro, weights published.
7. Telegram/WhatsApp alert bot beside web push (Egypt's channels).
8. Arabic AI morning brief (auto-generated, shared-compute, free) — daily habit loop.
9. Intraday 1m/5m for the EGX30 names where free feeds allow; honest elsewhere.

**Wave 3 — Scale (quarter+):**
10. Real-time feed partnership (EGX data vendor / broker reseller) — the single biggest UX jump.
11. Moderated per-ticker notes (community lite) with reputational gating.
12. Public API tier + embeddable widgets for the Egyptian fintech ecosystem.

## 10. Sources

TradingView plan pages & 2026 reviews (tradingview.com; stockbrokers.com 19 Aug 2026; supa.is
4 Mar 2026; tickerly.net; friendofthetrend.com 6 Jun 2026) · InvestingPro Fair Value
(investing.com 17 Apr 2024; matchmybroker.com 4 Aug 2026; investing-support.com 8 Aug 2026;
strike.money 14 Jan 2026) · Koyfin pricing (koyfin.com; capterra; financialmodelshub 27 Jan 2026)
· Finviz Elite (finviz.com; mavericktrading 31 Oct 2025; bullishbears 4 Sep 2026) ·
StockAnalysis Pro (stockanalysis.com; wallstreetsurvivor 19 Apr 2026; ryanoconnellfinance) ·
Simply Wall St (simplywall.st) · Mubasher Smart Signals (Google Play 22 Jul 2026; App Store) ·
EGX official app & statements (play.google.com 23 Nov 2025; egx.com.eg; businessfront 1 Sep 2025)
· Thndr (thndr.app 14 May 2026; play.google.com 8 Jun 2026; App Store) · Argaam (argaam.com
28 Jun 2026) · Stockastic (stockastic.app) · EGX market (egx.com.eg; tradingeconomics 10 Sep
2026; afrivestia 1 Apr 2026; amwalalghad 16 Jul 2025) · Danelfin (danelfin.com) ·
Stocktwits (apps; Wikipedia) · paper trading (tradingview.com; schwab.com; webull.com;
stockbrokers.com) · internal verification logs: `scripts/research/RESEARCH.md`,
`scripts/research/GAP-ANALYSIS.md`, `worklog.md` Tasks 1–30.

## 11. T36 Addendum — Free-LLM Infrastructure Audit (Sept 2026)

**Context:** the Puter sign-in popup (our 1,008-model gateway) can be blocked
by popup blockers, Cloudflare Turnstile, or corporate networks. We audited the
free-LLM-API landscape (awesome-freellm-apis' 31-provider directory, no-cost-ai,
MetaAI-Hermes, freegenius, free-deep-research, trading-skills) and live-probed
every keyless candidate to know exactly what works without any sign-in.

**Live-probe results (agent-sized prompts, real stock questions):**

| Provider | Keyless? | Result |
|---|---|---|
| **LLM7.io anonymous tier** | ✅ zero auth | **WORKS** — Codestral (~4.5s, exact numbers), Mistral Nemo (~3.6s, qualitative), MiniMax M2.7 (slower, strong Arabic). 10 RPM / 60 req/h shared pool, SSE streaming, 128K-262K contexts |
| OVHcloud AI Endpoints | ✅ on paper | 429 on every probe — the anonymous 2 RPM pool is globally saturated |
| Pollinations.ai | ✅ on paper | budget-gated even anonymously; catalog shrank to one model (dead for real prompts) |
| z-ai gateway | ✅ (our server) | serves GLM-4-Plus only, regardless of requested id — one honest model |
| g4f.dev / HackClub / Gaia | ✅ on paper | unreachable / 404 / dead |
| Groq, Gemini, Mistral, Cerebras, HF, OpenRouter free tiers | ❌ need a free API key | strong but require sign-ups + key management — not "open the app and it works" |
| Puter cloud | free sign-in | 1,008 real models (catalog verified live); the sign-in itself is the single point of failure |
| MetaAI-Hermes / free2gpt / netfly scrapers | cookie/reverse-eng | fragile, unofficial, ToS-risk — rejected |

**What we shipped (v2.26):** a third model family in the agent — **Keyless
cloud (LLM7)**: Codestral, Mistral Nemo, MiniMax M2.7 routed server-side
through the same SSE loop (no CORS constraints, same strict-JSON tool
protocol, 429 backoff, honest served-model reporting). These work with ZERO
sign-in — the answer to "Puter can't be signed in". Plus a duplicate-tool-call
guard (small models used to loop the same tool 10× — now nudged to synthesize)
and a numbers-are-exact rule in the shared system prompt.

**Strategic read:** EGX Desk now has three resilience tiers for AI: (1) the
app's own server model, (2) keyless third-party cloud, (3) the 1,008-model
Puter catalog. No free EGX competitor ships an in-app AI agent at all, let
alone with model choice. The next infrastructure upgrades worth considering:
a free LLM7 API key (unlocks their 47-model premium ladder server-side),
Groq/Gemini free-tier BYOK ("bring your own key" settings row), and a
WebLLM WASM fallback for offline-only users (explicitly out of scope so far).
