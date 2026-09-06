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
