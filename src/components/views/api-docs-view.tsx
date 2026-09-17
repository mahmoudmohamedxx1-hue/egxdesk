"use client";

/** Public data API docs (G18) — a readable, honest reference for the read-only
 *  endpoints this site itself consumes: parameters, what each returns, and the
 *  live "try it" link. Fair use; delayed upstream data; no keys, no quotas,
 *  no guarantees — the same terms the app holds itself to. */

import { useState } from "react";
import { useApp } from "../market/app-context";
import { T, tt } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Braces, ExternalLink, ChevronDown, ChevronRight, Link2 } from "lucide-react";

type Endpoint = {
  method: "GET" | "POST";
  path: string;
  params?: string[];
  returnsAr: string;
  returnsEn: string;
  source: string;
};

const ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/api/overview",
    returnsAr: "الصفحة الرئيسية كاملة: الجلسة، المؤشرات، الإجماليات، الاتساع، ملخص التدفقات، الأنشطة، المتحركات، القطاعات، آخر الأخبار.",
    returnsEn: "The whole home page: session, indices, totals, breadth, flows summary, actives, movers, sectors, latest news.",
    source: "TradingView · EGXBot · Sigma Capital",
  },
  {
    method: "GET",
    path: "/api/companies?q=&sector=",
    params: ["q — بحث نصي (اختياري)", "sector — كود القطاع (اختياري)"],
    returnsAr: "جدول السوق: ٢٩٦ صفاً بكل المقاييس الحية (السعر، التغير، الأداء، التقييم، المركز المالي).",
    returnsEn: "The market table: 296 rows with every live metric (price, change, performance, valuation, balance-sheet fields).",
    source: "TradingView scanner",
  },
  {
    method: "GET",
    path: "/api/company/{ticker}",
    returnsAr: "صفحة شركة: الصف كاملاً + وسيط القطاع + الأقران + الأخبار المرتبطة + الإفصاحات + الإشارات.",
    returnsEn: "One company: the full row + sector medians + peers + related news + disclosures + signals.",
    source: "TradingView · news archive",
  },
  {
    method: "GET",
    path: "/api/sectors",
    returnsAr: "٢١ قطاعاً بعدد الشركات والصاعد/الهابط والوسائط وأكبر متحرك.",
    returnsEn: "21 sectors with counts, up/down, medians and biggest mover.",
    source: "computed from TradingView",
  },
  {
    method: "GET",
    path: "/api/search?q=",
    params: ["q — حرف واحد على الأقل (عربي أو إنجليزي)"],
    returnsAr: "بحث فوري عن شركة بالرمز أو الاسم أو القطاع — مع التطبيع العربي (أ/إ ← ا).",
    returnsEn: "Type-ahead company search by ticker/name/sector — with Arabic normalization.",
    source: "universe + alias map",
  },
  {
    method: "GET",
    path: "/api/chart?symbol=&range=",
    params: ["symbol — رمز سهم أو EGX30/EGX70/EGX100", "range — 1W|1M|3M|6M|1Y|5Y"],
    returnsAr: "شموع تاريخية حقيقية للأسهم، وإغلاقات جلسات حقيقية للمؤشرات.",
    returnsEn: "Real candles for stocks; real session closes for indices.",
    source: "Yahoo Finance · EGXBot",
  },
  {
    method: "GET",
    path: "/api/news?page=&limit=",
    params: ["page — من ١", "limit — حتى ١٠٠"],
    returnsAr: "أرشيف الأخبار العربي الكامل (أكثر من ٩ آلاف خبر) بالأحدث أولاً.",
    returnsEn: "The full Arabic news archive (9k+ items), newest first.",
    source: "Alborsaa · Amwal Alghad",
  },
  {
    method: "GET",
    path: "/api/news-en",
    returnsAr: "٦٠ خبراً إنجليزياً عن السوق المصري من مصادر عالمية.",
    returnsEn: "60 English Egyptian-market headlines from global publishers.",
    source: "Google News RSS",
  },
  {
    method: "GET",
    path: "/api/investors",
    returnsAr: "تدفقات فئات المستثمرين لليوم (شراء/بيع/صافي لكل فئة) + التاريخ + توزيع الجنسيات.",
    returnsEn: "Today's investor-category flows (buy/sell/net per category) + history + nationality mix.",
    source: "Sigma Capital · EGXBot",
  },
  {
    method: "GET",
    path: "/api/insiders",
    returnsAr: "٣٣٤ تعامل داخلي مسجلة مع روابط مستندات البورصة الرسمية.",
    returnsEn: "334 filed insider dealings with official EGX document links.",
    source: "esthmr.com published documents",
  },
  {
    method: "GET",
    path: "/api/activity",
    returnsAr: "قادة قيمة التداول + الأحجام الاستثنائية + الاتساع.",
    returnsEn: "Turnover leaders + unusual volume + breadth.",
    source: "computed",
  },
  {
    method: "GET",
    path: "/api/statements/{ticker}",
    returnsAr: "القوائم المالية (دخل/مركزي/تدفقات) سنوياً وربع سنوياً بالمليون جنيه.",
    returnsEn: "Financial statements (income/balance/cash flow), annual + quarterly, EGP millions.",
    source: "stockanalysis.com",
  },
  {
    method: "GET",
    path: "/api/dividends/{ticker}",
    returnsAr: "سجل التوزيعات النقدية بتواريخ الاستحقاق والصرف والقيمة لكل سهم.",
    returnsEn: "Cash dividend history with ex-date, record, pay date and per-share amount.",
    source: "stockanalysis.com",
  },
  {
    method: "GET",
    path: "/api/calendar",
    returnsAr: "أحداث التقويم: نتائج متوقعة (مع وسم تقديري)، توزيعات، جمعيات عمومية.",
    returnsEn: "Calendar events: expected results (flagged as estimates), dividends, assemblies.",
    source: "esthmr.com calendar · stockanalysis.com · news archive",
  },
  {
    method: "GET",
    path: "/api/economy",
    returnsAr: "أسعار الصرف والذهب بالعيارات والفضة والأسواق العالمية.",
    returnsEn: "FX rates, gold by karat, silver and world markets.",
    source: "er-api · gold-api · Yahoo",
  },
  {
    method: "GET",
    path: "/api/rates",
    returnsAr: "أسعار الفائدة المصرية: السياسة النقدية، الإقراض الليلي، بين البنوك + موعد القرار القادم.",
    returnsEn: "Egypt interest rates: policy, overnight lending, interbank + next decision date.",
    source: "Trading Economics",
  },
  {
    method: "GET",
    path: "/api/signals",
    returnsAr: "مسح الإشارات عبر كل السوق: ترتيب كل سهم بدرجة ١٣ مؤشراً فنياً (تصنيف من شراء قوي إلى بيع قوي) + RSI و MACD والمتوسطات وموقع السهم من مدى ٥٢ أسبوعاً.",
    returnsEn: "The cross-market signals scan: every stock ranked by a 13-indicator technical score (strong-buy → strong-sell) + RSI, MACD, moving averages and 52-week position.",
    source: "Yahoo Finance candles · TradingView universe",
  },
  {
    method: "POST",
    path: "/api/agent",
    params: ["messages — [{role, content}] آخرها رسالة مستخدم", "lang — \"ar\" | \"en\""],
    returnsAr: "الوكيل الذكي: خطوات استدعاء الأدوات + الإجابة النهائية بصيغة Markdown، مبنية على بيانات حية عبر ١٦ أداة (أسعار، فرز، فني، قوائم، توزيعات، أخبار، إشارات AI، تقارير المكتب…).",
    returnsEn: "The AI agent: tool-call steps + the final markdown answer, built from live data via 16 tools (quotes, screening, technicals, statements, dividends, news, AI signals, desk reports…).",
    source: "z-ai-web-dev-sdk over our own data layer",
  },
  {
    method: "POST",
    path: "/api/assistant",
    params: ["stage — \"plan\" | \"answer\"", "lang — \"ar\" | \"en\"", "context — {view, ticker} حالة التطبيق الحالية", "messages — سجل المحادثة (plan) أو tool/args/result/question (answer)"],
    returnsAr: "دماغ النسخة السحابية لمساعد الموقع المنبثق: مرحلة التخطيط تُرجع {tool, args} أو {reply} بصيغة JSON صارمة ينفّذها المتصفح مباشرة على الموقع، ومرحلة الإجابة تكتب الرد النهائي من نتيجة الأداة الحقيقية. ٢٤٠ نداء/ساعة.",
    returnsEn: "The cloud brain of the popup site-assistant: the plan stage returns strict-JSON {tool, args} or {reply} which the browser executes directly on the website, and the answer stage writes the final reply from the real tool result. 240 calls/hour.",
    source: "z-ai-web-dev-sdk · client execution layer (src/lib/assistant-tools.ts)",
  },
  {
    method: "GET",
    path: "/api/ai-signals",
    returnsAr: "إشارات الذكاء الاصطناعي المشتركة: منظومة من ١٢ استراتيجية مستقلة تصوّت على كل سهم (كل فيشة تحمل الاستراتيجيات التي أطلقت إشارتها وعدد الأصوات والإجماع) — تُحسب كل ٤٥ دقيقة لكل المستخدمين + خطة تنفيذ كاملة لكل فيشة (نطاق دخول، وقف، سلم أهداف ١/٢/٣، نسبة المخاطرة) + سجل الإشارات المنشورة (كل إشارة سابقة تُقاس بأسعار الإغلاق الحقيقية التي جاءت بعدها) + نتائج الاختبار التاريخي للمنظومة ولكل استراتيجية على حدة. مجاني بلا حد قراءة.",
    returnsEn: "The shared AI signals: an ensemble of 12 independent strategies votes on every stock (each pick carries the fired strategies, the vote count and the consensus) — computed once per 45-minute cycle for all users + a full executable plan per pick (entry zone, stop, the T1/T2/T3 ladder, risk %) + the published-signal track record (every past pick scored against the real closing prints that followed it) + the walk-forward backtest of the ensemble AND each strategy standalone. Free, unlimited reads.",
    source: "z-ai-web-dev-sdk (1 shared call/cycle) · our 12-strategy ensemble engine + signals scan",
  },
  {
    method: "GET",
    path: "/api/reports",
    params: ["id — معرّف تقرير محدد (اختياري، للروابط المباشرة)", "wait — ثواني انتظار أول تقرير (اختياري)"],
    returnsAr: "تقارير المكتب المشتركة: تقرير جديد كل ساعة تداول أثناء الجلسة والتقرير الختامي بعد الإغلاق — قراءة السوق + مرشحو القفزة السعرية بالأسباب والمحفّزات المنسوبة للمصادر ومستويات ATR + خط اليوم وأرشيف التقارير الختامية. مجاني بلا حد قراءة (حوسبة مشتركة).",
    returnsEn: "The shared desk reports: a fresh report every trading hour while the market is open and the final end-of-day report after the close — market read + surge candidates with reasons, attributed web catalysts and ATR levels + today's timeline and the EOD archive. Free, unlimited reads (shared compute).",
    source: "z-ai-web-dev-sdk (1 shared call + 2-3 web searches per report) · our strategy engine + live web search",
  },
  {
    method: "GET",
    path: "/api/funds",
    returnsAr: "صفحة الصناديق وأدوات الدخل: بطاقة صندوق إيجي إكس ٣٠ المتداول (سعر موثّق بتاريخه + المؤشر الأساسي الحي وتاريخه اليومي)، الصناديق المقفلة المدرجة بأسعار حية، وطاولة المدّخر (سعر السياسة، ما بين البنوك، الذهب، الدولار، أداء المؤشر).",
    returnsEn: "The funds & income view: the EGX 30 ETF card (dated verified price + the LIVE underlying index and its daily history), the listed closed-end funds with live quotes, and the saver's table (policy rate, interbank, gold, USD, index performance).",
    source: "verified snapshot + TradingView live universe + CBE rates + our index archive",
  },
  {
    method: "GET",
    path: "/api/strategy-lab",
    returnsAr: "الدليل العلني للاستراتيجية: ميثاق المشي-للأمام كاملاً (المنهجية، المعاملات، التكاليف)، إحصاءات التشغيل الكامل، منحنى رأس المال مقابل المرجع، وسجل كل نافذة أعادة توازن بنتائجها.",
    returnsEn: "The public strategy evidence: the full walk-forward charter (methodology, params, costs), full-run statistics, the equity curve vs benchmark, and the complete rebalance-window log with results.",
    source: "scripts/backtest-signals.ts (regenerated) over Yahoo daily candles",
  },
  {
    method: "GET",
    path: "/api/gcc",
    params: ["index — TASI|MT30|DFMGI|ADI (لسلسلة الرسم)", "range — 1M|3M|6M|1Y"],
    returnsAr: "الأسواق الخليجية: مؤشرات السعودية (تاسي وإم تي ٣٠) ودبي وأبوظبي مع الأداء، أكثر الأسهم نشاطًا بقيمة التداول في السوقين، وسلسلة تاريخية لمؤشرات الرسم (تاسي متعدد السنوات، دبي حوالي سنة، أبوظبي سعر فقط — كل مصدر مكتوب بصدق).",
    returnsEn: "GCC markets: Saudi indices (TASI, MT30) plus Dubai and Abu Dhabi with performance, the most-active names by traded value on both boards, and chart history series (TASI multi-year, DFM ~1y, ADX quote-only — every source labeled honestly).",
    source: "TradingView ksa/uae scanners + Yahoo Finance index quotes",
  },
  {
    method: "GET",
    path: "/api/push/key",
    returnsAr: "مفتاح VAPID العام للاشتراك في إشعارات الهاتف (Web Push) — خادم الإشعارات يستخدم المفتاح الخاص.",
    returnsEn: "The public VAPID key for subscribing to phone notifications (web push) — the server keeps the private half.",
    source: "generated per deployment (scripts/gen-vapid.js)",
  },
  {
    method: "POST",
    path: "/api/export",
    params: [
      "report — market|overview|signals|ai-signals|hourly|company|compare|screener|watchlist|portfolio",
      "lang — ar|en",
      "payload — {ticker} للشركة، {tickers[]} للمقارنة، {id} لتقرير المكتب، {columns[], rows[]} لجداول الجهاز",
    ],
    returnsAr: "تقرير Excel احترافي (‎.xlsx) بمعايير مكتب متكامل: صفحة غلاف مع فهرس، رأس مصمم، ترويسات مثبّتة، تنسيقات أرقام، تدرجات لونية وأشرطة بيانات، صفحة منهجية وتعريفات، إعداد طباعة أفقي — وصفحات من اليمين لليسار للعربية.",
    returnsEn: "A full analyst-desk Excel (.xlsx) report: branded cover sheet with table of contents, designed headers, frozen panes, number formats, color scales & data bars, a methodology & definitions sheet, landscape print setup — and right-to-left sheets for Arabic.",
    source: "exceljs · our live data layer",
  },
];

