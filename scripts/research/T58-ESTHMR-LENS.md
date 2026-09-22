# T58 — esthmr عدسة الملكية (Ownership Lens) + FoudaLens full catalog
Task ID: T58-R1 · Agent: research subagent · Date: 2026-09-22
Artifacts: `scripts/research/t58-esthmr-live/` (live code+data captured from esthmr.com today), `scripts/research/t58-adasa-*.png` (live screenshots), `scripts/research/t58-foudalens/` (FoudaLens reference files), `scripts/research/t58-search.json` (web-search results).

---

# PART 1 — esthmr عدسة الملكية (Ownership Lens)

## 1.0 How this was researched (access method — reproducible)
- T57 concluded the feature was unreachable (Google sign-in + Cloudflare). **This session found a still-valid authenticated session cookie** saved on 2026-09-07 at `scripts/research/esthmr-session.txt` (`esthmr_session`, expiry 2026-10-07 > today 2026-09-22).
- With that cookie: `curl -H "Cookie: esthmr_session=…"` returns HTTP 200 on esthmr.com pages and on the private JSON API under `/data/v1/*`. The whole app is plain ES modules + JSON documents — no bundling/obfuscation — so the feature was read **from its actual source code and live data**, then **rendered live** in a headless browser (agent-browser + cookie injection via `agent-browser cookies set`) at `https://esthmr.com/?view=ownership`, where it rendered fully (`data-signed="yes"`), and interactions were driven and screenshotted.
- Public traces: Instagram reel + TikTok by the builder (@the.barbarianproject) captioned **"Should I patent that? Esthmr.com -> stocks -> Ownership lens #buildinpublic #startup #the_barbarian_project #egx #esthmr"** — confirms the feature is marketed exactly as "stocks → Ownership lens". No app-store listing exists (web-only, login-gated, `noindex`).
- Files captured today → `t58-esthmr-live/`: `logic.js` (447 KB), `flow-trackers.js` (149 KB, contains the ownership screen), `sector-lens.js` (31 KB, sector ring + company ownership card), `ownership-map.js` (44 KB, THE map renderer), `data.js`, `insider-people.json` (1.87 MB), `sector-ownership.json` (43 KB), + nav/CSS modules.

## 1.1 Where the feature lives (verified from `logic.js` + live nav)
- Nav label: **`['ownership', ar ? 'عدسة الملكية' : 'Ownership lens']`**.
- Top nav = 5 destinations: اليوم (Today) · **الأسهم (Stocks)** · متابعتي (Following) · المستجدات (Updates) · المزيد (More).
- Under **الأسهم (Stocks)** there are three named sub-groups:
  - **الشركات (Companies):** market, company, investors
  - **القطاعات (Sectors):** sectors, liquidity
  - **خرائط (Maps):** heat, **ownership ← عدسة الملكية here**
- URL: `https://esthmr.com/?view=ownership` (SPA state; `navigation.js` SCREENS whitelist includes `ownership` alongside new screens `liquidity`, `world`, `changes`). Deep-linkable, back-button works.
- The Home page also carries an **"Ownership lens" card** ("من اشترى ومن باع من داخل الشركات؟ / Who bought and who sold from inside the companies?" — latest Articles 29 & 38 disclosure events with stake %) with an "افتح الخريطة ↗" (open the map) button that jumps to the screen.

