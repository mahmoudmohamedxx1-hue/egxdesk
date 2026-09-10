"use client";

/** Public data API docs (G18) — a readable, honest reference for the read-only
 *  endpoints this site itself consumes: parameters, what each returns, and the
 *  live "try it" link. Fair use; delayed upstream data; no keys, no quotas,
 *  no guarantees — the same terms the app holds itself to. */

import { useState } from "react";
import { useApp } from "../market/app-context";
import { T, tt } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Braces, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";

type Endpoint = {
  method: "GET";
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
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground max-w-3xl leading-relaxed">
        {tt(T.footerNote, lang)}
      </p>
    </div>
  );
}
