import { NextRequest, NextResponse } from "next/server";
import { buildReportBuffer, type ReportSpec, type TableSpec, type ColSpec } from "@/lib/xlsx-report";
import { fetchUniverse, fetchIndices, companyRow, sessionMeta, sectorRows, SECTOR_AR } from "@/lib/market";
import { scanSignals, signalForTicker } from "@/lib/signals-scan";
import { getLatestAiSignals } from "@/lib/ai-signals";
import { getLatestReport, getReportById } from "@/lib/hourly-report";
import { resolveTicker } from "@/lib/ticker-aliases";
import { fetchStockChart } from "@/lib/history";
import { fetchDividends } from "@/lib/dividends";
import { makeRateLimiter } from "@/lib/rate-limit";

/** POST /api/export — professional XLSX reports (Task 21-b, upgraded 22-c).
 *
 *  Server-defined reports (market / overview / signals / ai-signals /
 *  company / compare / hourly desk report) pull their data from the SAME
 *  live data layer the pages use, so an export is always fresh and honest.
 *  Device-local reports (screener / watchlist / portfolio) receive the rows
 *  the client is looking at (sanitized primitives only) and get the same
 *  branded treatment. Every workbook carries the EGX Desk brand block —
 *  and now (22-c) a branded COVER sheet with a table of contents on the
 *  major reports, conditional formatting (red→green color scales on change
 *  columns, data bars on volume/value), a methodology & definitions
 *  appendix, and print setup (landscape, fit-to-width, repeating headers) —
 *  plus frozen styled headers, zebra rows, tabular number formats,
 *  autofilter and right-to-left sheets for Arabic. */

export const runtime = "nodejs";

const limiter = makeRateLimiter(30, 3_600_000);

type Lang = "ar" | "en";
type Cell = string | number | null;
type ColFmt = "text" | "num" | "int" | "pct" | "ratio" | "score";

// ── bilingual labels for the report chrome ──
function labels(lang: Lang) {
  const ar = lang === "ar";
  return {
    generatedAt: ar ? "تاريخ الإنشاء" : "Generated",
    session: ar ? "الجلسة" : "Session",
    source: ar ? "المصدر" : "Source",
    rows: ar ? "عدد الصفوف" : "Rows",
    companiesSheet: ar ? "الشركات" : "Companies",
    summarySheet: ar ? "الملخص" : "Summary",
    sectorsSheet: ar ? "القطاعات" : "Sectors",
    scanSheet: ar ? "المسح المركّب" : "Composite scan",
    breadthSheet: ar ? "الاتساع" : "Breadth",
    picksSheet: ar ? "اختيارات AI" : "AI picks",
    evidenceSheet: ar ? "الأدلة" : "Evidence",
    snapshotSheet: ar ? "لمحة الشركة" : "Company snapshot",
    technicalsSheet: ar ? "التحليل الفني" : "Technicals",
    dividendsSheet: ar ? "التوزيعات" : "Dividends",
    compareSheet: ar ? "المقارنة" : "Comparison",
    resultsSheet: ar ? "النتائج" : "Results",
    ticker: ar ? "الرمز" : "Ticker",
    name: ar ? "الاسم" : "Name",
    sector: ar ? "القطاع" : "Sector",
    close: ar ? "الإغلاق (جنيه)" : "Close (EGP)",
    change: ar ? "التغير %" : "Change %",
    volume: ar ? "الحجم" : "Volume",
    valueMn: ar ? "قيمة التداول (مليون جنيه)" : "Value traded (EGP mn)",
    capMn: ar ? "القيمة السوقية (مليون جنيه)" : "Market cap (EGP mn)",
    pe: "P/E",
    pb: "P/B",
    divYield: ar ? "عائد التوزيع %" : "Div yield %",
    roe: "ROE %",
    eps: "EPS",
    perfYTD: ar ? "الأداء منذ بداية العام %" : "YTD %",
    rating: ar ? "التقييم" : "Rating",
    score: ar ? "الدرجة" : "Score",
    pos52: ar ? "موقع ٥٢ أسبوع %" : "52w position %",
    volRatio: ar ? "الحجم ÷ المتوسط" : "Vol × avg",
    nextEarnings: ar ? "الأرباح القادمة" : "Next earnings",
    stance: ar ? "الاتجاه" : "Stance",
    conviction: ar ? "القناعة (من ٥)" : "Conviction (of 5)",
    engineScore: ar ? "إجماع المحرك (من ١٢ استراتيجية)" : "Ensemble consensus (of 12 strategies)",
    strategiesCol: ar ? "الاستراتيجيات المؤيدة" : "Supporting strategies",
    votesCol: ar ? "أصوات الاستراتيجيات" : "Strategy votes",
    agreementCol: ar ? "توافق الاستراتيجيات %" : "Strategy agreement %",
    entry: ar ? "الدخول" : "Entry",
    stop: ar ? "وقف الخسارة" : "Stop",
    target: ar ? "الهدف" : "Target",
    rr: "R:R",
    horizon: ar ? "أفق الجلسات" : "Horizon (sessions)",
    risk: ar ? "المخاطر" : "Risk",
    evidenceCol: ar ? "الأدلة" : "Evidence",
    thesis: ar ? "الأطروحة" : "Thesis",
    metric: ar ? "المؤشر" : "Metric",
    exDate: ar ? "تاريخ الاستحقاق" : "Ex-date",
    recordDate: ar ? "تاريخ التسجيل" : "Record date",
    payDate: ar ? "تاريخ الصرف" : "Pay date",
    amount: ar ? "القيمة (جنيه/سهم)" : "Amount (EGP/sh)",
    disclaimer: ar
      ? "EGX ديسك تقرير بيانات لأغراض تعليمية — الأسعار مؤجلة (~١٥ دقيقة) وقد تكون أكثر تأخيرًا وقت الإنشاء؛ ليست مشورة استثمارية. تحقق من الأرقام في التطبيق قبل أي قرار."
      : "EGX Desk is an educational data report — quotes are delayed (~15 min) and may be older at generation time; not investment advice. Verify figures in the app before any decision.",
    filtersApplied: ar ? "الفلاتر المطبقة" : "Filters applied",
    // sheet names / labels for the 22-c upgrades
    coverTocSheet: ar ? "الغلاف" : "Cover",
    gainersSheet: ar ? "الأكثر ارتفاعًا" : "Top gainers",
    losersSheet: ar ? "الأكثر انخفاضًا" : "Top losers",
    activeSheet: ar ? "الأكثر نشاطًا" : "Most active",
    priceHistorySheet: ar ? "تاريخ السعر" : "Price history",
    methodologySheet: ar ? "المنهجية والتعريفات" : "Methodology & definitions",
    methodologyTitle: ar ? "المنهجية والتعريفات" : "Methodology & definitions",
    hourlySheet: ar ? "لمحة التقرير" : "Report snapshot",
    moversSheet: ar ? "مرشحو القفزة" : "Surge candidates",
    date: ar ? "التاريخ" : "Date",
    open: ar ? "الأعلى" : "High",
    lowCol: ar ? "الأدنى" : "Low",
    closeCol: ar ? "الإغلاق" : "Close",
    volCol: ar ? "الحجم" : "Volume",
    dayChangeCol: ar ? "التغير اليومي %" : "Day change %",
    rank: ar ? "الترتيب" : "Rank",
    potential: ar ? "إمكانية القفزة" : "Surge potential",
    reasons: ar ? "الأسباب" : "Reasons",
    catalysts: ar ? "المحفّزات" : "Catalysts",
    riskCol: ar ? "ما يُبطل الفكرة" : "What breaks the idea",
  };
}