/** 21-c — every page's shareable URL pattern (the routes registry). */
const ROUTES: { pageAr: string; pageEn: string; pattern: string; stateAr: string; stateEn: string }[] = [
  { pageAr: "الرئيسية / نظرة عامة", pageEn: "Home / Overview", pattern: "/?view=home", stateAr: "—", stateEn: "—" },
  { pageAr: "السوق", pageEn: "Market", pattern: "/?view=market", stateAr: "tab=prices|rank|unusual|metrics · sector=كود القطاع", stateEn: "tab=prices|rank|unusual|metrics · sector=sector code" },
  { pageAr: "شركة", pageEn: "Company", pattern: "/?view=company&ticker=COMI", stateAr: "ticker=الرمز · panel=technical|statements|dividends|fundamentals|disclosures|activity|news", stateEn: "ticker · panel=technical|statements|dividends|fundamentals|disclosures|activity|news" },
  { pageAr: "الفرز", pageEn: "Screener", pattern: "/?view=screener", stateAr: "sector= · price=من~إلى · pe= · cap= · volumeMin= · valueMin= · volRatioMin= · range52=high|low · perf=من~إلى · perfPeriod= · sort= · dir=asc", stateEn: "sector= · price=min~max · pe= · cap= · volumeMin= · valueMin= · volRatioMin= · range52=high|low · perf=min~max · perfPeriod= · sort= · dir=asc" },
  { pageAr: "الإشارات", pageEn: "Signals", pattern: "/?view=signals", stateAr: "mode=tech|ai · dir=bull|bear · rating=strongBuy|buy|neutral|sell|strongSell", stateEn: "mode=tech|ai · dir=bull|bear · rating=strongBuy|buy|neutral|sell|strongSell" },
  { pageAr: "التقارير", pageEn: "Reports", pattern: "/?view=reports", stateAr: "id=معرّف تقرير محدد (خط اليوم أو الأرشيف)", stateEn: "id=a specific report id (today's timeline or the archive)" },
  { pageAr: "مختبر الاستراتيجية", pageEn: "Strategy Lab", pattern: "/?view=lab", stateAr: "— (أو ?view=strategy / ?view=backtest كأسماء بديلة)", stateEn: "— (or ?view=strategy / ?view=backtest as aliases)" },
  { pageAr: "الصناديق", pageEn: "Funds", pattern: "/?view=funds", stateAr: "— (أو ?view=etf كاسم بديل)", stateEn: "— (or ?view=etf as an alias)" },
  { pageAr: "الخليج", pageEn: "GCC markets", pattern: "/?view=gcc", stateAr: "— (أو ?view=regional / ?view=gulf كأسماء بديلة)", stateEn: "— (or ?view=regional / ?view=gulf as aliases)" },
  { pageAr: "التداول التجريبي", pageEn: "Paper trading", pattern: "/?view=paper", stateAr: "— (أو ?view=simulator كاسم بديل) — كل الحالة على الجهاز", stateEn: "— (or ?view=simulator as an alias) — all state on-device" },
  { pageAr: "الخريطة الحرارية", pageEn: "Heatmap", pattern: "/?view=heat", stateAr: "scope=all|top30", stateEn: "scope=all|top30" },
  { pageAr: "القطاعات", pageEn: "Sectors", pattern: "/?view=sectors", stateAr: "—", stateEn: "—" },
  { pageAr: "المستثمرون", pageEn: "Investors", pattern: "/?view=investors", stateAr: "—", stateEn: "—" },
  { pageAr: "النشاط", pageEn: "Activity", pattern: "/?view=activity", stateAr: "—", stateEn: "—" },
  { pageAr: "التقويم", pageEn: "Calendar", pattern: "/?view=calendar", stateAr: "—", stateEn: "—" },
  { pageAr: "المقارنة", pageEn: "Compare", pattern: "/?view=compare&tickers=COMI,HDBK", stateAr: "tickers=قائمة الرموز مفصولة بفواصل (حتى ٤)", stateEn: "tickers=comma-separated list (up to 4)" },
  { pageAr: "الأخبار", pageEn: "News", pattern: "/?view=news", stateAr: "feed=ar|en", stateEn: "feed=ar|en" },
  { pageAr: "مساعد AI", pageEn: "AI Agent", pattern: "/?view=agent", stateAr: "q=سؤال مُعبّأ مسبقًا في المحرر (لا يُرسل تلقائيًا)", stateEn: "q=prefills the composer (never auto-sends)" },
  { pageAr: "متابعتي / المحفظة", pageEn: "Watchlist / Portfolio", pattern: "/?view=watchlist", stateAr: "tab=watch|portfolio", stateEn: "tab=watch|portfolio" },
  { pageAr: "الأدوات", pageEn: "Tools", pattern: "/?view=tools", stateAr: "—", stateEn: "—" },
  { pageAr: "البورصة", pageEn: "Exchange", pattern: "/?view=exchange", stateAr: "—", stateEn: "—" },
  { pageAr: "واجهة API", pageEn: "API docs", pattern: "/?view=api", stateAr: "—", stateEn: "—" },
  { pageAr: "كل الروابط", pageEn: "All routes", pattern: "/?view=…&lang=ar|en", stateAr: "lang=ar|en على كل صفحة — يفتح الرابط بلغة المشارك", stateEn: "lang=ar|en on every page — opens in the sharer's language" },
];