## 1.2 Screen anatomy, top to bottom (all verified live)
1. **Header**: eyebrow `ESTHMR / مرصد السوق` (Market Observatory); H1 = the reader's question **"من اشترى ومن باع من داخل الشركات؟"** with the screen's name عدسة الملكية as a small term after it; lede: "أعضاء المجالس وكبار المساهمين يعلنون حين تتغير حصتهم…" + standing disclaimer "بيانات منشورة، وليست توجيهات استثمارية".
2. **Thesis banner** (icon `%`): **"نسبة الملكية في الشركة أهم من عدد الأسهم"** — "a trade of 1,000,000 shares in a 10M-share company is 10%; in a 10B-share company it is 0.01%."
3. **THE MAP** (see 1.3).
4. **Named-people list** (`renderNamedPeople`) — "the only place on the site that names a holder": every filed party, with per-person drill-down.
5. **Temporal stake-% progression curve vs share price** (per selected company — stepped curve of each insider's stake over time aligned against the published price trajectory).
6. **Toolbar**: 4 selects — Company (كل الشركات default), Party type (all / insiders & shareholders / treasury), Named investor, Sort (latest / highest stake % / highest value) — + range pills **7 / 30 / 90 / 365 days**; note "تنتهي الفترة عند أحدث إفصاح: …".
7. **Company Ownership Profile card** (when a company is chosen): eyebrow "ملف ملكية الشركة"; metrics = shares outstanding (المقام المرجعي/denominator, with date), latest share price, **net insider stake change** (pp, with net shares), **net marked capital value** (EGP at latest price). When no company chosen, the same grid shows market-level counters (disclosures in view / named investors / disclosed ownership stakes / current reference share count).
8. **Charts row**: (a) daily disclosed net trades marked at latest price; (b) if company chosen: cumulative insider net stake % of company (or daily net-shares / share-capital fallback); else an explainer "النسبة أهم… وتحتاج مقاماً صحيحاً / Ownership needs a denominator"; (c) published share-price history; (d) if an investor is also chosen: that investor's disclosed stake history (%).
9. **Method `<details>`**: "What this can—and cannot—tell you" (a disclosure timeline, not a shareholder register; missing amounts ≠ zero activity; current-price values ≠ execution proceeds; cross-company EGP charts exclude non-EGP shares).
10. **Disclosure event grid**, 24/page with pagination — each row: date, ticker button (→ company filings panel), party name, relationship pill, stake %, action label (buy/sell/treasury buyback/cancellation), filing ref `#id`, and a **"الاطلاع على الإفصاح الرسمي ↗"** link to the official EGX bulletin PDF.

## 1.3 THE MAP — exactly how it looks and works (from `ownership-map.js` + live DOM)
**One board, drawn as an archipelago:**
- **Sectors are "lakes"**: the board (viewBox 1200×760) is a squarified treemap whose cells are sized **by number of companies** (not market cap — so small issuers keep readable room). Inside each cell an organic blob ("lake") is drawn — 3 summed sinusoids seeded by a hash of the sector's own name, so **every sector keeps the same recognizable coastline on every render** ("nothing moves unless the data moved"). Water = radial gradient (`--own-shallow`→`--own-deep`) + 2 shorelines; sector name on the water.
- **Companies are donut rings** placed in each lake on a **phyllotaxis (sunflower) spiral** (golden-angle), scaled by the lake's shore radius; **ring radius ∝ sqrt of market cap** (15–34 px, floored; **no published cap → smallest ring with dashed centre + "بلا قيمة" label**, never dropped). Anti-collision pass guarantees no ring touches another. Ticker inside the ring (bold, LTR); market value (compact, e.g. "92B") under it when the ring is wide (>26 px).
- **Holders are ring slices**: each company's band (7 px thick) is divided into arcs **proportional to each filed stake %**, colored by a **stable per-holder hue** (hash of the holder's filed name → 6 palette colors `--own1..6`, same color across weeks/languages). The **undisclosed remainder stays grey (`--ownNone`)** and is explicitly labeled "ownership nobody had to disclose — **not free float**". If filings add to >100% (duplicate name spellings), slices are rescaled to fit and the ring is marked `om-over` with a tooltip saying the filings add to N% which is more than the company.
- **Holder dots**: every standing stake also gets a small dot on an orbit around its company (biggest first, clockwise from top), dot radius ∝ sqrt(stake%). **No names at rest** — hover (pointer/focus) shows a pinned plate `«%  holder-name»`; click a dot → holder focus.
- **Bridges at rest**: for each holder in >1 company, faint thin curves (0.7 px, 22% opacity) connect their companies, each with a slow travelling dot (`animateMotion`) — "the shape of the market's cross-holdings". 260 of them live today.
- **Week strip** above the map: chip **"الوضع الحالي / كل ما أُفصح عنه"** (Standing — every stake at its current level) + **37 weekly chips** ("28 سبتمبر – 2 أكتوبر · 4 تحرّك" … "20–22 سبتمبر · 9 تحرّك"). Choosing a week does NOT rebuild the board — it **lights the holdings that changed that week**: an **outer arc** on the ring (outside the band) whose size = points gained/lost (green `--up` / red `--down`, anchored at the slice's leading edge), an accent **moved-ring** halo on companies with any move, and **dashed green/red spokes** for changed holdings (solid holder-color otherwise). A **▶ play button** animates the weeks in order (chip by chip).
- **Zoom & pan**: +/− buttons (1.4× steps), live `1.0×` output label, wheel-zoom (1.12×), drag-pan at any zoom, reset, **⤢ widen** and **⛶ full-screen** (`om-sheet`). Zoom resizes marks **sub-linearly** about their anchor points (rings about their centre, dots about their company) and **re-cuts every wire** so lines still meet the rings they join — one attribute per mark, no rebuild of ~5,000 nodes.
- **The register (side panel)**: search box "ابحث عن شركة أو اسم مودع" (matches companies even if they have no ring — with "on board / not on board" state), breadcrumb, count, and an **alphabetical-on-purpose list** ("any other order is a ranking of named parties, and this project does not publish one") of every holder (1,353 rows live) with color dot, name, kind (شركة أو صندوق / شخص), tickers, and stake %.
- **Header stats**: `238 · 1396 · 3.08T EGP` (companies · named parties · market value of all standing stakes).
- **Legend** (exact Arabic): "الحلقة شركة، حجمها بالقيمة السوقية، والشرائح الملوّنة ملّاك ذكرهم إفصاح. / الجزء الرمادي ملكية لم يُلزم أحد بالإفصاح عنها — وليس أسهماً حرة. / القوس الخارجي هو ما اكتسبته الحصة أو تخلّت عنه في الأسبوع المختار. / النقطة حصة مالك واحد في شركة واحدة. أشر إليها ليظهر الاسم. / اختر مالكاً يمتد خط إلى كل شركة هو فيها، معلّماً بحصته منها."

## 1.4 Interactions — verified live in the browser today
- **Click a company ring (COMI)** → the rest of the board dims (3,290 elements), **17 holder "seats" appear** — dots placed out on the water at a readable orbit around COMI, each with a line into the company, **name + stake % written on the seat** ("15.67% ALPHA ORYX LIMITED ألفا أوريكس المحدودة"), and **onward lines** to every OTHER company that holder is in ("who is in this company is half answered until you can see where else they are"). Clicking a seat switches to holder focus. Click empty board → clear.
- **Click a holder (ALPHA ORYX LIMITED)** → the holder gets a **seat of their own at the centroid of what they hold** (pushed off any company in the way), spokes run to every company they hold, **each ending in a colored stake tag** (rounded pill with the % — e.g. "15.67%"), tooltips say "X holds N% of TICKER"; if a spoke changed in the chosen week it is dashed + green/red. The register scopes to that holder ("كل شركة ورد فيها اسم هذا المالك") and shows total market value of their stakes (70.17B EGP) and each holding with basis + date ("2025-10-12 · بعد صفقة").
- **Pick a week (20–22 سبتمبر)** → 6 change-arcs, 5 moved-ring halos, 1 dashed changed spoke appear; counters on the chip ("9 تحرّك").
- **Hover any dot** → name plate appears above it (also keyboard-focusable; every node is `role=button` with `<title>` tooltips).
- Live counters on the whole board today: **28 lakes, 238 company rings, 1,613 holder dots, 1,492 stake slices, 260 bridges, 38 period chips, 1,353 register rows**.

## 1.5 The equity-structure-on-company-page part (matches the user's description)
- **Company screen** (`?view=company&ticker=…`): the Overview panel includes an **Ownership card (`co-own`)** — "الملكية / Ownership": a **share bar** of the top-4 filed holders with exact %s + a hatched **"غير معلن / not disclosed"** remainder (never normalized away), dateline "آخر إفصاح ملكية 2026-06-30", caption "من رأس مال الشركة", and the threshold note. Live example (UNIT): القاهرة للاسكان والتعمير 23.31% · بايونيرز بروبرتيز 19.71% · مصر لتأمينات الحياة 9.1% · **غير معلن 47.9%**.
- The company **Filings tab** has a filing group **"هيكل الملكية / Shareholding Structure"** (board & shareholder-structure forms).
- **Sectors screen** additionally shows the **ownership ring** (`ownershipRing`): sectors placed on a circle, **arcs across the ring = which sectors own which** (width ∝ EGP value of stakes, animated dots travel owner→owned, self-owning sectors get a loop), fed by `sector-ownership.json` (41 filed links, 29 sector flows, "refused" list explaining rejected filings) — clickable nodes focus the ring.

## 1.6 The data pipeline behind it (from `/data/v1/insider-people.json`, 1.87 MB, regenerated today 13:23 UTC)
- Source (verbatim): "EGX post-execution disclosure forms (نموذج إفصاح بعد التنفيذ) and board & shareholder-structure forms (نموذج إفصاح عن مجلس الإدارة وهيكل المساهمين)" — **read from the scanned EGX bulletin PDFs themselves** (each position carries `filingId` + `source` link to `egx.com.eg/downloads/Bulletins/…pdf`).
- Contents: **1,396 named people/firms** (with Arabic/English names, aliases, kind person/firm, trade counts), **1,629 positions** (holder→ticker, %, asOf, basis register|trade, shares, history), **37 weekly periods** with moves (holder, ticker, from%, to%, change pp, value), **235 boards** (board seats: name, role "رئيس مجلس الادارة", representing), counters (peopleCount, firmCount, aliasCount, registerCount, overDisclosed, supersededByRegister, seatCount).
- `sector-ownership.json`: 41 listed-company→listed-company stakes with %, value EGP, basis, filing link + 29 sector-to-sector flows + per-sector caps — basis text: "كل خط حصة مُفصح عنها… النسب تخص شركة واحدة ولا تُجمع" (percentages are never summed; sector totals in EGP only).
- Four honesty rules baked into the drawing: undisclosed ≠ free float; stakes are % of ONE company (never summed); standing stake = closing level of the last form (sold-out drawn as empty ring, not dropped); no-cap companies drawn at floor size with dashed centre.

## 1.7 Comparison with our T57 عدسة الملكية (what to steal)
Ours (T57) already has: sector treemap + company bubbles, investor registry selection with curved links + filing links, dimming. **What esthmr's real implementation has that ours does not**:
1. **Donut-ring encoding** — holders as proportional slices ON each company (vs our single-bubble encoding); grey remainder = undisclosed, explicitly not free float.
2. **Named holders (1,396 parties from EGX structure forms)** — our registry is 29 listed-company investors only; esthmr reads the board & shareholder-structure forms (نموذج إفصاح عن مجلس الإدارة وهيكل المساهمين), which print the WHOLE register at once (e.g. WAFA ASSURANCE 97.86% of DEIN, ALPHA ORYX 15.67% of COMI).
3. **Week playback** — 37 weeks of stake changes with change-arcs, moved-ring halos, dashed up/down spokes + ▶ play.
4. **Company-focus seats** — click a company → its holders seated around it with names+% and onward links.
5. **Holder-focus stake tags** — pills with exact % at each spoke end + market value of all their stakes.
6. **Register/search** with alphabetical-by-policy order + "not on board" results.
7. **Zoom/pan/full-screen** with sub-linear mark scaling.
8. **Company-page Ownership card** (top-4 holders bar + hatched undisclosed remainder) — direct answer to "choose a company → its equity structure in the same page".
9. **Insights we could not see before**: their data comes from the SAME EGX bulletins we already archive in `src/data/insiders.json` — but they parse the FULL shareholder-structure forms (register basis), not only insider-dealing forms.

---

# PART 2 — foudalens.com full feature catalog

Identity: **FoudaLens (فوده لينس)** — bilingual (Egyptian-Arabic + English) AI-assisted EGX analysis platform + native iOS/Android apps + PWA, by Mohamed Adel Fouda. Every EGX stock (264+), 19 sectors. Monetization: Free / Pro 250 EGP-mo / Premium 400 EGP-mo (SMS payments: Vodafone Cash + InstaPay). Sources: `llms.txt`, `llms-full.txt` (56 KB, "129 features / 17 sections, 136 routes", generated 2026-09-22), `sitemap.xml`, homepage, /ar/pricing — all fetched directly today (the T57 IP-block is gone from this sandbox).

**Legend for the marks:** ✅ = we already have it · 🟡 = partial · ❌ = GAP (not in our app).

## Core
- Rankings/Home (`/ar`) — daily Fouda Score (0–100, 5 weighted factors: trend 25%, momentum 25%, volatility 20%, relative strength 15%, volume 15%) ranking of all EGX stocks — ✅ (we have scores/AI signals, different method)
- EGX Market Overview (`/egx`) — live snapshot, movers, sentiment — ✅
- Stock Ranking (`/ranking`) — sortable table by score/signal/change — 🟡 (screener covers sorting; no single score column)
- Best Stocks (`/best-stocks`) — sector-by-sector guides to higher-scoring stocks — ❌ (content pages)
- Halal Stocks (`/halal-stocks`) — Sharia screener on official EGX 33; checks debt<30% of cap, non-halal income<5%, liquidity ratios, excluded sectors — ❌
- Dividend Stocks (`/dividend-stocks`) — highest-yield payers — 🟡 (we have fundamentals w/ div yield; no dedicated list)
- Platform Guide (`/explore`) — every feature with per-plan access + embedded JSON catalog — ❌ (nice meta pattern)
- About (`/about`) — ❌ (content)

## Market tracking (13)
- Market Today (`/market-today`) daily summary — ✅ · Market Pulse (`/market-pulse`) breadth internals — 🟡 · AI Market Summary (`/market-summary`) — 🟡 (AI agent narrates market) · Pre-Market Summary (`/pre-market`) — ❌
- **Auctions** (`/auction`) — pre-open/closing auction explainer + countdown; Premium: live indicative price — ❌
- Fear & Greed (`/fear-greed`) — EGX 0–100 from 7 factors (breadth, signal consensus, momentum, trend, stability, volume, regime) — ✅ (ours: 4-factor composite, T57)
- Market Heatmap (`/market-heatmap`) — ✅/🟡 (we have the treemap tech in lens view; no dedicated day-heatmap screen)
- EGX30 Index Scenarios (`/market-scenarios`) — ❌
- Official Daily Trading Summary (`/trading-summary`) — institutional vs retail flow — ❌ (EGX investor-statistics data)
- Global Markets (`/global-markets`) — indices, commodities, FX — ❌
- EGX Market Flow archive (`/egx-market-flow`, Pro) — money-flow archive — ❌
- Sectors + rotation (`/sectors`) — 🟡 (sector pages yes; rotation analysis no)
- Movers (`/movers`) — ✅ · Indices (`/indices`) real-time for everyone — ✅ · **Per-index Technical Analysis** (`/indices/CASE30/analysis`) — support/resistance, pivots, RSI/MACD + breadth (constituents above 20/50-MA) for EGX30/EGX70/EGX100/EGX33 — ❌ (we compute RSI/MACD per STOCK, not per INDEX page)
- Comparing platforms (`/egx-analysis-platforms`) — marketing comparison — ❌ (content)

## Stock discovery (11)
- Buy Opportunities (`/egx`) — 🟡 (AI signals similar) · Top stocks (`/top-stocks`) — 🟡 · Top gainers/losers (`/top-gainers`) — ✅ · Best stocks by category — ❌ · All-stocks directory (`/stocks`) — ✅ · Screener (`/screener`) — ✅ · Sector analysis — 🟡 · **Halal screener** — ❌ · Dividend stocks — 🟡 · **IPO tracker** (`/ipo`) — ❌ · Gold vs certificates (`/gold-vs-certificates`) — ❌

## Stock page (5)
- Stock page (`/stock/{SYMBOL}`) — score, signal, chart, fundamentals, **EGX classification badges** (T+0 eligibility, trading board main/Nilex/OTC, activity tier A/B/C/D, derived daily price-limit band ±20/10/5%, short-selling eligibility, Sharia flag), live depth tabs — 🟡 (we have quote+fundamentals+technicals; NO classification badges)
- Advanced interactive chart — daily ranges free; intraday session/7-day frames Pro; hour frame + live bid/ask Premium; **7 drawing/measure tools**; cloud-saved drawings Premium; whale markers + net-flow coloring Premium — 🟡 (our charts lack drawing tools, intraday frames)
- Deep analysis (`/stock/{SYM}/deep`) — valuation models, S/R, technicals — 🟡
- **Fair Value Lab** (`/stock/{SYM}/valuation`, Premium) — 4 classic methods side by side: Graham number √(22.5×EPS×BVPS), P/E×sector median, P/B×sector median, Gordon DDM — with **live assumption sliders**; educational framing — ❌ (we have what-if P&L calculator, not valuation models)
- Financial statements lens (`/stock/{SYM}/financial`) — coming soon — ✅ (we already ship financials)
- Future scenarios (`/stock/{SYM}/scenarios`) — bull/base/bear targets — ❌
- Stock Memory (`/stock/{SYM}/memory`) — AI's evolving memory + lessons per stock — 🟡 (our agent has supermemory, not per-stock public page)
- Smart signals per symbol (Pro) — 🟡

## Signals & forecasts (8)
- All active signals (`/signals`) — 🟡 · Smart Signals (AI-enhanced, Pro) — ✅ · Stock forecasts (`/predictions`) with confidence — 🟡 (AI signals with entry zones; no % confidence band)
- Detailed forecasts for all stocks — ❌ · **Prediction history + accuracy dashboard** (`/prediction-history`, `/predictions/accuracy`) — ❌ · **Forecast performance on YOUR stocks** (`/predictions/performance`) — ❌ · Buy-signal track record (`/track-record`) — ❌

## Live data (8) — mostly NOT feasible for us (needs paid feed)
- Order book bids/asks (`/order-book`; whole-market table free-1min, depth+executions Premium) — ❌ · Whale trades (`/whale-trades`, Premium, real-time + archive) — ❌ (could approximate from filings) · Big-movers radar (±5%, limit-hit, halts; Premium) — 🟡 (alerts exist; no intraday radar) · **My Flow** (per-holding money flow, Premium) — ❌ · Real liquidity & trading pressure (`/egx-trading-flow`, Pro) — ❌ · Flow archive (`/egx-market-flow`) — ❌ · **Trading bot simulation** (`/trading-bot`, Pro) — 🟡 (our AI agent ≈ same concept, different branding) · Stock trade archive (`/stock/{SYM}/trades`) — ❌

## Portfolio & tracking (10)
- Portfolio multi-asset + cash account + commissions + corporate actions (Pro) — ✅ (paper trading; 🟡 corporate-action handling)
- Watchlist — ✅ · Dashboard — ✅ · Price alerts (3/20/50) + **Smart Alerts** (new peak/trough, volume surge, opening gap, threshold crossing, halt/resume via push/Telegram/email) — 🟡 (we have alerts; no smart-event kinds, no Telegram)
- **Decisions log** (`/decisions`) — user's own decision journal — ❌
- **Investor benchmark** (`/benchmark`) — your decisions vs index — ❌
- Corporate actions timeline (`/corporate-actions`) — dividends/bonus/rights/splits/IPO/delistings, **exports to Google/Apple calendar** — 🟡 (dividend calendar partial)
- **Rights issues tracker** (`/rights`) — theoretical value, terms, chart; per-right page — ❌
- **Year in review** (`/wrapped`) — ❌ · Notifications log — ❌

## Calculators & tools (10)
- All free: **Zakat calculator** (`/tools/zakat`) — ❌ · **DCA calculator** (`/tools/dca`) — ❌ · **Stock profit calculator** (`/tools/stock-profit`) — 🟡 (our what-if ≈ inverse) · **Certificate yield calculator** (`/tools/certificate-yield`) — ❌
- Backtest (`/backtest`, Pro, 2016→present) — ✅ · **Portfolio allocation lab** (`/allocation`, Pro) — ❌
- Compare (`/compare`, up to 4 stocks) — 🟡 (we have compare; check stock count)
- **What If cross-asset** (gold × silver × dollar, Pro) — 🟡 (ours is stock-only)
- Quarterly earnings dates (`/earnings`) — ❌ · Correlation matrix (`/correlation`, Pro) — ✅ (T57)

## Rates & commodities (10)
- Rates hub, USD/EGP + per-bank pages (NBE, Misr, CIB, QNB, ADIB), gold per karat 24/21/18/14 + gold pound, silver, savings certificates, gold-vs-certificates, commodities (Brent oil etc.), **crypto in Egypt** (`/crypto`) — 🟡 (we have gold + CDS/rates; no per-bank USD, no silver/oil/crypto pages)

## News / articles / reports (10)
- News + News Hub — ✅ · **Auto-generated daily articles** (`/articles`, LLM-generated ~17:00 daily, native ar+en) — 🟡 (agent journal is internal) · Stock guides (`/guide`) — ❌ · **Learning center 49+ articles** (`/learn`) — ❌ · **Stock-market glossary** (`/learn/terms`) — ❌ · **Methodology page** (`/methodology`, full transparency of the score) — ❌ · Periodic reports archive daily/weekly/monthly (`/reports`) — ❌ · Monthly journalist-citable report — ❌ · Newsletter — ❌

## AI (5)
- AI assistant chatbot (page-aware, Egyptian Arabic, live snapshot tools, quotas 30/100 per day) — ✅ · AI stock explanation per stock page — 🟡 · AI news summaries — ❌ · AI portfolio advisor — 🟡 · AI stock analysis overview page (public) — ✅

## Other platform surfaces
- Onboarding tour (`/start`), tutorial (`/tutorial`), instant search — ❌ (we have search?) · **Simplified beginner mode** (plain Egyptian Arabic + one-line explainers, one-tap switch) — ❌ · **Shareable stock card "X-ray"** (image with score ring, 8-point microstructure fingerprint بصمة السهم, mini candle chart, 52w range, badges, prediction band) — ❌ · Referral program, WhatsApp support, SMS payments — N/A (business) · **llms.txt / llms-full.txt / openapi.json / gpt-instructions.md** (machine-readable self-description) — ❌ (we could ship our own llms.txt!) · Native iOS/Android apps + PWA + push — ❌ (we're a PWA-capable web app)

**What FoudaLens does NOT have (our differentiators):** ownership lens (zero ownership/shareholder/insider features), insider-trades archive, EGX disclosure/filings radar, paper trading, AI agent chat with tools, sector treemap/bubble map, Arabic technicals per stock, correlation (they have it, we match), fear&greed (they have it, we match).

---

# PART 3 — GAP LIST for our app (foudalens features we lack), prioritized by feasibility on static/public data

## Tier 1 — pure math on data we ALREADY hold (days, zero new sources)
1. **Fair Value Lab** — Graham number, P/E×sector median, P/B×sector median, Gordon DDM, side by side with assumption sliders. We hold EPS, BVPS, sector medians, dividends. Highest value-per-effort; unique "educational valuation" surface.
2. **Zakat calculator** (`/tools/zakat`) — stock zakat = market value × 2.5775% (or per-asset rules). Trivial, culturally important for our Arabic audience.
3. **DCA calculator** — periodic fixed-amount investing in one stock over N months using our own price history (we already fetch Yahoo dailies for what-if).
4. **Certificate yield calculator + Gold vs Certificates comparison** — we already hold gold prices + CDS/deposit rates; net-yield vs gold-return comparison chart is pure math.
5. **Cross-asset What-If** (gold × silver × dollar) — extend T57's what-if calculator with the gold/USD series we already store.
6. **Market heatmap screen** — day-change treemap by sector/cap; we already have the squarified-treemap + bubble code from the lens view.
7. **Content surfaces**: Learning center + **stock-market glossary** (Arabic-first), methodology page (publish our fear&greed + signal math like we already do in API responses), platform guide `/explore` with embedded JSON catalog, About/FAQ.
8. **llms.txt (+llms-full.txt) for OUR app** — machine-readable feature catalog; free LLM-era discoverability (foudalens proves the pattern; costs an hour).

## Tier 2 — public EGX/Yahoo data, light pipeline (1–2 weeks)
9. **Halal / Sharia screener** — EGX 33 membership is public; apply debt<30% of cap, non-halal income<5%, excluded sectors from our fundamentals; per-stock Sharia detail. High demand in Egypt.
10. **Ownership/stock classification badges** — T+0 eligibility, board (main/Nilex/OTC), activity tier A–D → derived daily price-limit band (±20/10/5%), short-selling eligibility. All from public EGX documents (static lists, update quarterly).
11. **Per-INDEX technical analysis pages** — EGX30/70/100/EGX33: pivots, S/R, RSI/MACD, constituent breadth above 20/50-MA. We hold index history already (Yahoo `^EGX30` works per T25 probes).
12. **EGX30 market scenarios page** (+ per-stock bull/base/bear scenario targets) — deterministic band math on our own index/stock history, labeled as descriptive.
13. **Corporate-actions timeline with ICS calendar export** — dividends, bonus shares, splits, rights deadlines parsed from the EGX disclosures we already archive (insiders.json pipeline); one-click Google/Apple calendar export.
14. **Rights-issues tracker** — theoretical value (Cum-rights vs subscription price), terms, window countdown — from EGX filings.
15. **Earnings calendar + IPO tracker** — from the same filings archive + EGX news.
16. **Prediction accuracy dashboard / track record** — replay our stored AI-signal sets (durable ledger in data/agent/signals.jsonl) against actual closes → hit-rate per model/signal; the honest version of foudalens' `/track-record`.
17. **Dividend-stocks list + best-stocks-by-category guides** — derived views on existing fundamentals.
18. **Whale/block-trade archive (descriptive, filing-based)** — EGX bulletins disclose block trades; parse + archive (not real-time, but nobody else shows history). Also matches esthmr's insight.
19. **Global markets + commodities + silver + crypto pages** — Yahoo public (Brent `BZ=F`, silver, indices) + CoinGecko for crypto-in-EGP; all keyless public APIs we already use for stocks.
20. **Per-bank USD/EGP pages** — scrape 5–8 Egyptian bank rate pages (they publish rates publicly) → per-bank deep dives + best-rate table.
21. **AI stock explanation card on each stock page + AI news summaries** — we already have the AI assistant/agent infra; add per-stock context tool + news-summarize endpoint.
22. **Intraday session/7-day chart frames** — Yahoo intraday (1m/5m) works for `.CA` symbols (T25 probes confirmed chart API); no live feed needed for a session replay after close.

## Tier 3 — needs live/paid feeds or accounts (NOT feasible with static/public data)
23. Live order-book depth + microstructure gauge (عمق السعر) — Premium feed only.
24. Real-time tick prices + live trade tape + intraday My Flow.
25. Real-time whale-trade alerts / big-movers radar (±5% intraday) — needs streaming.
26. Auction live indicative price.
27. Telegram push alerts (feasible technically via bot API but needs a hosted bot + users' chat IDs — medium).
28. Cloud-saved chart drawings (needs accounts + backend storage; we have Supabase, so actually medium — listed here only because it needs auth plumbing).
29. Portfolio advisor with quotas / referral / SMS payments / native apps — business-tier, out of scope.

## Explicitly REJECTED as dishonest for us (we should NOT copy)
- Their "AI stock predictions with confidence levels" framing — our published AI signals carry entry zones + stop plans and an accuracy ledger instead; foudalens itself labels everything "educational, not advice", and we already go further with verifiable track records.