const RATING_AR: Record<string, string> = {
  strongBuy: "شراء قوي",
  buy: "شراء",
  neutral: "محايد",
  sell: "بيع",
  strongSell: "بيع قوي",
};

/** reverse of market.ts SECTOR_AR (EN → AR) so English reports can render the
 *  AI pick's sector (the pick type only carries the Arabic sector name). */
const SECTOR_EN: Record<string, string> = Object.fromEntries(
  Object.entries(SECTOR_AR).map(([en, ar]) => [ar, en])
);

// ── sanitizers for client-supplied tables ──

function sanitizeTable(raw: unknown): { columns: string[]; rows: Cell[][] } {
  if (raw === null || typeof raw !== "object") return { columns: [], rows: [] };
  const obj = raw as { columns?: unknown; rows?: unknown };
  const columns = Array.isArray(obj.columns)
    ? obj.columns.filter((c): c is string => typeof c === "string").map((c) => c.slice(0, 80)).slice(0, 30)
    : [];
  const rows = Array.isArray(obj.rows)
    ? obj.rows
        .slice(0, 600)
        .filter((r): r is unknown[] => Array.isArray(r))
        .map((r) =>
          r
            .slice(0, 30)
            .map((c): Cell =>
              typeof c === "number" && Number.isFinite(c)
                ? c
                : typeof c === "string"
                  ? c.slice(0, 300)
                  : null
            )
        )
        .filter((r) => r.length > 0)
    : [];
  return { columns: columns.length ? columns : (rows[0]?.map((_, i) => `#${i + 1}`) ?? []), rows };
}

/** numeric-column detection for client tables → tabular number formats */
function autoFmtFor(rows: Cell[][], colIndex: number): ColFmt {
  let nums = 0;
  let total = 0;
  for (const r of rows.slice(0, 200)) {
    const v = r[colIndex];
    if (v === null || v === "") continue;
    total++;
    if (typeof v === "number") nums++;
  }
  if (total === 0 || nums / total < 0.7) return "text";
  const allInt = rows.every((r) => {
    const v = r[colIndex];
    return v === null || v === "" || (typeof v === "number" && Number.isInteger(v));
  });
  return allInt ? "int" : "num";
}

const nextEarningsTxt = (epoch: number | null | undefined): Cell =>
  epoch && Number.isFinite(epoch) ? new Date(epoch * 1000).toISOString().slice(0, 10) : null;