export function ApiDocsView() {
  const { lang } = useApp();
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Braces className="h-5 w-5 text-primary" />
          {tt(T.apiDocsTitle, lang)}
        </h1>
        <span className="num text-xs text-muted-foreground">{ENDPOINTS.length} endpoints</span>
      </div>
      <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">{tt(T.apiDocsNote, lang)}</p>

      <div className="rounded-lg border bg-card overflow-hidden divide-y">
        {ENDPOINTS.map((e, i) => {
          const isOpen = open === i;
          return (
            <div key={e.path}>
              <button
                className="w-full flex items-center gap-2 px-4 py-3 text-start hover:bg-accent/30 transition-colors"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
              >
                {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 rtl:rotate-180" />}
                <span className="num text-[10px] font-bold text-primary border border-primary/30 rounded px-1.5 py-0.5 shrink-0">{e.method}</span>
                <code className="num text-xs font-semibold truncate" dir="ltr">{e.path}</code>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 ps-10 space-y-2">
                  {e.params && (
                    <ul className="space-y-1">
                      {e.params.map((p) => (
                        <li key={p} className="text-[11px] text-muted-foreground">
                          · <span className="num">{p}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs leading-relaxed">{lang === "ar" ? e.returnsAr : e.returnsEn}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {lang === "ar" ? "المصدر" : "Source"}: {e.source}
                  </p>
                  {e.method === "GET" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-[11px]"
                      onClick={() => {
                        let tryUrl = e.path;
                        if (e.path.includes("{ticker}")) tryUrl = tryUrl.replace("{ticker}", "COMI");
                        if (e.path.startsWith("/api/search")) tryUrl = "/api/search?q=COMI";
                        if (e.path.startsWith("/api/news?")) tryUrl = "/api/news?page=1&limit=5";
                        if (e.path.startsWith("/api/chart")) tryUrl = "/api/chart?symbol=COMI&range=6M";
                        window.open(tryUrl, "_blank", "noopener");
                      }}
                    >
                      <ExternalLink className="h-3 w-3" />
                      {tt(T.apiTryIt, lang)}
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 21-c — the shareable-routes registry */}
      <section className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" aria-hidden />
          {tt(T.routesTitle, lang)}
        </h2>
        <p className="text-xs text-muted-foreground max-w-3xl leading-relaxed">{tt(T.routesNote, lang)}</p>
        <div className="overflow-x-auto thin-scroll rounded-lg border">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="border-b bg-secondary/60">
              <tr className="text-[11px] text-muted-foreground">
                <th className="text-start font-medium px-3 py-2">{tt(T.routesColPage, lang)}</th>
                <th className="text-start font-medium px-3 py-2">{tt(T.routesColUrl, lang)}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {ROUTES.map((r) => (
                <tr key={r.pattern} className="hover:bg-accent/20">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{lang === "ar" ? r.pageAr : r.pageEn}</td>
                  <td className="px-3 py-2">
                    <code className="num text-[11px] text-primary" dir="ltr">{r.pattern}</code>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{lang === "ar" ? r.stateAr : r.stateEn}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-[11px] text-muted-foreground max-w-3xl leading-relaxed">
        {tt(T.footerNote, lang)}
      </p>
    </div>
  );
}
