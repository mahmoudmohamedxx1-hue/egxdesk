"use client";

/** T28 — the AI assistant's EXECUTION layer: these tools let the assistant
 *  (any model — instant router, cloud GLM-4-Plus, or a free Puter cloud
 *  model such as GLM-5.3)
 *  actually OPERATE the EGX Desk website: navigate every view, open company
 *  pages, manage the watchlist, create multi-condition alerts, place paper
 *  trades, flip language/theme, and pull live market data for answers.
 *
 *  Every tool returns a bilingual markdown `text` (instant mode shows it
 *  as-is) plus raw `data` JSON (fed to the model's answer stage). All market
 *  numbers stay honest: the same delayed ~15-min APIs every view uses. */

import type { Lang } from "@/lib/i18n";
import type { AlertCondition, PriceAlert } from "@/lib/alerts";
import { loadBook, saveBook, buy, sell, emptyBook, tradeErrText, type PaperBook } from "@/lib/paper";

export type ToolCtx = {
  lang: Lang;
  view: { name: string; ticker?: string; panel?: string };
  navigate: (v: string, extra?: { ticker?: string; panel?: string }) => void;
  toggleWatch: (ticker: string) => void;
  watchTickers: string[];
  addAlert: (ticker: string, conditions: AlertCondition[], date?: string) => void;
  alerts: PriceAlert[];
  removeAlert: (id: string) => void;
  setLang: (l: Lang) => void;
  setTheme: (t: "dark" | "light") => void;
};

export type ToolResult = {
  ok: boolean;
  /** localized markdown — instant mode renders it directly */
  text: string;
  /** raw JSON for the model's answer stage */
  data?: unknown;
};

// ── shared data caches (60s TTL, module-level so the popup survives close) ──

type CompanyRowLite = {
  ticker: string; name: string; nameAr?: string; close: number; changePct: number;
  changeAbs: number; volume: number; valueTraded: number; marketCap: number | null;
  sectorEn: string; sectorAr: string;
};

let companiesAt = 0;
let companiesRows: CompanyRowLite[] = [];

async function companies(): Promise<CompanyRowLite[]> {
  if (Date.now() - companiesAt < 60_000 && companiesRows.length) return companiesRows;
  const res = await fetch("/api/companies", { cache: "no-store" });
  if (!res.ok) throw new Error("companies unavailable");
  const json = (await res.json()) as { rows?: CompanyRowLite[] };
  companiesRows = (json.rows ?? []).map((r) => ({ ...r, ticker: String(r.ticker).toUpperCase() }));
  companiesAt = Date.now();
  return companiesRows;
}

/** Local fuzzy fallback: score every company by how many query words (≥4
 *  chars, weighted by length) appear in its EN/AR name — rescues requests
 *  like "Eastern Tobacco" → EAST "Eastern Company" where the exact-phrase
 *  search finds nothing because the legal name never says Tobacco. */
function localNameMatch(rows: CompanyRowLite[], q: string): CompanyRowLite | null {
  const words = q.trim().toLowerCase().split(/[\s,]+/).filter((w) => w.length >= 4);
  if (!words.length) return null;
  let best: { row: CompanyRowLite; score: number } | null = null;
  for (const r of rows) {
    const hay = `${r.name} ${r.nameAr ?? ""}`.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (hay.includes(w)) score += w.length;
    }
    if (score > 0 && (!best || score > best.score)) best = { row: r, score };
  }
  return best?.row ?? null;
}

export async function findTicker(q: string): Promise<CompanyRowLite | null> {
  const raw = q.trim().toUpperCase();
  if (!raw) return null;
  const rows = await companies();
  const exact = rows.find((r) => r.ticker === raw);
  if (exact) return exact;
  // fuzzy: name match via the search endpoint (handles Arabic names too)
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as { results?: { ticker: string }[] };
      const top = json.results?.[0]?.ticker?.toUpperCase();
      if (top) {
        const hit = rows.find((r) => r.ticker === top);
        if (hit) return hit;
      }
    }
  } catch {}
  return localNameMatch(rows, q);
}

// ── tool schemas (shown to models AND in the UI "what can I do" menu) ──

export type ToolDef = {
  name: string;
  desc: { ar: string; en: string };
  example: string;
};

