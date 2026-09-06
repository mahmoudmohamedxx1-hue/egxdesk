# Deep Gap Analysis — esthmr.com vs EGX Desk (2026-09-07)

*Method: fresh browser audit of esthmr.com (all views, signed-out shell; authenticated
data model documented earlier in Task 1; session re-login now blocked — the site
rejects disposable emails), line-by-line comparison against our code, plus live
data-source probes for every gap (results inline).*

## What we MISS — feature blocks esthmr has and we don't

### 1. Company financial statements & analysis tab  ❌ no free source
esthmr company view has a 2nd tab "القوائم والتحليل" (5 financial periods):
- Per-period income statement (revenues, gross, operating, net)
- Balance sheet (assets, liabilities, equity, loans ST/LT, cash)
- Cash flow (operating, investing, financing, net change in cash)
- Matching-period comparison (FY vs FY only, never H1 vs FY)
- Debt structure panel (due-within-year %, coverage = op profit ÷ finance cost,
  leverage = loans ÷ equity, net loans)
- Source: EGX filed documents ("من أين جاءت هذه الأرقام")

**Probes:** Yahoo quoteSummary for .CA symbols → "No fundamentals data found"
(verified COMI, TMGH — crumb flow works, data absent). TradingView scanner
historical-period columns (`total_revenue__FY__2024` etc.) → null. EGX official
→ unreachable. **Verdict: blocked as a full statements table**, but the key
*RATIOS* are available today from the TradingView scanner (see #5) — verified
live for COMI: P/B 2.03, D/E 0.346, ROE 34.4%, net debt −109.7bn, payout ratio,
gross margin, employees 8,665, next earnings date.

### 2. Company disclosures archive tab  ❌ blocked
esthmr's 3rd company tab lists every filed document (financial statements, AGM
invitations, dividend disclosures) with dates + document links. EGX official
disclosure archive is unreachable from this network; Mubasher 403. Our
related-news (Arabic alias matching) partially covers major filings as articles.
**Verdict: not implementable as a structured archive from here.**

### 3. Signals engine  ⚠️ partial (buildable "lite")
esthmr auto-computes and surfaces signals on home + company pages:
- Pattern break (e.g. "first down session after 5 up sessions")
- Loan movement (short-term loans vs prior balance sheet)
- Expected filings (next disclosure date estimated from filing history)
- Silence ("company filed no closing price in last 4 sessions")
- Unusual volume (we HAVE this — activity view)
**Probes:** streaks computable from our Yahoo price history ✓; next earnings date
available from TradingView `earnings_release_date` ✓ (epoch returned); loan
movement + silence need the disclosure feed ✗. **Verdict: signals-lite buildable.**

### 4. Exchange & economy view (البورصة والاقتصاد)  ✅ buildable
We redirect `?view=exchange` → home. esthmr has a dedicated view: indices +
traded value + **five EGP FX rates** (last reading) + economic-indicators
section ("مؤشرات الاقتصاد بلغة واضحة" — empty even in their demo).
**Probes:** open.er-api.com free, no key: USD/EGP 50.94 (SAR, EUR, GBP, AED
present, daily) ✓. api.gold-api.com: XAU $4,431/oz live ✓ → EGP per gram
computable. CBE site blocked (request rejected). **Verdict: real FX + gold +
traded-value panel buildable; economic indicators need a news-derived source.**

### 5. Ranking & comparison metrics  ✅ easy win (data verified today)
esthmr's "الترتيب والمقارنة" ranks by market cap / share price / **dividend
yield** / **annual net profit** / **debt-to-equity**, each with a
"قارنه مع" compare-against second metric. We only rank market cap / price /
change / P/E.
**Probe:** TradingView scanner returns populated values for EGX: `price_book_fq`,
`debt_to_equity`, `return_on_equity`, `net_income_ttm`, `dividends_yield_current`,
`dividend_payout_ratio_ttm`, `gross_margin_ttm`, `revenue_growth_quarterly`,
`net_debt`, `total_current_assets`, `number_of_employees`, `float_shares_outstanding`,
`earnings_release_date`. **Verdict: add columns to our existing fetch — 8 new
ranking metrics + P/B across the app.**