// ── the endpoint ──

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limiter(ip)) {
    return NextResponse.json({ error: "too many exports — try again later" }, { status: 429 });
  }

  let body: { report?: unknown; lang?: unknown; payload?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const report = typeof body.report === "string" ? body.report : "";
  const lang: Lang = body.lang === "en" ? "en" : "ar";
  const payload = body.payload;
  const L = labels(lang);
  const session = sessionMeta();
  const dateStamp = new Date().toISOString().slice(0, 10);

  const meta = (extra: [string, string][] = []): [string, string][] => [
    [L.session, session.lastSession],
    [L.generatedAt, new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC"],
    [L.source, "EGX Desk — TradingView / Yahoo Finance / stockanalysis.com (delayed ~15 min)"],
    ...extra,
  ];

  let spec: ReportSpec;
  let fileBase: string;

  try {
    switch (report) {
      // ─────────────────────────── server-data reports ───────────────────────────
      case "market": {
        const [stocks, indices] = await Promise.all([fetchUniverse(), fetchIndices()]);
        const rows = [...stocks].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).map(companyRow);
        const table: TableSpec = {
          title: lang === "ar" ? `جميع الشركات المدرجة (${rows.length})` : `All listed companies (${rows.length})`,
          columns: [
            { header: L.ticker, width: 10 },
            { header: L.name, width: 32 },
            { header: L.sector, width: 24 },
            { header: L.close, fmt: "num" },
            { header: L.change, fmt: "pct", condFmt: "changeScale" },
            { header: L.volume, fmt: "int" },
            { header: L.valueMn, fmt: "num", condFmt: "dataBar" },
            { header: L.capMn, fmt: "num" },
            { header: L.pe, fmt: "num" },
            { header: L.pb, fmt: "num" },
            { header: L.divYield, fmt: "pct" },
            { header: L.roe, fmt: "pct" },
            { header: L.perfYTD, fmt: "pct", condFmt: "changeScale" },
          ],
          rows: rows.map((r) => [
            r.ticker,
            lang === "ar" ? r.nameAr : r.name,
            lang === "ar" ? r.sectorAr : r.sectorEn,
            r.close,
            r.changePct,
            r.volume,
            r.valueTraded != null ? +(r.valueTraded / 1e6).toFixed(3) : null,
            r.marketCap != null ? +(r.marketCap / 1e6).toFixed(3) : null,
            r.pe,
            r.pb,
            r.divYield,
            r.roe,
            r.perfYTD,
          ]),
          autoFilter: true,
        };
        // ── 22-c: the market report is now a full desk package — summary
        //    sheet (indices + totals + breadth + gainers/losers/most active)
        //    first, then the complete companies table, all under a cover.
        const up = stocks.filter((c) => c.changePct > 0).length;
        const down = stocks.filter((c) => c.changePct < 0).length;
        const totals = {
          valueTraded: stocks.reduce((a, c) => a + c.valueTraded, 0),
          volume: stocks.reduce((a, c) => a + c.volume, 0),
          marketCap: stocks.reduce((a, c) => a + (c.marketCap ?? 0), 0),
        };
        const summaryTable: TableSpec = {
          title: lang === "ar" ? "إجماليات الجلسة واتساع السوق" : "Session totals & breadth",
          columns: [
            { header: L.metric, width: 34 },
            { header: lang === "ar" ? "القيمة" : "Value", width: 22 },
          ],
          rows: [
            [lang === "ar" ? "عدد الشركات" : "Companies", stocks.length],
            [lang === "ar" ? "مرتفعة" : "Advancing", up],
            [lang === "ar" ? "منخفضة" : "Declining", down],
            [lang === "ar" ? "مستقرة" : "Unchanged", stocks.length - up - down],
            [lang === "ar" ? "قيمة التداول (مليون جنيه)" : "Value traded (EGP mn)", +(totals.valueTraded / 1e6).toFixed(2)],
            [lang === "ar" ? "حجم التداول" : "Volume", totals.volume],
            [lang === "ar" ? "القيمة السوقية (مليار جنيه)" : "Market cap (EGP bn)", +(totals.marketCap / 1e9).toFixed(2)],
          ] as Cell[][],
        };
        const indicesTable: TableSpec = {
          title: lang === "ar" ? "المؤشرات" : "Indices",
          columns: [
            { header: lang === "ar" ? "المؤشر" : "Index", width: 12 },
            { header: L.close, fmt: "num" },
            { header: L.change, fmt: "pct", condFmt: "changeScale" },
            { header: lang === "ar" ? "شهر %" : "1M %", fmt: "pct" },
            { header: lang === "ar" ? "٦ أشهر %" : "6M %", fmt: "pct" },
            { header: L.perfYTD, fmt: "pct", condFmt: "changeScale" },
            { header: lang === "ar" ? "سنة %" : "1Y %", fmt: "pct" },
          ],
          rows: indices.map((i) => [i.code, i.close, i.changePct, i.perf1M, i.perf6M, i.perfYTD, i.perfY]),
        };
        const moversCols = (title: string, sortKey: (a: ReturnType<typeof companyRow>, b: ReturnType<typeof companyRow>) => number): TableSpec => ({
          title,
          columns: [
            { header: L.ticker, width: 10 },
            { header: L.name, width: 30 },
            { header: L.close, fmt: "num" },
            { header: L.change, fmt: "pct", condFmt: "changeScale" },
            { header: L.volume, fmt: "int" },
            { header: L.valueMn, fmt: "num", condFmt: "dataBar" },
          ],
          rows: [...rows].sort(sortKey).slice(0, 10).map((r) => [
            r.ticker,
            lang === "ar" ? r.nameAr : r.name,
            r.close,
            r.changePct,
            r.volume,
            r.valueTraded != null ? +(r.valueTraded / 1e6).toFixed(2) : null,
          ]),
        });
        const gainersTable = moversCols(
          lang === "ar" ? "الأكثر ارتفاعًا (أعلى ١٠)" : "Top gainers (top 10)",
          (a, b) => b.changePct - a.changePct
        );
        const losersTable = moversCols(
          lang === "ar" ? "الأكثر انخفاضًا (أدنى ١٠)" : "Top losers (bottom 10)",
          (a, b) => a.changePct - b.changePct
        );
        const activeTable = moversCols(
          lang === "ar" ? "الأكثر نشاطًا بقيمة التداول (أعلى ١٠)" : "Most active by value traded (top 10)",
          (a, b) => (b.valueTraded ?? 0) - (a.valueTraded ?? 0)
        );
        spec = {
          lang,
          reportTitle: lang === "ar" ? "تقرير السوق — جميع الشركات" : "Market report — all companies",
          meta: meta([[L.rows, String(rows.length)]]),
          cover: {
            toc: [
              { sheet: L.summarySheet, title: lang === "ar" ? "المؤشرات وإجماليات الجلسة والاتساع" : "Indices, session totals & breadth" },
              { sheet: L.gainersSheet, title: lang === "ar" ? "الأكثر ارتفاعًا وانخفاضًا ونشاطًا" : "Gainers, losers & most active" },
              { sheet: L.companiesSheet, title: lang === "ar" ? `جميع الشركات المدرجة (${rows.length})` : `All listed companies (${rows.length})` },
              { sheet: L.methodologySheet, title: lang === "ar" ? "تعريفات الأعمدة والمصادر" : "Column definitions & sources" },
            ],
          },
          sheets: [
            { name: L.summarySheet, tables: [indicesTable, summaryTable] },
            { name: L.gainersSheet, tables: [gainersTable, losersTable, activeTable] },
            { name: L.companiesSheet, tables: [table] },
          ],
          methodology: {
            title: L.methodologyTitle,
            rows: [
              [L.close, lang === "ar" ? "آخر إغلاق متاح من TradingView (مؤجل ~١٥ دقيقة وقد يكون أقدم وقت الإنشاء). بالجنيه المصري." : "Last available close from TradingView (delayed ~15 min, may be older at generation). In EGP."],
              [L.change, lang === "ar" ? "التغير اليومي % مقابل إغلاق الجلسة السابقة. تدرّج لوني: أحمر (هبوط) ← محايد ← أخضر (صعود)." : "Day change % vs the previous session close. Color scale: red (down) → neutral → green (up)."],
              [L.valueMn, lang === "ar" ? "قيمة التداول بالجلسة بالمليون جنيه (الحجم × السعر تقريبيًا). أشرطة بيانات متناسبة مع القيمة." : "Session value traded in EGP millions (volume × price, approximate). Proportional data bars."],
              ["P/E · P/B · ROE", lang === "ar" ? "مقاييس التقييم والربحية من مجمّع TradingView — قد تكون فارغة للشركات غير المُدرجة ببيانات كاملة." : "Valuation & profitability metrics from the TradingView screener — may be empty where the source lacks data."],
              [lang === "ar" ? "الأكثر نشاطًا" : "Most active", lang === "ar" ? "مرتبة بقيمة التداول (مليون جنيه) داخل الجلسة." : "Ranked by session value traded (EGP mn)."],
              [lang === "ar" ? "المصدر" : "Source", "TradingView — delayed ~15 min; EGX Desk generation timestamp on every sheet."],
            ],
          },
          footerNote: L.disclaimer,
        };
        fileBase = "Market";
        break;
      }

      case "overview": {
        const [stocks, indices] = await Promise.all([fetchUniverse(), fetchIndices()]);
        const sectors = sectorRows(stocks);
        const up = stocks.filter((c) => c.changePct > 0).length;
        const down = stocks.filter((c) => c.changePct < 0).length;
        const totals = {
          valueTraded: stocks.reduce((a, c) => a + c.valueTraded, 0),
          volume: stocks.reduce((a, c) => a + c.volume, 0),
          marketCap: stocks.reduce((a, c) => a + (c.marketCap ?? 0), 0),
        };
        const indicesTable: TableSpec = {
          title: lang === "ar" ? "المؤشرات" : "Indices",
          columns: [
            { header: lang === "ar" ? "المؤشر" : "Index", width: 12 },
            { header: L.close, fmt: "num" },
            { header: L.change, fmt: "pct", condFmt: "changeScale" },
            { header: lang === "ar" ? "شهر %" : "1M %", fmt: "pct" },
            { header: lang === "ar" ? "٦ أشهر %" : "6M %", fmt: "pct" },
            { header: L.perfYTD, fmt: "pct", condFmt: "changeScale" },
            { header: lang === "ar" ? "سنة %" : "1Y %", fmt: "pct" },
          ],
          rows: indices.map((i) => [i.code, i.close, i.changePct, i.perf1M, i.perf6M, i.perfYTD, i.perfY]),
        };
        const summaryTable: TableSpec = {
          title: lang === "ar" ? "إجماليات الجلسة واتساع السوق" : "Session totals & breadth",
          columns: [
            { header: L.metric, width: 34 },
            { header: lang === "ar" ? "القيمة" : "Value", width: 22 },
          ],
          rows: [
            [lang === "ar" ? "عدد الشركات" : "Companies", stocks.length],
            [lang === "ar" ? "مرتفعة" : "Advancing", up],
            [lang === "ar" ? "منخفضة" : "Declining", down],
            [lang === "ar" ? "مستقرة" : "Unchanged", stocks.length - up - down],
            [lang === "ar" ? "قيمة التداول (مليون جنيه)" : "Value traded (EGP mn)", +(totals.valueTraded / 1e6).toFixed(2)],
            [lang === "ar" ? "حجم التداول" : "Volume", totals.volume],
            [lang === "ar" ? "القيمة السوقية (مليار جنيه)" : "Market cap (EGP bn)", +(totals.marketCap / 1e9).toFixed(2)],
          ] as Cell[][],
        };
        const sectorTable: TableSpec = {
          title: lang === "ar" ? "أداء القطاعات" : "Sector performance",
          note: lang === "ar" ? "التغير المرجّح بالقيمة السوقية" : "Cap-weighted change",
          columns: [
            { header: L.sector, width: 30 },
            { header: lang === "ar" ? "الشركات" : "Companies", fmt: "int" },
            { header: lang === "ar" ? "مرتفع/منخفض" : "Up/Down", width: 14 },
            { header: L.change, fmt: "pct", condFmt: "changeScale" },
            { header: L.capMn, fmt: "num" },
            { header: L.valueMn, fmt: "num", condFmt: "dataBar" },
            { header: L.pe, fmt: "num" },
            { header: L.pb, fmt: "num" },
            { header: L.roe, fmt: "pct" },
            { header: L.divYield, fmt: "pct" },
          ],
          rows: sectors.map((s) => [
            lang === "ar" ? s.nameAr : s.nameEn,
            s.count,
            `${s.up}/${s.down}`,
            s.capWeightedChangePct,
            +(s.marketCap / 1e6).toFixed(1),
            +(s.valueTraded / 1e6).toFixed(2),
            s.pe,
            s.pb,
            s.roe,
            s.divYield,
          ]),
          autoFilter: true,
        };
        spec = {
          lang,
          reportTitle: lang === "ar" ? "تقرير نظرة عامة على السوق" : "Market overview report",
          meta: meta(),
          cover: {
            toc: [
              { sheet: L.summarySheet, title: lang === "ar" ? "المؤشرات وإجماليات الجلسة والاتساع" : "Indices, session totals & breadth" },
              { sheet: L.sectorsSheet, title: lang === "ar" ? "أداء القطاعات (مرجّح بالقيمة السوقية)" : "Sector performance (cap-weighted)" },
            ],
          },
          sheets: [
            { name: L.summarySheet, tables: [indicesTable, summaryTable] },
            { name: L.sectorsSheet, tables: [sectorTable] },
          ],
          footerNote: L.disclaimer,
        };
        fileBase = "Overview";
        break;
      }

      case "signals": {
        const scan = await scanSignals();
        const table: TableSpec = {
          title: lang === "ar" ? `المسح المركّب — ${scan.scanned} سهم` : `Composite scan — ${scan.scanned} stocks`,
          note:
            lang === "ar"
              ? "مرتبة بالدرجة المركّبة (٥٥٪ فني ١٣ مؤشرًا + ٤٥٪ أساسي)"
              : "Ranked by the composite score (55% technical, 13 indicators + 45% fundamental)",
          columns: [
            { header: "#", fmt: "int", width: 6 },
            { header: L.ticker, width: 10 },
            { header: L.name, width: 30 },
            { header: L.sector, width: 22 },
            { header: L.close, fmt: "num" },
            { header: L.change, fmt: "pct", condFmt: "changeScale" },
            { header: L.rating, width: 13 },
            { header: lang === "ar" ? "الدرجة المركّبة" : "Composite", fmt: "score", condFmt: "changeScale" },
            { header: lang === "ar" ? "فني" : "Tech", fmt: "score", condFmt: "changeScale" },
            { header: lang === "ar" ? "أساسي" : "Fund", fmt: "score", condFmt: "changeScale" },
            { header: lang === "ar" ? "التقييم" : "Valuation", fmt: "score" },
            { header: lang === "ar" ? "الجودة" : "Quality", fmt: "score" },
            { header: lang === "ar" ? "الدخل" : "Income", fmt: "score" },
            { header: "P/E", fmt: "num" },
            { header: "P/B", fmt: "num" },
            { header: "ROE %", fmt: "num" },
            { header: lang === "ar" ? "هامش صافي %" : "Net margin %", fmt: "num" },
            { header: "D/E", fmt: "num" },
            { header: L.divYield, fmt: "num" },
            { header: "RSI", fmt: "num" },
            { header: "SMA50", fmt: "num" },
            { header: "SMA200", fmt: "num" },
            { header: L.pos52, fmt: "pct" },
            { header: L.volRatio, fmt: "ratio", condFmt: "dataBar" },
            { header: lang === "ar" ? "شهر %" : "1M %", fmt: "pct", condFmt: "changeScale" },
            { header: lang === "ar" ? "٦ أشهر %" : "6M %", fmt: "pct" },
            { header: L.perfYTD, fmt: "pct", condFmt: "changeScale" },
            { header: L.nextEarnings, width: 14 },
          ],
          rows: scan.rows.map((r, i) => [
            i + 1,
            r.ticker,
            lang === "ar" ? r.nameAr : r.name,
            lang === "ar" ? r.sectorAr : r.sectorEn,
            r.close,
            r.changePct,
            lang === "ar" ? RATING_AR[r.compositeRating] ?? r.compositeRating : r.compositeRating,
            +r.composite.toFixed(2),
            +r.score.toFixed(2),
            r.fundScore !== null ? +r.fundScore.toFixed(2) : "",
            r.valuation ?? "",
            r.quality ?? "",
            r.income ?? "",
            r.pe,
            r.pb,
            r.roe,
            r.netMarginTTM,
            r.debtToEquity,
            r.divYield,
            r.rsi,
            r.sma50,
            r.sma200,
            r.pos52,
            r.volRatio,
            r.perf1M,
            r.perf6M,
            r.perfYTD,
            r.nextEarnings ?? "",
          ]),
          autoFilter: true,
        };
        const counts: Record<string, number> = { strongBuy: 0, buy: 0, neutral: 0, sell: 0, strongSell: 0 };
        scan.rows.forEach((r) => (counts[r.compositeRating] = (counts[r.compositeRating] ?? 0) + 1));
        const fundCovered = scan.rows.filter((r) => r.fundScore !== null).length;
        const breadth: TableSpec = {
          title: lang === "ar" ? "اتساع التقييمات" : "Rating breadth",
          columns: [
            { header: L.metric, width: 30 },
            { header: lang === "ar" ? "القيمة" : "Value", width: 18 },
          ],
          rows: [
            [lang === "ar" ? "شراء قوي" : "Strong buy", counts.strongBuy],
            [lang === "ar" ? "شراء" : "Buy", counts.buy],
            [lang === "ar" ? "محايد" : "Neutral", counts.neutral],
            [lang === "ar" ? "بيع" : "Sell", counts.sell],
            [lang === "ar" ? "بيع قوي" : "Strong sell", counts.strongSell],
            [lang === "ar" ? "عدد الأسهم المفحوصة" : "Scanned", scan.scanned],
            [lang === "ar" ? "بأساسيات مغطاة" : "With fundamental coverage", fundCovered],
            [lang === "ar" ? "وقت المسح" : "Scan time", scan.asOf.replace("T", " ").slice(0, 16) + " UTC"],
          ] as Cell[][],
        };
        spec = {
          lang,
          reportTitle: lang === "ar" ? "تقرير إشارات المسح المركّب" : "Composite signals scan report",
          meta: meta([[L.rows, String(scan.rows.length)]]),
          cover: {
            toc: [
              { sheet: L.scanSheet, title: lang === "ar" ? `المسح المركّب الكامل (${scan.rows.length} سهم)` : `Full composite scan (${scan.rows.length} stocks)` },
              { sheet: L.breadthSheet, title: lang === "ar" ? "اتساع التقييمات" : "Rating breadth" },
            ],
          },
          sheets: [
            { name: L.scanSheet, tables: [table] },
            { name: L.breadthSheet, tables: [breadth] },
          ],
          footerNote: L.disclaimer,
        };
        fileBase = "Signals";
        break;
      }

      case "ai-signals": {
        const ai = await getLatestAiSignals();
        if (!ai) {
          return NextResponse.json({ error: "no AI signals generated yet — open the AI signals page first" }, { status: 503 });
        }
        const { strategyById } = await import("@/lib/strategies");
        const stances = { long: lang === "ar" ? "شراء" : "Long", avoid: lang === "ar" ? "تجنّب" : "Avoid" } as const;
        const risks = { low: lang === "ar" ? "منخفضة" : "Low", medium: lang === "ar" ? "متوسطة" : "Medium", high: lang === "ar" ? "مرتفعة" : "High" } as const;
        const picksTable: TableSpec = {
          title: lang === "ar" ? `اختيارات النموذج (${ai.picks.length})` : `Model picks (${ai.picks.length})`,
          note: lang === "ar"
            ? `المستويات من معادلات ATR الميثاق — لا يستطيع النموذج تعديلها · مسح ${ai.scanned} سهم · المنظومة: ١٢ استراتيجية مستقلة`
            : `Levels from the charter's fixed ATR math — the model cannot alter them · ${ai.scanned} scanned · ensemble: 12 independent strategies`,
          columns: [
            { header: L.ticker, width: 10 },
            { header: L.name, width: 30 },
            { header: L.sector, width: 22 },
            { header: L.stance, width: 10 },
            { header: L.conviction, fmt: "int", condFmt: "dataBar" },
            { header: L.engineScore, fmt: "score", condFmt: "changeScale" },
            { header: L.votesCol, width: 12 },
            { header: L.agreementCol, fmt: "pct" },
            { header: L.strategiesCol, width: 42 },
            { header: L.close, fmt: "num" },
            { header: L.entry, fmt: "lvl" },
            { header: L.stop, fmt: "lvl" },
            { header: L.target, fmt: "lvl" },
            { header: L.rr, fmt: "num" },
            { header: L.horizon, fmt: "int" },
            { header: L.risk, width: 10 },
            { header: lang === "ar" ? "أرباح في الأفق" : "Earnings in horizon", width: 15 },
            { header: L.evidenceCol, width: 48 },
            { header: L.thesis, width: 60 },
          ],
          rows: ai.picks.map((p) => [
            p.ticker,
            lang === "ar" ? p.nameAr : p.nameEn,
            lang === "ar" ? p.sectorAr : (SECTOR_EN[p.sectorAr] ?? p.sectorAr),
            stances[p.stance],
            p.conviction,
            p.charterScore != null ? +p.charterScore.toFixed(2) : null,
            p.applicable > 0 ? `${p.stance === "long" ? p.longVotes : p.avoidVotes}/${p.applicable}` : "",
            p.applicable > 0 ? +(p.agreement * 100).toFixed(0) : null,
            (p.strategies ?? [])
              .map((id) => {
                const s = strategyById(id);
                return s ? (lang === "ar" ? s.nameAr : s.nameEn) : id;
              })
              .join(" · "),
            p.close,
            p.entry,
            p.stop,
            p.target,
            p.rr,
            p.horizonSessions,
            risks[p.riskLevel],
            p.earningsRisk ?? "",
            p.evidence.join(" · "),
            lang === "ar" ? p.thesisAr : p.thesisEn,
          ]),
          autoFilter: true,
        };
        const biasTable: TableSpec = {
          title: lang === "ar" ? "انحياز السوق والأدلة" : "Market bias & evidence",
          columns: [
            { header: L.metric, width: 30 },
            { header: lang === "ar" ? "القيمة" : "Value", width: 70 },
          ],
          rows: [
            [lang === "ar" ? "الانحياز" : "Bias", ai.marketBias.direction],
            [L.conviction, `${ai.marketBias.conviction}/5`],
            [lang === "ar" ? "الملخص" : "Summary", lang === "ar" ? ai.marketBias.summaryAr : ai.marketBias.summaryEn],
            [lang === "ar" ? "الأسهم الممسوحة" : "Scanned", ai.scanned],
            [lang === "ar" ? "وقت التوليد" : "Generated", ai.generatedAt.replace("T", " ").slice(0, 16) + " UTC"],
            ["Model", `${ai.model} · ${ai.strategyRev} · ${(ai.llmMs / 1000).toFixed(1)}s`],
          ] as Cell[][],
        };
        const bt = (await import("@/data/backtest.json")).default;
        const btStats: [string, string | number][] = [
          [lang === "ar" ? "الصفقات" : "Trades", bt.stats.trades],
          [lang === "ar" ? "نوافذ التقييم" : "Windows", bt.stats.windows],
          [lang === "ar" ? "نسبة النجاح" : "Hit rate", `${(bt.stats.hitRate * 100).toFixed(1)}%`],
          [lang === "ar" ? "الوسيط" : "Median", `${bt.stats.medianNetPct}%`],
          [lang === "ar" ? "متوسط الصافي" : "Avg net", `${bt.stats.avgNetPct}%`],
          [lang === "ar" ? "عامل الربح" : "Profit factor", bt.stats.profitFactor],
          [lang === "ar" ? "متوسط الفائض على السوق" : "Avg excess vs market", `${bt.stats.avgExcessPct}%`],
          [lang === "ar" ? "الاستراتيجية (٣ سنوات)" : "Strategy (3y)", `${bt.stats.strategyCumPct}%`],
          [lang === "ar" ? "السوق (٣ سنوات)" : "Market (3y)", `${bt.stats.benchCumPct}%`],
          [lang === "ar" ? "أقصى تراجع" : "Max drawdown", `${bt.stats.maxDrawdownPct}%`],
        ];
        const btTable: TableSpec = {
          title: lang === "ar" ? "أدلة الاختبار التاريخي (بدون رؤية المستقبل)" : "Backtest evidence (walk-forward, no lookahead)",
          note: String(bt.method).slice(0, 180),
          columns: [
            { header: L.metric, width: 30 },
            { header: lang === "ar" ? "القيمة" : "Value", width: 24 },
          ],
          rows: btStats as Cell[][],
        };
        // T42 — per-strategy standalone backtest rows
        const psTyped = (bt as { perStrategy?: { id: string; nameAr: string; nameEn: string; family: string; backtested: boolean; note?: string; stats?: { trades: number; hitRate: number; avgNetPct: number; profitFactor: number | null; strategyCumPct: number } }[] }).perStrategy ?? [];
        const perStrategyTable: TableSpec = {
          title: lang === "ar" ? "أداء كل استراتيجية على حدة (اختبار مستقل)" : "Per-strategy standalone backtest",
          note: lang === "ar"
            ? "كل استراتيجية اختبرت منفردة بنفس منهجية الاختبار المتحرك — الاستراتيجيتان المباشرتان فقط بلا سجل تاريخي"
            : "Each strategy backtested standalone with the same walk-forward methodology — the two live-only strategies carry no history",
          columns: [
            { header: lang === "ar" ? "الاستراتيجية" : "Strategy", width: 26 },
            { header: lang === "ar" ? "العائلة" : "Family", width: 14 },
            { header: lang === "ar" ? "الصفقات" : "Trades", fmt: "int" },
            { header: lang === "ar" ? "نسبة الصواب" : "Hit rate", fmt: "pct" },
            { header: lang === "ar" ? "متوسط/صفقة" : "Avg/trade", fmt: "num" },
            { header: lang === "ar" ? "معامل الربح" : "Profit factor", fmt: "num" },
            { header: lang === "ar" ? "تراكمي ٣ سنوات" : "3y cumulative", fmt: "pct" },
          ],
          rows: psTyped.map(
            (s): Cell[] =>
              s.backtested && s.stats
                ? [
                    lang === "ar" ? s.nameAr : s.nameEn,
                    s.family,
                    s.stats.trades,
                    +(s.stats.hitRate * 100).toFixed(1),
                    s.stats.avgNetPct,
                    s.stats.profitFactor,
                    s.stats.strategyCumPct,
                  ]
                : [
                    lang === "ar" ? s.nameAr : s.nameEn,
                    s.family,
                    lang === "ar" ? "مباشرة فقط" : "live-only",
                    null,
                    null,
                    null,
                    null,
                  ]
          ),
        };
        spec = {
          lang,
          reportTitle: lang === "ar" ? "تقرير إشارات الذكاء الاصطناعي" : "AI signals report",
          meta: meta([[lang === "ar" ? "المراجعة" : "Revision", ai.strategyRev]]),
          cover: {
            toc: [
              { sheet: L.picksSheet, title: lang === "ar" ? `اختيارات النموذج (${ai.picks.length})` : `Model picks (${ai.picks.length})` },
              { sheet: L.evidenceSheet, title: lang === "ar" ? "الانحياز وأدلة الاختبار التاريخي" : "Bias & backtest evidence" },
            ],
          },
          sheets: [
            { name: L.picksSheet, tables: [picksTable] },
            { name: L.evidenceSheet, tables: [biasTable, btTable, perStrategyTable] },
          ],
          footerNote: L.disclaimer,
        };
        fileBase = "AI-Signals";
        break;
      }

      case "hourly": {
        // ── 22-a/22-c: the Desk Report export — the shared hourly / EOD
        //    "what could surge" briefing as a full analyst workbook.
        const id =
          typeof (payload as { id?: unknown })?.id === "string"
            ? (payload as { id: string }).id.slice(0, 64)
            : "";
        const report = id ? await getReportById(id) : await getLatestReport();
        if (!report) {
          return NextResponse.json({ error: "no desk report generated yet — open the reports page first" }, { status: 503 });
        }
        const potentials = { high: lang === "ar" ? "مرتفعة" : "High", medium: lang === "ar" ? "متوسطة" : "Medium", low: lang === "ar" ? "منخفضة" : "Low" } as const;
        const kindLabel = report.kind === "eod" ? (lang === "ar" ? "التقرير الختامي للجلسة" : "End-of-day report") : lang === "ar" ? `تقرير الساعة ${report.hourLabel}` : `Hourly report ${report.hourLabel}`;

        const snapshotTable: TableSpec = {
          title: lang === "ar" ? "لمحة التقرير" : "Report snapshot",
          columns: [
            { header: L.metric, width: 30 },
            { header: lang === "ar" ? "القيمة" : "Value", width: 78 },
          ],
          rows: [
            [lang === "ar" ? "نوع التقرير" : "Report kind", kindLabel],
            [lang === "ar" ? "الجلسة" : "Session", report.session],
            [lang === "ar" ? "صدر" : "Generated", report.generatedAt.replace("T", " ").slice(0, 16) + " UTC"],
            [lang === "ar" ? "الانحياز" : "Market bias", `${report.marketBias.direction} · ${report.marketBias.conviction}/5`],
            [lang === "ar" ? "ملخص السوق" : "Market summary", lang === "ar" ? report.marketBias.summaryAr : report.marketBias.summaryEn],
            [lang === "ar" ? "سياق الويب" : "Web context", (lang === "ar" ? report.webNotesAr : report.webNotesEn) ?? "—"],
            [lang === "ar" ? "الأسهم الممسوحة" : "Scanned", report.scanned],
            [lang === "ar" ? "المصادر" : "Sources", report.sources.join(" · ") || "—"],
            ["Model", `${report.model} · ${(report.llmMs / 1000).toFixed(1)}s · ${report.webSearches} web searches`],
          ] as Cell[][],
        };
        const moversTable: TableSpec = {
          title: lang === "ar" ? `مرشحو القفزة السعرية (${report.movers.length})` : `Surge candidates (${report.movers.length})`,
          note:
            lang === "ar"
              ? "المستويات من معادلات ATR الميثاق — لا يستطيع النموذج تعديلها · المحفّزات من نتائج بحث حي في الويب مع المصدر"
              : "Levels from the charter's fixed ATR math — the model cannot alter them · catalysts from live web-search results with sources",
          columns: [
            { header: L.ticker, width: 10 },
            { header: L.name, width: 28 },
            { header: L.sector, width: 22 },
            { header: L.close, fmt: "num" },
            { header: L.change, fmt: "pct", condFmt: "changeScale" },
            { header: L.potential, width: 12 },
            { header: L.conviction, fmt: "int", condFmt: "dataBar" },
            { header: L.engineScore, fmt: "score", condFmt: "changeScale" },
            { header: L.entry, fmt: "lvl" },
            { header: L.stop, fmt: "lvl" },
            { header: L.target, fmt: "lvl" },
            { header: L.rr, fmt: "num" },
            { header: L.horizon, fmt: "int" },
            { header: L.reasons, width: 64 },
            { header: L.catalysts, width: 58 },
            { header: L.riskCol, width: 44 },
          ],
          rows: report.movers.map((m) => [
            m.ticker,
            lang === "ar" ? m.nameAr : m.nameEn,
            lang === "ar" ? m.sectorAr : (SECTOR_EN[m.sectorAr] ?? m.sectorAr),
            m.close,
            m.changePct,
            potentials[m.surgePotential],
            m.conviction,
            m.charterScore != null ? +m.charterScore.toFixed(2) : null,
            m.entry,
            m.stop,
            m.target,
            m.rr,
            m.horizonSessions,
            (lang === "ar" ? m.reasonsAr : m.reasonsEn).join(" • "),
            m.catalysts.map((c) => `${(lang === "ar" ? (c.textAr ?? c.text) : c.text)} — ${c.source}${c.date ? ` (${c.date})` : ""}${c.url ? ` — ${c.url}` : ""}`).join(" • ") || "—",
            lang === "ar" ? m.riskAr : m.riskEn,
          ]),
          autoFilter: true,
        };
        spec = {
          lang,
          reportTitle:
            lang === "ar"
              ? `تقرير مكتب EGX — ${kindLabel}`
              : `EGX Desk report — ${kindLabel}`,
          meta: meta([
            [lang === "ar" ? "النوع" : "Kind", kindLabel],
            [lang === "ar" ? "الجلسة" : "Session", report.session],
          ]),
          cover: {
            toc: [
              { sheet: L.hourlySheet, title: lang === "ar" ? "لمحة التقرير: الانحياز والملخص وسياق الويب" : "Snapshot: bias, summary & web context" },
              { sheet: L.moversSheet, title: lang === "ar" ? `مرشحو القفزة مع الأسباب والمحفّزات والمستويات (${report.movers.length})` : `Surge candidates with reasons, catalysts & levels (${report.movers.length})` },
              { sheet: L.methodologySheet, title: lang === "ar" ? "كيف يُكتب التقرير" : "How the report is written" },
            ],
          },
          sheets: [
            { name: L.hourlySheet, tables: [snapshotTable] },
            { name: L.moversSheet, tables: [moversTable] },
          ],
          methodology: {
            title: L.methodologyTitle,
            rows: [
              [lang === "ar" ? "ما هذا التقرير؟" : "What this is", lang === "ar" ? "تقرير مكتب مشارَك: نداء واحد لنموذج GLM (بتفكير موسّع) لكل ساعة تداول أثناء الجلسة، والتقرير الختامي بعد الإغلاق — يُحفظ ويُقدّم لكل الزوار من نفس النسخة (حوسبة مشتركة تجعله مجانيًا)." : "A shared desk report: ONE GLM call (extended thinking) per trading hour while the market is open, plus the final report after the close — persisted and served to every visitor from the same copy (shared compute keeps it free)."],
              [lang === "ar" ? "الأدلة" : "Evidence", lang === "ar" ? "المسح الفني الكامل (١٣ مؤشرًا لكل سهم)، درجات ميثاق الاستراتيجية، أحدث الأسعار المؤجلة، ونتائج بحث حي في الويب للمحفّزات وأخبار الاقتصاد المصري." : "The full technical scan (13 indicators per stock), strategy charter scores, the latest delayed quotes, and live web-search results for catalysts and Egypt macro news."],
              [L.entry, lang === "ar" ? "الدخول = الإغلاق ÷ SMA20 بخصم مساوٍ لـ 0.5×ATR (معادلات الميثاق الثابتة — النموذج لا يستطيع تعديلها)." : "Entry = close vs SMA20 dipped by 0.5×ATR (the charter's fixed math — the model cannot alter it)."],
              [L.stop, lang === "ar" ? "وقف الخسارة = الدخول − 2×ATR. الهدف = الدخول + 3×ATR. نسبة المخاطرة/العائد ≈ 1:1.5." : "Stop = entry − 2×ATR. Target = entry + 3×ATR. Risk/reward ≈ 1:1.5."],
              [L.potential, lang === "ar" ? "تصنيف النموذج لإمكانية القفزة — مقيّد بالانضباط: لا يمكن أن تكون «مرتفعة» لسهم درجة ميثاقه أقل من 0.35." : "The model's surge-potential rating — discipline-capped: never «High» for a candidate whose charter score is below 0.35."],
              [L.catalysts, lang === "ar" ? "من نتائج البحث الحي فقط — كل محفّز يحمل اسم المصدر (والتاريخ والرابط عند توفرهما). لا محفّزات مُختلقة." : "From live web-search results only — every catalyst carries its source name (and date/URL when available). No invented catalysts."],
              [lang === "ar" ? "إخلاء مسؤولية" : "Disclaimer", lang === "ar" ? "بحث احتمالي لأغراض تعليمية — ليس توصية شراء ولا ضمانًا لأي حركة سعرية." : "Probabilistic research for education — not a buy recommendation nor a promise of any price move."],
            ],
          },
          footerNote: L.disclaimer,
        };
        fileBase = `Desk-Report-${report.session}${report.kind === "eod" ? "-EOD" : report.hourLabel ? "-" + report.hourLabel.replace(":", "") : ""}`;
        break;
      }

      case "company": {
        const ticker =
          typeof (payload as { ticker?: unknown })?.ticker === "string"
            ? resolveTicker((payload as { ticker: string }).ticker.toUpperCase())
            : "";
        if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });
        const stocks = await fetchUniverse();
        const s = stocks.find((x) => x.ticker === ticker);
        if (!s) return NextResponse.json({ error: "no such company" }, { status: 404 });
        const c = companyRow(s);
        const snapshot: TableSpec = {
          title: `${c.ticker} — ${lang === "ar" ? c.nameAr : c.name}`,
          columns: [
            { header: L.metric, width: 32 },
            { header: lang === "ar" ? "القيمة" : "Value", width: 26 },
          ],
          rows: [
            [lang === "ar" ? "القطاع" : "Sector", lang === "ar" ? c.sectorAr : c.sectorEn],
            [L.close, c.close],
            [L.change, c.changePct],
            [lang === "ar" ? "التغير (جنيه)" : "Change (EGP)", c.changeAbs],
            [L.volume, c.volume],
            [L.valueMn, c.valueTraded != null ? +(c.valueTraded / 1e6).toFixed(3) : null],
            [L.capMn, c.marketCap != null ? +(c.marketCap / 1e6).toFixed(1) : null],
            ["P/E", c.pe],
            ["P/B", c.pb],
            ["EPS", c.eps],
            [L.divYield, c.divYield],
            ["ROE %", c.roe],
            [lang === "ar" ? "صافي الربح (مليون جنيه)" : "Net income (EGP mn)", c.netIncomeTTM != null ? +(c.netIncomeTTM / 1e6).toFixed(1) : null],
            [lang === "ar" ? "الدين ÷ حقوق الملكية" : "Debt / equity", c.debtToEquity],
            [lang === "ar" ? "أسبوع %" : "1W %", c.perfW],
            [lang === "ar" ? "شهر %" : "1M %", c.perf1M],
            [lang === "ar" ? "٦ أشهر %" : "6M %", c.perf6M],
            [L.perfYTD, c.perfYTD],
            [lang === "ar" ? "سنة %" : "1Y %", c.perfY],
            [lang === "ar" ? "أعلى ٥٢ أسبوعًا" : "52w high", c.high52],
            [lang === "ar" ? "أدنى ٥٢ أسبوعًا" : "52w low", c.low52],
            [L.nextEarnings, nextEarningsTxt(s.nextEarnings)],
          ] as Cell[][],
        };
        const sheets: ReportSpec["sheets"] = [{ name: L.snapshotSheet, tables: [snapshot] }];
        // technicals (best-effort — chart fetch can fail)
        try {
          const sig = await signalForTicker(ticker);
          if (sig) {
            const tech: TableSpec = {
              title: lang === "ar" ? "التقييم الفني (١٣ مؤشرًا)" : "Technical rating (13 indicators)",
              columns: [
                { header: L.metric, width: 32 },
                { header: lang === "ar" ? "القيمة" : "Value", width: 26 },
              ],
              rows: [
                [L.rating, lang === "ar" ? RATING_AR[sig.rating] ?? sig.rating : sig.rating],
                [L.score, +sig.score.toFixed(2)],
                [lang === "ar" ? "إشارات شراء / حياد / بيع" : "Buy / neutral / sell", `${sig.buy} / ${sig.neutral} / ${sig.sell}`],
                ["RSI", sig.rsi],
                ["MACD hist", sig.macdHist],
                ["SMA50", sig.sma50],
                ["SMA200", sig.sma200],
                [L.pos52, sig.pos52],
                [L.volRatio, sig.volRatio],
                [lang === "ar" ? "آخر شمعة" : "Last candle", sig.lastDate],
              ] as Cell[][],
            };
            sheets.push({ name: L.technicalsSheet, tables: [tech] });
          }
        } catch {}
        // dividends (best-effort)
        try {
          const div = await fetchDividends(ticker);
          if (div.rows.length) {
            const divT: TableSpec = {
              title: lang === "ar" ? "تاريخ التوزيعات النقدية" : "Cash dividend history",
              columns: [
                { header: L.exDate, width: 14 },
                { header: L.recordDate, width: 14 },
                { header: L.payDate, width: 14 },
                { header: L.amount, fmt: "num" },
              ],
              rows: div.rows.map((d) => [d.exDate, d.recordDate ?? "", d.payDate ?? "", d.amount]),
            };
            sheets.push({ name: L.dividendsSheet, tables: [divT] });
          }
        } catch {}
        // price history (22-c): one year of REAL daily candles — the sheet a
        // spreadsheet user actually opens a company workbook for
        try {
          const chart = await fetchStockChart(ticker, "1Y");
          if (chart.points.length) {
            let prevClose: number | null = null;
            const histRows = chart.points.map((p) => {
              const dayChange = prevClose !== null && prevClose !== 0 ? +(((p.close - prevClose) / prevClose) * 100).toFixed(2) : null;
              prevClose = p.close;
              return [p.date, p.high ?? null, p.low ?? null, p.close, dayChange, p.volume] as Cell[];
            });
            const hist: TableSpec = {
              title: lang === "ar" ? `تاريخ السعر اليومي — سنة (${chart.points.length} جلسة)` : `Daily price history — 1Y (${chart.points.length} sessions)`,
              note: lang === "ar" ? "شموع Yahoo Finance اليومية بتوقيت القاهرة؛ التغير اليومي محسوب من إغلاق الجلسة السابقة." : "Yahoo Finance daily candles in Cairo time; day change computed from the previous session's close.",
              columns: [
                { header: L.date, width: 12 },
                { header: L.open, fmt: "num" },
                { header: L.lowCol, fmt: "num" },
                { header: L.closeCol, fmt: "num" },
                { header: L.dayChangeCol, fmt: "pct", condFmt: "changeScale" },
                { header: L.volCol, fmt: "int", condFmt: "dataBar" },
              ],
              rows: histRows,
              autoFilter: true,
            };
            sheets.push({ name: L.priceHistorySheet, tables: [hist] });
          }
        } catch {}
        spec = {
          lang,
          reportTitle: lang === "ar" ? `تقرير شركة — ${c.ticker}` : `Company report — ${c.ticker}`,
          meta: meta([[L.ticker, c.ticker]]),
          cover: {
            toc: [
              { sheet: L.snapshotSheet, title: `${c.ticker} — ${lang === "ar" ? c.nameAr : c.name}` },
              { sheet: L.technicalsSheet, title: lang === "ar" ? "التقييم الفني (١٣ مؤشرًا)" : "Technical rating (13 indicators)" },
              { sheet: L.dividendsSheet, title: lang === "ar" ? "تاريخ التوزيعات النقدية" : "Cash dividend history" },
              { sheet: L.priceHistorySheet, title: lang === "ar" ? "تاريخ السعر اليومي — سنة" : "Daily price history — 1Y" },
            ].filter((row) => sheets.some((s) => s.name === row.sheet)) as { sheet: string; title: string }[],
          },
          sheets,
          footerNote: L.disclaimer,
        };
        fileBase = `Company-${ticker}`;
        break;
      }

      case "compare": {
        const tickers = Array.isArray((payload as { tickers?: unknown })?.tickers)
          ? (payload as { tickers: unknown[] }).tickers
              .filter((t): t is string => typeof t === "string")
              .map((t) => t.toUpperCase().replace(/[^A-Z0-9]/g, ""))
              .filter(Boolean)
              .slice(0, 4)
          : [];
        if (!tickers.length) return NextResponse.json({ error: "tickers required" }, { status: 400 });
        const stocks = await fetchUniverse();
        const picked = tickers
          .map((t) => stocks.find((x) => x.ticker === resolveTicker(t)))
          .filter((x): x is NonNullable<typeof x> => !!x);
        if (!picked.length) return NextResponse.json({ error: "no such companies" }, { status: 404 });
        const metrics: [string, (s: (typeof picked)[number]) => Cell][] = [
          [L.close, (s) => s.close],
          [L.change, (s) => s.changePct],
          [L.capMn, (s) => (s.marketCap != null ? +(s.marketCap / 1e6).toFixed(1) : null)],
          ["P/E", (s) => s.pe],
          ["P/B", (s) => s.pb],
          ["EPS", (s) => s.eps],
          [L.divYield, (s) => s.divYield],
          ["ROE %", (s) => s.roe],
          [lang === "ar" ? "صافي الربح (مليون جنيه)" : "Net income (EGP mn)", (s) => (s.netIncomeTTM != null ? +(s.netIncomeTTM / 1e6).toFixed(1) : null)],
          [lang === "ar" ? "الدين ÷ حقوق الملكية" : "Debt / equity", (s) => s.debtToEquity],
          [L.volume, (s) => s.volume],
          [L.valueMn, (s) => (s.valueTraded != null ? +(s.valueTraded / 1e6).toFixed(2) : null)],
          [lang === "ar" ? "أسبوع %" : "1W %", (s) => s.perfW],
          [lang === "ar" ? "شهر %" : "1M %", (s) => s.perf1M],
          [lang === "ar" ? "٦ أشهر %" : "6M %", (s) => s.perf6M],
          [L.perfYTD, (s) => s.perfYTD],
          [lang === "ar" ? "سنة %" : "1Y %", (s) => s.perfY],
          [lang === "ar" ? "أعلى ٥٢ أسبوعًا" : "52w high", (s) => s.high52],
          [lang === "ar" ? "أدنى ٥٢ أسبوعًا" : "52w low", (s) => s.low52],
        ];
        const compareTable: TableSpec = {
          title: lang === "ar" ? "مقارنة جنبًا إلى جنب" : "Side-by-side comparison",
          columns: [
            { header: L.metric, width: 30 },
            ...picked.map((s) => ({ header: s.ticker, width: 16 })),
          ],
          rows: metrics.map(([label, get]) => [label, ...picked.map(get)]),
        };
        spec = {
          lang,
          reportTitle:
            lang === "ar"
              ? `تقرير مقارنة — ${picked.map((s) => s.ticker).join(" · ")}`
              : `Comparison report — ${picked.map((s) => s.ticker).join(" · ")}`,
          meta: meta([[L.ticker, picked.map((s) => s.ticker).join(", ")]]),
          sheets: [{ name: L.compareSheet, tables: [compareTable] }],
          footerNote: L.disclaimer,
        };
        fileBase = `Compare-${picked.map((s) => s.ticker).join("-")}`;
        break;
      }

      // ─────────────────────────── client-data reports ───────────────────────────
      case "screener":
      case "watchlist":
      case "portfolio": {
        const t = sanitizeTable(payload);
        if (!t.rows.length) return NextResponse.json({ error: "no rows to export" }, { status: 400 });
        const filtersText =
          typeof (payload as { filtersText?: unknown })?.filtersText === "string"
            ? (payload as { filtersText: string }).filtersText.slice(0, 500)
            : "";
        const columns: ColSpec[] = t.columns.map((h, i) => ({ header: h, fmt: autoFmtFor(t.rows, i) }));
        const table: TableSpec = {
          title:
            report === "screener"
              ? lang === "ar" ? `نتائج الفرز (${t.rows.length})` : `Screener results (${t.rows.length})`
              : report === "watchlist"
                ? lang === "ar" ? `قائمة المتابعة (${t.rows.length})` : `Watchlist (${t.rows.length})`
                : lang === "ar" ? `المحفظة (${t.rows.length})` : `Portfolio (${t.rows.length})`,
          note: filtersText ? `${L.filtersApplied}: ${filtersText}` : undefined,
          columns,
          rows: t.rows,
          autoFilter: true,
        };
        const titles = {
          screener: lang === "ar" ? "تقرير الفرز" : "Screener report",
          watchlist: lang === "ar" ? "تقرير قائمة المتابعة" : "Watchlist report",
          portfolio: lang === "ar" ? "تقرير المحفظة" : "Portfolio report",
        } as const;
        spec = {
          lang,
          reportTitle: titles[report as "screener" | "watchlist" | "portfolio"],
          meta: meta([[L.rows, String(t.rows.length)]]),
          sheets: [{ name: L.resultsSheet, tables: [table] }],
          footerNote: L.disclaimer,
        };
        fileBase = report.charAt(0).toUpperCase() + report.slice(1);
        break;
      }

      default:
        return NextResponse.json({ error: "unknown report type" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "report data unavailable" }, { status: 502 });
  }

  // build + deliver
  try {
    const buf = await buildReportBuffer(spec);
    const fileName = `EGX-Desk-${fileBase}-${dateStamp}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "could not build the workbook" }, { status: 500 });
  }
}