export const TOOL_DEFS: ToolDef[] = [
  { name: "open_view", desc: { ar: "فتح أي صفحة في الموقع", en: "Open any page of the app" }, example: "open the screener" },
  { name: "open_ticker", desc: { ar: "فتح صفحة سهم (رسم/فني/أخبار)", en: "Open a stock page (chart/technicals/news)" }, example: "show me COMI chart" },
  { name: "quote", desc: { ar: "سعر سهم الآن", en: "Live quote for a stock" }, example: "what's the price of HRHO?" },
  { name: "search", desc: { ar: "البحث عن شركة بالاسم", en: "Search companies by name" }, example: "find Eastern Tobacco" },
  { name: "movers", desc: { ar: "الأكثر صعودًا وهبوطًا", en: "Top gainers & losers" }, example: "show me today's movers" },
  { name: "market_overview", desc: { ar: "ملخص السوق والمؤشرات", en: "Market summary & indices" }, example: "how's the market today?" },
  { name: "technicals", desc: { ar: "مؤشرات فنية (RSI/MACD/متوسطات)", en: "Technical snapshot (RSI/MACD/MAs)" }, example: "technical analysis of TMGH" },
  { name: "news", desc: { ar: "آخر الأخبار مع المشاعر", en: "Latest news with sentiment" }, example: "any news about the market?" },
  { name: "gcc", desc: { ar: "أسواق الخليج (السعودية/دبي/أبوظبي)", en: "Gulf markets (Saudi/Dubai/AbuDhabi)" }, example: "how's Tadawul doing?" },
  { name: "watch_add", desc: { ar: "إضافة سهم للمتابعة", en: "Add a stock to the watchlist" }, example: "watch COMI" },
  { name: "watch_remove", desc: { ar: "إزالة سهم من المتابعة", en: "Remove a stock from the watchlist" }, example: "unwatch COMI" },
  { name: "watch_list", desc: { ar: "عرض قائمة المتابعة", en: "Show the watchlist" }, example: "my watchlist" },
  { name: "alert_create", desc: { ar: "إنشاء تنبيه متعدد الشروط", en: "Create a multi-condition alert" }, example: "alert COMI above 90 and RSI below 70" },
  { name: "alert_list", desc: { ar: "عرض التنبيهات", en: "List alerts" }, example: "my alerts" },
  { name: "alert_delete", desc: { ar: "حذف تنبيه", en: "Delete an alert" }, example: "delete alert for COMI" },
  { name: "paper_buy", desc: { ar: "شراء تجريبي بسعر السوق", en: "Paper-buy at the live price" }, example: "buy 100 COMI" },
  { name: "paper_sell", desc: { ar: "بيع تجريبي بسعر السوق", en: "Paper-sell at the live price" }, example: "sell 50 COMI" },
  { name: "paper_portfolio", desc: { ar: "محفظة التجريبي والأرباح", en: "Paper portfolio & P&L" }, example: "my paper positions" },
  { name: "set_language", desc: { ar: "تغيير لغة الموقع", en: "Switch the site language" }, example: "switch to English" },
  { name: "set_theme", desc: { ar: "الوضع الليلي/النهاري", en: "Dark/light mode" }, example: "dark mode" },
];

export const KNOWN_VIEW_NAMES = [
  "home", "market", "screener", "sectors", "heat", "activity", "investors",
  "calendar", "funds", "compare", "gcc", "lab", "reports", "watchlist",
  "paper", "tools", "today", "signals", "api",
] as const;

/** Compact tool spec block for the model's system prompt (kept terse for
 *  0.5B-class local models). */
export function toolsPromptSpec(): string {
  return [
    'open_view: {"view":"home|market|screener|sectors|heat|activity|investors|calendar|funds|compare|gcc|lab|reports|watchlist|paper|tools|news|signals"}',
    'open_ticker: {"ticker":"COMI","panel":"overview|chart|technicals|news|financials|insiders"} — open a stock page',
    "quote: {ticker} — live delayed price",
    "search: {q} — find tickers by English/Arabic name",
    "movers: {} — top gainers & losers",
    "market_overview: {} — EGX indices & breadth",
    "technicals: {ticker} — RSI/MACD/MA20/MA50/volume ratio",
    "news: {q?} — latest news headlines with sentiment",
    "gcc: {} — Tadawul/DFM/ADX index snapshot",
    "watch_add: {ticker} · watch_remove: {ticker} · watch_list: {}",
    'alert_create: {"ticker":"COMI","conditions":[{"kind":"priceAbove|priceBelow|chgAbove|chgBelow|rsiAbove|rsiBelow|macdAbove|macdBelow|maCrossUp|maCrossDown|volRatioAbove","value":90}]}',
    "alert_list: {} · alert_delete: {id}",
    "paper_buy: {ticker, qty} · paper_sell: {ticker, qty} — simulated EGP trades at live price",
    "paper_portfolio: {} — positions + P&L",
    'set_language: {"lang":"ar|en"} · set_theme: {"theme":"dark|light"}',
  ].join("\n");
}

// ── formatting helpers ──

const nf = (n: number, d = 2) =>
  Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }) : "—";

const pct = (n: number) => `${n >= 0 ? "+" : ""}${nf(n, 2)}%`;

function fmtM(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1e9) return `${nf(v / 1e9, 2)}B`;
  if (v >= 1e6) return `${nf(v / 1e6, 2)}M`;
  if (v >= 1e3) return `${nf(v / 1e3, 1)}K`;
  return nf(v, 0);
}

function rowLine(r: CompanyRowLite, lang: Lang): string {
  const name = lang === "ar" ? (r.nameAr ?? r.name) : r.name;
  return `**${r.ticker}** — ${name}: ${nf(r.close)} EGP (${pct(r.changePct)}) · vol ${fmtM(r.volume)}`;
}

// ── the executor ──