### 6. Sector cards fundamentals  ✅ easy win (same data)
esthmr sector cards show **median P/E, median P/B, dividend yield, biggest
mover**. Ours show count / up-down / cap / value / turnover leader / biggest
mover + 2 charts (no P/E, no P/B, no yield). Same TradingView columns fill all
three.

### 7. Tools view: comparison calculator + glossary  ✅ trivial
esthmr tools adds: amount presets (50k/100k/250k/500k), monthly-equivalent
income, **payback period**, and a **stocks-vs-bank-vs-gold comparison**
(assumed 28% / 23.5% / 25%, 1Y and 3Y compounding) + a **plain-Arabic
glossary** (P/E, P/B, ROE, earnings quality). We have the base coupon calc only.

### 8. 1W price-chart range  ✅ trivial
esthmr: 1W/1M/3M/1Y/5Y. Ours: 1M/3M/6M/1Y/5Y. Yahoo 5d candles work.

### 9. "Behind the market move" (وراء حركة السوق)  ✅ easy win
esthmr home summarizes which investor categories moved the market, linking to
the investors view. We already HAVE the live flows table — just surface a
compact net-flow summary + retail-vs-inst split on home.

### 10. Arabic company names  ⚠️ hand-curation only
esthmr lists Arabic names; we show English (documented decision — no reliable
free source). Sigma Arabic variant unreachable; EGX official unreachable. Our
news alias map already holds Arabic brand names for ~top tickers — could be
extended into a curated ticker→Arabic-name map.

### 11. Arabic search normalization  ⚠️ minor
esthmr normalizes Arabic spelling (أ إ آ ٱ ← ا، ة ← ه، ى ئ ← ي، ؤ ← و, strips
diacritics). Our search is English-only — cheap to add if/when Arabic names land.

### 12. Company brief paragraph (نبذة)  ⚠️ auto-generate option
esthmr builds Arabic briefs from filings. No free source; a data-driven
auto-brief (sector, cap, employees, ROE, yield, streaks) is a decent stopgap.

### 13. News polish  ⚠️ partial
esthmr items carry: financial-impact annotation, publisher logo, 🔊 listen,
disclosure items interleaved, source-details expander. We have publisher name,
categories chips, TTS, related news. Impact chip could show the mentioned
company's session move (alias matcher exists).

## Where our data is thinner
- **Index history**: ~3 months real (98-day EGXBot backfill) vs esthmr's
  longer-run series. No free multi-year EGX index source found (Yahoo index
  symbols carry ~1 point).
- **News depth**: ~10 weeks / 9,002 items (WP REST backfill). One config number
  raises coverage (page cap + target window) if 6–12 months wanted.
- **Watchlist**: localStorage only (deliberate — user removed auth); esthmr
  syncs via account.

## Where we LEAD esthmr
1. **Investor flows**: live real table + history + 4 charts — esthmr's investors
   view is an empty stub ("لم يُنشر شيء لهذا بعد").
2. **News archive**: 9,002 real articles, newest→oldest, paginated.
3. **Zero login**: everything live without an account (esthmr gates live data
   behind email+OTP; signed-out users see a fictional demo market).
4. **Live UX**: 60s polling, market-status clock, real performance horizons
   (1W–5Y) + beta + 52w-range position per company.

## Priority plan
- **P1 (easy, verified data):** #5 #6 (extended TV columns + ranking + sector
  medians), #7 (tools calc + glossary), #8 (1W range), #9 (home flows summary),
  #4 (exchange view with FX/gold/traded value).
- **P2 (medium):** #3 signals-lite (streaks + TV earnings date + per-company
  unusual volume), #12 auto-brief, #13 impact chips, news depth → 6 months.
- **P3 (blocked/hard):** #1 full statements, #2 disclosures archive, #10/#11
  Arabic names + normalization (curation).