async function chartSnapshot(ticker: string): Promise<{ rsi: number | null; macd: number | null; macdSignal: number | null; maShort: number | null; maLong: number | null; volRatio: number | null } | null> {
  try {
    const res = await fetch(`/api/chart?symbol=${encodeURIComponent(ticker)}&range=6M`, { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as { points?: { close: number; volume: number | null }[]; error?: string };
    if (j.error || !Array.isArray(j.points) || j.points.length < 2) return null;
    const { indicatorSnapshot } = await import("@/lib/alerts");
    return indicatorSnapshot(j.points);
  } catch {
    return null;
  }
}

async function bookWithPrices(): Promise<{ book: PaperBook; prices: Map<string, CompanyRowLite> }> {
  const [book, rows] = await Promise.all([loadBook(), companies()]);
  const prices = new Map(rows.map((r) => [r.ticker, r] as const));
  return { book: book ?? emptyBook(), prices };
}

export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult> {
  const lang = ctx.lang;
  const AR = lang === "ar";
  const t = (ar: string, en: string) => (AR ? ar : en);
  const A = (s: unknown) => (typeof s === "string" ? s : "");

  try {
    switch (name) {
      case "open_view": {
        const raw = A(args.view).toLowerCase();
        const view = (KNOWN_VIEW_NAMES as readonly string[]).includes(raw) ? raw : "home";
        ctx.navigate(view);
        return { ok: true, text: t(`تم فتح الصفحة ✓`, `Opened the page ✓`), data: { view } };
      }
      case "open_ticker": {
        let q = A(args.ticker);
        if (!q && A(args.name)) q = A(args.name);
        if (!q) return { ok: false, text: t("حدد رمز سهم", "Specify a ticker") };
        const row = await findTicker(q);
        if (!row) return { ok: false, text: t(`لم أجد «${q}» — جرّب البحث بالاسم`, `Couldn't find "${q}" — try searching by name`) };
        const panelRaw = A(args.panel).toLowerCase();
        const panel = ["overview", "chart", "technicals", "news", "financials", "insiders", "tools", "dividends", "signals", "reports"].includes(panelRaw) ? panelRaw : "overview";
        ctx.navigate("company", { ticker: row.ticker, panel });
        return { ok: true, text: t(`فتحت **${row.ticker}** (${AR ? row.nameAr ?? row.name : row.name}) — ${nf(row.close)} EGP (${pct(row.changePct)})`, `Opened **${row.ticker}** (${row.name}) — ${nf(row.close)} EGP (${pct(row.changePct)})`), data: { ticker: row.ticker, close: row.close, changePct: row.changePct, panel } };
      }
      case "quote": {
        const row = await findTicker(A(args.ticker) || A(args.name));
        if (!row) return { ok: false, text: t(`لم أجد السهم`, `Couldn't find that stock`) };
        return {
          ok: true,
          text: t(
            `**${row.ticker}** — ${row.nameAr ?? row.name}\n${nf(row.close)} EGP (${pct(row.changePct)} · ${nf(row.changeAbs)} EGP)\nالحجم ${fmtM(row.volume)} سهم · القيمة ${fmtM(row.valueTraded)} EGP\n_أسعار مؤجلة ~١٥ دقيقة_`,
            `**${row.ticker}** — ${row.name}\n${nf(row.close)} EGP (${pct(row.changePct)} · ${nf(row.changeAbs)} EGP)\nVolume ${fmtM(row.volume)} shares · value ${fmtM(row.valueTraded)} EGP\n_Quotes delayed ~15 min_`,
          ),
          data: { ticker: row.ticker, close: row.close, changePct: row.changePct, changeAbs: row.changeAbs, volume: row.volume, valueTraded: row.valueTraded },
        };
      }
      case "search": {
        const q = A(args.q) || A(args.query);
        if (!q) return { ok: false, text: t("ماذا تبحث؟", "Search for what?") };
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        if (!res.ok) return { ok: false, text: t("البحث غير متاح الآن", "Search unavailable right now") };
        const json = (await res.json()) as { results?: CompanyRowLite[] };
        const hits = (json.results ?? []).slice(0, 8);
        if (!hits.length) return { ok: false, text: t(`لا نتائج لـ «${q}»`, `No results for "${q}"`), data: { q, hits: [] } };
        return {
          ok: true,
          text: hits.map((r) => rowLine(r, lang)).join("\n"),
          data: { q, hits: hits.map((r) => ({ ticker: r.ticker, name: r.name, close: r.close, changePct: r.changePct })) },
        };
      }
      case "movers": {
        const rows = await companies();
        const up = [...rows].filter((r) => r.changePct > 0).sort((a, b) => b.changePct - a.changePct).slice(0, 6);
        const dn = [...rows].filter((r) => r.changePct < 0).sort((a, b) => a.changePct - b.changePct).slice(0, 6);
        const text = [
          AR ? `**الأكثر ارتفاعًا**` : `**Top gainers**`,
          ...up.map((r) => rowLine(r, lang)),
          "",
          AR ? `**الأكثر انخفاضًا**` : `**Top losers**`,
          ...dn.map((r) => rowLine(r, lang)),
        ].join("\n");
        return { ok: true, text, data: { gainers: up.slice(0, 5), losers: dn.slice(0, 5) } };
      }
      case "market_overview": {
        const res = await fetch("/api/overview", { cache: "no-store" });
        if (!res.ok) return { ok: false, text: t("ملخص السوق غير متاح الآن", "Market summary unavailable") };
        const j = (await res.json()) as {
          indices?: { name?: string; nameAr?: string; value?: number; changePct?: number | null }[];
          breadth?: { up?: number; down?: number; flat?: number; total?: number };
        };
        const idx = (j.indices ?? []).slice(0, 4).map((i) => `• ${(AR ? i.nameAr ?? i.name : i.name) ?? "—"}: ${nf(i.value ?? 0)} (${i.changePct != null ? pct(i.changePct) : "—"})`);
        const b = j.breadth ?? {};
        const text = [
          AR ? "**البورصة المصرية الآن**" : "**EGX right now**",
          ...idx,
          "",
          AR ? `صاعد ${b.up ?? 0} · هابط ${b.down ?? 0} · ثابت ${b.flat ?? 0} (من ${b.total ?? 0})` : `Up ${b.up ?? 0} · down ${b.down ?? 0} · flat ${b.flat ?? 0} (of ${b.total ?? 0})`,
          "_تأخر ~١٥ دقيقة_",
        ].join("\n");
        return { ok: true, text, data: { indices: j.indices, breadth: b } };
      }
      case "technicals": {
        const q = A(args.ticker) || A(args.name);
        const row = q ? await findTicker(q) : null;
        if (!row) return { ok: false, text: t("لم أجد السهم", "Couldn't find that stock") };
        const snap = await chartSnapshot(row.ticker);
        if (!snap) return { ok: false, text: t("لا توجد بيانات كافية لهذا السهم", "Not enough data for this stock") };
        const verdict = (() => {
          const bits: string[] = [];
          if (snap.rsi != null) bits.push(snap.rsi > 70 ? (AR ? "تشبع شرائي" : "overbought") : snap.rsi < 30 ? (AR ? "تشبع بيعي" : "oversold") : (AR ? "محايد" : "neutral"));
          if (snap.macd != null && snap.macdSignal != null) bits.push(snap.macd > snap.macdSignal ? (AR ? "MACD إيجابي" : "MACD bullish") : (AR ? "MACD سلبي" : "MACD bearish"));
          if (snap.maShort != null && snap.maLong != null) bits.push(snap.maShort > snap.maLong ? (AR ? "اتجاه صاعد" : "uptrend") : (AR ? "اتجاه هابط" : "downtrend"));
          return bits.join(" · ");
        })();
        const text = [
          `**${row.ticker}** ${AR ? "— اللقطة الفنية" : "— technical snapshot"}`,
          `RSI(14): ${snap.rsi != null ? nf(snap.rsi, 1) : "—"}`,
          `MACD: ${snap.macd != null ? nf(snap.macd, 3) : "—"} (${AR ? "إشارة" : "signal"} ${snap.macdSignal != null ? nf(snap.macdSignal, 3) : "—"})`,
          `MA20 ${snap.maShort != null ? nf(snap.maShort) : "—"} · MA50 ${snap.maLong != null ? nf(snap.maLong) : "—"}`,
          `Vol × ${snap.volRatio != null ? nf(snap.volRatio, 1) : "—"}`,
          "",
          `_${verdict}_`,
        ].join("\n");
        return { ok: true, text, data: { ticker: row.ticker, ...snap } };
      }
      case "news": {
        const q = A(args.q) || A(args.query);
        const url = q
          ? `/api/news-en?q=${encodeURIComponent(q)}`
          : "/api/news-en";
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return { ok: false, text: t("الأخبار غير متاحة الآن", "News unavailable right now") };
        const j = (await res.json()) as { items?: { title?: string; link?: string; publishedAt?: string; source?: string; sentiment?: { label?: string } }[] };
        const items = (j.items ?? []).slice(0, 6);
        if (!items.length) return { ok: false, text: t("لا أخبار الآن", "No news right now") };
        const text = items
          .map((it) => `• ${it.title ?? "—"}${it.sentiment?.label ? ` _(${it.sentiment.label})_` : ""}`)
          .join("\n");
        return { ok: true, text, data: { items: items.map((i) => ({ title: i.title, source: i.source, sentiment: i.sentiment?.label ?? null })) } };
      }
      case "gcc": {
        const res = await fetch("/api/gcc", { cache: "no-store" });
        if (!res.ok) return { ok: false, text: t("بيانات الخليج غير متاحة الآن", "GCC data unavailable right now") };
        const j = (await res.json()) as { indices?: { nameAr?: string; nameEn?: string; close?: number; changePct?: number | null }[] };
        const lines = (j.indices ?? []).map((i) => `• ${(AR ? i.nameAr : i.nameEn) ?? "—"}: ${nf(i.close ?? 0)} (${i.changePct != null ? pct(i.changePct) : "—"})`);
        return { ok: true, text: [AR ? "**أسواق الخليج**" : "**Gulf markets**", ...lines].join("\n"), data: { indices: j.indices } };
      }
      case "watch_add":
      case "watch_remove": {
        const row = await findTicker(A(args.ticker) || A(args.name));
        if (!row) return { ok: false, text: t("لم أجد السهم", "Couldn't find that stock") };
        ctx.toggleWatch(row.ticker);
        return {
          ok: true,
          text: name === "watch_add"
            ? t(`أضفت **${row.ticker}** إلى المتابعة ✓`, `Added **${row.ticker}** to the watchlist ✓`)
            : t(`أزلت **${row.ticker}** من المتابعة ✓`, `Removed **${row.ticker}** from the watchlist ✓`),
          data: { ticker: row.ticker, watched: name === "watch_add" },
        };
      }
      case "watch_list": {
        const rows = await companies();
        const mine = rows.filter((r) => ctx.watchTickers.includes(r.ticker));
        if (!mine.length) return { ok: true, text: t("قائمة المتابعة فارغة", "The watchlist is empty") };
        return { ok: true, text: [AR ? "**متابعتي**" : "**Watchlist**", ...mine.map((r) => rowLine(r, lang))].join("\n"), data: { tickers: mine.map((r) => ({ ticker: r.ticker, close: r.close, changePct: r.changePct })) } };
      }
      case "alert_create": {
        const row = await findTicker(A(args.ticker) || A(args.name));
        if (!row) return { ok: false, text: t("لم أجد السهم", "Couldn't find that stock") };
        const condsRaw = Array.isArray(args.conditions) ? (args.conditions as { kind?: string; value?: number }[]) : [];
        const VALID = new Set(["priceAbove", "priceBelow", "chgAbove", "chgBelow", "rsiAbove", "rsiBelow", "macdAbove", "macdBelow", "maCrossUp", "maCrossDown", "volRatioAbove", "onDate"]);
        const conds: AlertCondition[] = condsRaw
          .filter((c) => c && typeof c.kind === "string" && VALID.has(c.kind) && Number.isFinite(Number(c.value)))
          .slice(0, 4)
          .map((c) => ({ kind: c.kind as AlertCondition["kind"], value: Number(c.value) }));
        if (!conds.length) {
          return { ok: false, text: t("حدد شرطًا واحدًا على الأقل، مثال: alert COMI above 90", "Specify at least one condition, e.g. alert COMI above 90") };
        }
        ctx.addAlert(row.ticker, conds);
        const { kindLabel } = await import("@/lib/alerts");
        const condText = conds.map((c) => `${kindLabel(c.kind, lang)} ${c.value}`).join(` ${AR ? "و" : "AND" }`);
        return { ok: true, text: t(`أنشأت تنبيه **${row.ticker}**: ${condText} ✓`, `Created alert for **${row.ticker}**: ${condText} ✓`), data: { ticker: row.ticker, conditions: conds } };
      }
      case "alert_list": {
        if (!ctx.alerts.length) return { ok: true, text: t("لا تنبيهات حالية", "No alerts yet") };
        const { alertText } = await import("@/lib/alerts");
        return { ok: true, text: [AR ? "**التنبيهات**" : "**Alerts**", ...ctx.alerts.map((a) => `• ${alertText(a, lang)}${a.triggeredAt ? (AR ? " — تحقق ✓" : " — triggered ✓") : ""}`)].join("\n"), data: { alerts: ctx.alerts.map((a) => ({ id: a.id, ticker: a.ticker, conditions: a.conditions, triggered: !!a.triggeredAt })) } };
      }
      case "alert_delete": {
        const id = A(args.id);
        const target = id
          ? ctx.alerts.find((a) => a.id === id)
          : ctx.alerts.find((a) => a.ticker === String(args.ticker ?? "").toUpperCase());
        if (!target) return { ok: false, text: t("لم أجد التنبيه", "Couldn't find that alert") };
        ctx.removeAlert(target.id);
        return { ok: true, text: t(`حذفت تنبيه **${target.ticker}** ✓`, `Deleted the **${target.ticker}** alert ✓`), data: { id: target.id } };
      }
      case "paper_buy":
      case "paper_sell": {
        const row = await findTicker(A(args.ticker) || A(args.name));
        if (!row) return { ok: false, text: t("لم أجد السهم", "Couldn't find that stock") };
        const qty = Math.max(1, Math.floor(Number(args.qty ?? 10) || 10));
        const book = (await loadBook()) ?? emptyBook();
        const result = name === "paper_buy" ? buy(book, row.ticker, qty, row.close) : sell(book, row.ticker, qty, row.close);
        if (!result.ok) {
          return { ok: false, text: tradeErrText(result.reason, lang) };
        }
        saveBook(result.book);
        const cash = result.book.cash;
        return {
          ok: true,
          text: t(
            `تنفيذ تجريبي ✓ ${name === "paper_buy" ? "شراء" : "بيع"} ${qty} ${row.ticker} @ ${nf(row.close)} EGP\nعمولة ${nf(result.trade.fee)} EGP · الرصيد النقدي ${nf(cash)} EGP`,
            `Paper fill ✓ ${name === "paper_buy" ? "bought" : "sold"} ${qty} ${row.ticker} @ ${nf(row.close)} EGP\nFee ${nf(result.trade.fee)} EGP · cash left ${nf(cash)} EGP`,
          ),
          data: { side: name === "paper_buy" ? "buy" : "sell", ticker: row.ticker, qty, price: row.close, fee: result.trade.fee, cash },
        };
      }
      case "paper_portfolio": {
        const { book, prices } = await bookWithPrices();
        const pos = book.positions ?? [];
        if (!pos.length) return { ok: true, text: t("لا مراكز تجريبية بعد — جرّب: buy 100 COMI", "No paper positions yet — try: buy 100 COMI"), data: { cash: book.cash, positions: [] } };
        const lines = pos.map((p) => {
          const price = prices.get(p.ticker)?.close ?? p.avgPrice;
          const pnl = (price - p.avgPrice) * p.qty;
          const pctP = p.avgPrice > 0 ? ((price - p.avgPrice) / p.avgPrice) * 100 : 0;
          return `• **${p.ticker}**: ${p.qty} @ ${nf(p.avgPrice)} → ${nf(price)} (${pct(pctP)} · ${nf(pnl)} EGP)`;
        });
        const unreal = pos.reduce((s, p) => {
          const price = prices.get(p.ticker)?.close ?? p.avgPrice;
          return s + (price - p.avgPrice) * p.qty;
        }, 0);
        const text = [
          AR ? "**المحفظة التجريبية**" : "**Paper portfolio**",
          ...lines,
          "",
          AR ? `نقدي: ${nf(book.cash)} EGP · غير محقق: ${nf(unreal)} EGP` : `Cash: ${nf(book.cash)} EGP · unrealized: ${nf(unreal)} EGP`,
        ].join("\n");
        return { ok: true, text, data: { cash: book.cash, unrealized: unreal, positions: pos.map((p) => ({ ticker: p.ticker, qty: p.qty, avgPrice: p.avgPrice })) } };
      }
      case "set_language": {
        const l = A(args.lang).toLowerCase() === "en" ? "en" : "ar";
        ctx.setLang(l as Lang);
        return { ok: true, text: l === "ar" ? "تم التبديل إلى العربية ✓" : "Switched to English ✓", data: { lang: l } };
      }
      case "set_theme": {
        const th = A(args.theme).toLowerCase() === "light" ? "light" : "dark";
        ctx.setTheme(th as "dark" | "light");
        return { ok: true, text: t(`تم التبديل للوضع ${th === "dark" ? "الليلي" : "النهاري"} ✓`, `Switched to ${th} mode ✓`), data: { theme: th } };
      }
      default:
        return { ok: false, text: t(`أداة غير معروفة: ${name}`, `Unknown tool: ${name}`) };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    return { ok: false, text: t(`تعذّر التنفيذ (${msg})`, `Execution failed (${msg})`) };
  }
}

// ── the INSTANT router — bilingual regex intent matching, zero model ──

const TICKER_BLOCK = new Set([
  "EGX", "EGX30", "EGX70", "EGX100", "GCC", "TASI", "MT30", "DFMGI", "ADI", "DFM", "ADX",
  "RSI", "MACD", "MA", "EMA", "SMA", "VWAP", "ATR", "OBV", "USD", "EGP", "SAR", "AED",
  "ETF", "CEO", "CFO", "IPO", "GDP", "ROE", "ROA", "EPS", "PBOC", "FOMC", "KSA", "UAE",
  "AND", "THE", "FOR", "WITH", "ALL", "TOP", "BUY", "SELL", "OPEN", "SHOW", "AAPL", "AI",
]);

function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

function extractTicker(text: string): string | null {
  const caps = text.match(/\b[A-Z]{3,5}\b/g) ?? [];
  const cand = caps.find((c) => !TICKER_BLOCK.has(c));
  return cand ?? null;
}

/** Leftover noun phrase for name search: strip command verbs, numbers,
 *  latin tickers and common filler words, keep the rest. */
function extractPhrase(text: string): string | null {
  let s = text
    .replace(/(?:open|show|go to|take me to|watch|follow|add|remove|unwatch|alert|notify|buy|sell|quote|price of|chart of|chart|technicals of|technical|technicals|news about|find|search|me|the|a|an|to|my|please|page|view|stock|share|shares|company|of|about|for|and|with|any|what|whats|how|is|does|do|today)/gi, " ")
    .replace(/(?:افتح|اعرض|روح|وديني|خدني|تابع|ضيف|أضف|اضف|ازالة|أزل|احذف|تنبيه|ذكرني|اشتري|بِع|سعر|سهم|أسهم|اسهم|شركة|صفحة|عرض|عن|على|في|من|الي|إلى|لى|لي|من فضلك|ما|كيف|هل|ايه|إيه|النهاردة|اليوم)/g, " ")
    .replace(/[٠-٩\d.,%+×x]/g, " ")
    .replace(/\b[A-Z]{3,5}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = s.split(/\s+/).filter((w) => w.length >= 3);
  return words.length ? words.slice(0, 4).join(" ") : null;
}

const VIEW_WORDS: Record<string, string> = {
  home: "home|overview|الرئيسية|الرئيسيه",
  market: "market|markets|all stocks|السوق|الاسهم|الأسهم",
  screener: "screener|screen|الفرز",
  sectors: "sectors|sector|القطاعات|القطاع",
  heat: "heat ?map|heatmap|heat|map|الخريطة|الخرائط",
  activity: "activity|النشاط",
  investors: "investors?|flows|المستثمرين|المستثمرين|التدفقات|تدفقات",
  calendar: "calendar|التقويم|الرزنامة",
  funds: "funds?|etfs?|الصناديق|الصندوق",
  compare: "compare|المقارنة",
  gcc: "gcc|gulf|tadawul|saudi|dubai|abu ?dhabi|الخليج|السعودية|تداول|دبي|أبوظبي|ابوظبي",
  lab: "lab|strategy|backtest|المختبر|الاستراتيجية",
  reports: "reports?|التقارير|تقرير",
  watchlist: "watch ?list|متابعتي|قائمة المتابعة",
  paper: "paper|simulator|simulation|التجريبي|المحاكاة",
  tools: "tools|الأدوات|الادوات",
  today: "news page|news feed|صفحة الأخبار|اخبار الصفحة",
  signals: "signals|الإشارات|الاشارات",
};

type Instant = { tool: string; args: Record<string, unknown> } | null;

/** Unicode-aware word matcher — JS `\b` is ASCII-only (Arabic letters are
 *  NOT \w chars), so every bilingual intent needs letter-class boundaries
 *  instead: a match must start after a non-letter and end before one. */
function hasWord(low: string, words: string): boolean {
  try {
    return new RegExp(`(?:^|[^\\p{L}\\p{N}_])(${words})(?![\\p{L}\\p{N}_])`, "iu").test(low);
  } catch {
    return low.includes(words);
  }
}

/** Bilingual zero-model router. Returns a tool+args, or null when nothing
 *  matched with confidence (then a real model is needed). */
export function instantRoute(rawText: string): Instant {
  const text = toLatinDigits(rawText).trim();
  if (!text) return null;
  const low = text.toLowerCase();

  // theme / language — highest specificity, checked first
  if (hasWord(low, "dark|night|ليلي|الليلي|داكن")) return { tool: "set_theme", args: { theme: "dark" } };
  if (hasWord(low, "light|bright|day ?mode|نهاري|فاتح|النهاري")) return { tool: "set_theme", args: { theme: "light" } };
  if (hasWord(low, "english|انجليزي|الانجليزية|الإنجليزية")) return { tool: "set_language", args: { lang: "en" } };
  if (hasWord(low, "arabic|عربي|العربية")) return { tool: "set_language", args: { lang: "ar" } };

  // market data intents
  if (/(movers?|gainers?|losers?|الأكثر|الاكثر ارتفاعا|الأكثر ارتفاعًا|الاكثر انخفاضا|الأكثر انخفاضًا|رابح|خاسر)/i.test(low)) return { tool: "movers", args: {} };
  if (/(market (overview|summary|today|doing|going)|how'?s the market|ملخص السوق|حالة السوق|السوق اليوم|إجمالي السوق|اجمالي السوق)/i.test(low)) return { tool: "market_overview", args: {} };
  if (/(gulf|gcc|tadawul|saudi market|dfm|dubai market|abu ?dhabi|adx|الخليج|تاسي|تداول|سوق السعودية|سوق دبي|أبوظبي|ابوظبي)/i.test(low) && !/(open|افتح|اعرض|صفحة)/i.test(low)) return { tool: "gcc", args: {} };
  if (/\b(my )?(alerts?|تنبيهاتي|التنبيهات)\b/i.test(low) || hasWord(low, "تنبيهاتي|التنبيهات")) {
    if (!/alert .*(above|below|فوق|تحت|أعلى|أقل)/i.test(low)) return { tool: "alert_list", args: {} };
  }
  if (/\b(my )?(watch ?list)\b/i.test(low) || hasWord(low, "قائمة المتابعة|متابعتي")) return { tool: "watch_list", args: {} };
  if (/\b(my |the )?(paper )?(portfolio|positions|p&l|pnl)\b/i.test(low) || hasWord(low, "محفظتي|محفظة التجريبي|مراكزي|مراكز")) return { tool: "paper_portfolio", args: {} };

  // watch add/remove
  if (/(unwatch|remove .* from (the )?watch|أزل .* من المتابعة|احذف .* من المتابعة|ازالة .* من المتابعة)/i.test(low)) {
    const ticker = extractTicker(text);
    return { tool: "watch_remove", args: ticker ? { ticker } : { ticker: extractPhrase(text) ?? "" } };
  }
  if (/(watch|follow|add .* to (the )?watch|تابع|ضيف .* للمتابعة|أضف .* للمتابعة|اضف .* للمتابعة)/i.test(low)) {
    const ticker = extractTicker(text);
    return { tool: "watch_add", args: ticker ? { ticker } : { ticker: extractPhrase(text) ?? "" } };
  }

  // paper trades: IMPERATIVE form only ("buy 100 COMI") — "should I buy…"
  // is advice, not an order, and must go to a model.
  const buyM = low.match(/^\s*(?:please\s+)?(?:buy|purchase)\s*(\d[\d,]*)?\s*(?:shares? of)?\s*([a-z]{3,5})?\b/i)
    ?? low.match(/^\s*(?:من فضلك\s*)?(?:اشتري|اشتر)\s*(\d[\d,]*)?\s*(?:سهم|سهم من)?\s*([\p{Script=Arabic}][\p{Script=Arabic}\s]{2,})/u);
  if (buyM) {
    const qty = buyM[1] ? Number(buyM[1].replace(/,/g, "")) : undefined;
    const ticker = extractTicker(text) ?? (((buyM[2] ?? "").trim() || extractPhrase(text)) ?? "");
    return { tool: "paper_buy", args: { ticker: String(ticker), ...(qty ? { qty } : {}) } };
  }
  const sellM = low.match(/^\s*(?:please\s+)?(?:sell)\s*(\d[\d,]*)?\s*(?:shares? of)?\s*([a-z]{3,5})?\b/i)
    ?? low.match(/^\s*(?:من فضلك\s*)?(?:بِع|بيع)\s*(\d[\d,]*)?\s*(?:سهم|سهم من)?\s*([\p{Script=Arabic}][\p{Script=Arabic}\s]{2,})/u);
  if (sellM) {
    const qty = sellM[1] ? Number(sellM[1].replace(/,/g, "")) : undefined;
    const ticker = extractTicker(text) ?? (((sellM[2] ?? "").trim() || extractPhrase(text)) ?? "");
    return { tool: "paper_sell", args: { ticker: String(ticker), ...(qty ? { qty } : {}) } };
  }

  // alerts: "alert COMI above 90" | "notify me when HRHO rsi above 70" | "تنبيه كومي فوق ٩٠"
  if (/(alert|notify|تنبيه|ذكرني)/i.test(low)) {
    // multi-condition requests are too rich for the fast path — let the model plan
    if (/\s(?:and|و)\s/i.test(low)) return null;
    const ticker = extractTicker(text);
    const rsiM = low.match(/rsi[^\d]*(\d+(?:\.\d+)?)/i);
    if (rsiM) {
      const above = /(above|over|exceeds|فوق|أعلى|اعلى|يتجاوز)/i.test(low);
      return { tool: "alert_create", args: { ticker: ticker ?? extractPhrase(text) ?? "", conditions: [{ kind: above ? "rsiAbove" : "rsiBelow", value: Number(rsiM[1]) }] } };
    }
    const numM = low.match(/(?:above|over|exceeds|below|under|drops? below|فوق|أعلى من|اعلى من|يتجاوز|تحت|أقل من|اقل من|ينزل تحت|عند)\s*(\d+(?:\.\d+)?)/i);
    if (numM) {
      const above = /(above|over|exceeds|فوق|أعلى من|اعلى من|يتجاوز)/i.test(low.slice(0, low.indexOf(numM[1])));
      return { tool: "alert_create", args: { ticker: ticker ?? extractPhrase(text) ?? "", conditions: [{ kind: above ? "priceAbove" : "priceBelow", value: Number(numM[1]) }] } };
    }
    return null; // "alert X" without a level — needs the model / clarification
  }

  // bare news intent (no specific subject)
  if (/(news|latest news|headlines|أخبار|اخبار|الأخبار|آخر الأخبار|اخر الاخبار)/i.test(low) && !extractTicker(text)) return { tool: "news", args: {} };

  // quote / technicals / chart / news-about — needs a subject
  const hasSubjectCmd = /(quote|price|سعر|technicals|technical|فني|chart|رسم|بياني|news|أخبار|اخبار)/i.test(low);
  if (hasSubjectCmd) {
    const ticker = extractTicker(text);
    const phrase = extractPhrase(text);
    if (/(technicals|technical|فني|تحليل فني)/i.test(low)) return { tool: "technicals", args: { ticker: ticker ?? phrase ?? "" } };
    if (/(chart|رسم|بياني)/i.test(low) && (ticker || phrase)) {
      // "show COMI chart" opens the chart panel
      return { tool: "open_ticker", args: { ticker: ticker ?? phrase ?? "", panel: "chart" } };
    }
    if (/(news|أخبار|اخبار)/i.test(low) && (phrase || ticker)) return { tool: "news", args: { q: ticker ?? phrase ?? "" } };
    if ((ticker || phrase) && /(quote|price|سعر)/i.test(low)) return { tool: "quote", args: { ticker: ticker ?? phrase ?? "" } };
  }
  const navCmd = /(open|go to|take me to|show me|show|افتح|اعرض|روح|وديني|خدني|الانتقال)/i.test(low);
  if (navCmd) {
    for (const [view, words] of Object.entries(VIEW_WORDS)) {
      if (hasWord(low, words)) return { tool: "open_view", args: { view: view === "today" ? "today" : view } };
    }
    // "open <something>" that is not a known view → company page
    const ticker = extractTicker(text);
    const phrase = extractPhrase(text);
    if (ticker || phrase) return { tool: "open_ticker", args: { ticker: ticker ?? phrase ?? "" } };
    return { tool: "open_view", args: { view: "home" } };
  }

  // bare ticker mention like "COMI?" or "COMI" alone
  const bareTicker = text.match(/^([A-Z]{3,5})(?:\?|\.|!)?$/);
  if (bareTicker && !TICKER_BLOCK.has(bareTicker[1])) return { tool: "open_ticker", args: { ticker: bareTicker[1] } };

  return null;
}

const KNOWN_TOOL_NAMES = new Set(TOOL_DEFS.map((d) => d.name));

/** Each tool's primary string argument — used when a model emits a bare
 *  string value like {"open_view":"screener"} or {"quote":"COMI"}. */
const PRIMARY_ARG: Record<string, string> = {
  open_view: "view", open_ticker: "ticker", quote: "ticker", search: "q",
  news: "q", watch_add: "ticker", watch_remove: "ticker", paper_buy: "ticker",
  paper_sell: "ticker", alert_create: "ticker", alert_delete: "ticker",
  set_language: "lang", set_theme: "theme",
};

/** Normalize the many shapes a model emits for one action into the canonical
 *  {tool, args} envelope — all observed in the wild:
 *   {"tool":"search","args":{"q":"x"}}   classic envelope
 *   {"tool":"search","q":"x"}            args spread next to "tool"
 *   {"search":{"q":"x"}}                 tool-name-as-key (GLM's favorite)
 *   {"search":"Eastern Tobacco"}         tool-name-as-key, bare string value
 *   {"action":"search","q":"x"}          "action" instead of "tool"
 *   {"reply":"..."}                      pure reply (no tool) */
function normalizeAction(obj: unknown): { tool?: string; args?: Record<string, unknown>; reply?: string } | null {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const toolRaw = typeof o.tool === "string" ? o.tool : typeof o.action === "string" ? o.action : null;
  if (toolRaw) {
    const tool = toolRaw.trim();
    const argsObj = o.args && typeof o.args === "object" && !Array.isArray(o.args) ? (o.args as Record<string, unknown>) : null;
    const inline: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (k !== "tool" && k !== "action" && k !== "args" && k !== "reply") inline[k] = v;
    }
    const args = argsObj ?? inline;
    return { tool, args: Object.keys(args).length ? args : {} };
  }
  const keys = Object.keys(o).filter((k) => k !== "reply");
  if (keys.length === 1 && KNOWN_TOOL_NAMES.has(keys[0])) {
    const v = o[keys[0]];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return { tool: keys[0], args: v as Record<string, unknown> };
    }
    const sv = String(v);
    const prim = PRIMARY_ARG[keys[0]];
    const args: Record<string, string> = { q: sv, ticker: sv, name: sv };
    if (prim) args[prim] = sv;
    return { tool: keys[0], args };
  }
  if (typeof o.reply === "string") return { reply: o.reply };
  return null;
}

/** Parse a model's JSON tool-call (tolerant: strips model think-block reasoning,
 *  markdown fences, finds the first balanced JSON object, then normalizes the
 *  action envelope so every observed output shape becomes {tool, args}). */
export function parseToolJson(out: string): { tool?: string; args?: Record<string, unknown>; reply?: string } | null {
  let s = out.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  // find the outermost {...}
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) {
        const slice = s.slice(start, i + 1);
        try {
          return normalizeAction(JSON.parse(slice));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
