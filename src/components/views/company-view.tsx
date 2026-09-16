"use client";

import { useMemo, useState } from "react";
import { patchUrlParams } from "@/lib/url-state";
import { ExportXlsxButton } from "../market/export-xlsx-button";
import { useApp } from "../market/app-context";
import { useLiveData } from "../market/use-live-data";
import type { CompanyRow, NewsRow, SessionMeta } from "../market/types";
import { T, tt, dn } from "@/lib/i18n";
import { fmtNum, fmtValue, fmtPct, fmtPE, fmtInt, fmtDateAr, fmtTimeAr, directionClass } from "@/lib/format";
import { WatchStar } from "../market/watch-star";
import { ChangeCell } from "../market/change-cell";
import { PerfChart, RangeBar } from "../market/perf-chart";
import { PriceChart } from "../market/price-chart";
import { StatementsPanel } from "../market/statements-panel";
import { TechnicalPanel } from "../market/technical-panel";
import { DividendsPanel } from "../market/dividends-panel";
import { SetAlertButton } from "../market/alerts-panel";
import { ValuationPanel, snowflakeScores, dcfPerShare, type CompanyFund, type SectorAgg } from "../market/valuation-panel";
import { Snowflake } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Calculator, TrendingUp, TrendingDown, ExternalLink, RefreshCw, Zap, CalendarClock, FileSpreadsheet } from "lucide-react";

type CompanyData = {
  session: SessionMeta;
  company: CompanyRow & {
    industry: string | null;
    netMarginTTM: number | null;
    revenueTTM: number | null;
    floatShares: number | null;
    avgTurnover30: number | null;
    high1M: number | null;
    low1M: number | null;
    beta: number | null;
    updateMode: string | null;
    employees?: number | null;
  };
  sectorAgg: {
    count: number;
    nameAr: string;
    nameEn: string;
    pe: number | null;
    pb: number | null;
    roe: number | null;
    eps: number | null;
    divYield: number | null;
    beta: number | null;
    avgChangePct: number | null;
  };
  peers: CompanyRow[];
  news: NewsRow[];
  disclosures: NewsRow[];
  signals: {
    streak: { direction: "up" | "down"; count: number; since: string } | null;
    nextEarnings: string | null;
    unusualVolume: boolean;
    volumeRatio: number | null;
    near52High: boolean;
    near52Low: boolean;
    computedFrom: string;
  } | null;
  /** T32 composite signal — the SAME three-pillar engine as the Signals tab
   *  (technical + fundamental + news, 45/30/25 with honest renorm). */
  composite: CompositeSignal | null;
};

type CompositeRating = "strongBuy" | "buy" | "neutral" | "sell" | "strongSell";

type CompositeSignal = {
  ticker: string;
  composite: number;
  compositeRating: CompositeRating;
  score: number; // technical −1…+1
  rating: CompositeRating;
  count: number; // active technical indicators
  fundScore: number | null;
  fundRating: CompositeRating;
  fundCoverage: number;
  valuation: number | null;
  quality: number | null;
  income: number | null;
  fundReasons: string[];
  fundReasonsAr: string[];
  newsScore: number | null;
  newsRating: CompositeRating;
  newsCount: number;
  newsBull: number;
  newsBear: number;
  newsReasons: string[];
  newsReasonsAr: string[];
  rsi: number | null;
  lastDate: string;
};

export function CompanyView({ ticker, panel }: { ticker: string; panel: string }) {
  const { lang, navigate } = useApp();
  const { data, error, refresh } = useLiveData<CompanyData>(`/api/company/${encodeURIComponent(ticker)}`, 60_000);
  const [activePanel, setActivePanel] = useState(panel);
  const [prevPanel, setPrevPanel] = useState(panel);
  if (prevPanel !== panel) {
    // URL panel changed (e.g. navigating from a peer link) — adjust state during render
    setPrevPanel(panel);
    setActivePanel(panel);
  }

  // 21-c — selecting a panel also updates ?panel=… in the URL so the company
  // page is shareable exactly as seen (replaceState: tabs never spam history)
  const selectPanel = (key: string) => {
    setActivePanel(key);
    patchUrlParams({ panel: key === "overview" ? null : key });
  };

  if (error && !data) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center space-y-3">
        <p className="font-medium">{tt(T.errorLoad, lang)}</p>
        <Button size="sm" onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5 me-1.5" />
          {tt(T.retry, lang)}
        </Button>
      </div>
    );
  }

  if (!data || !data.company) {
    if (data && (data as { error?: string }).error === "no such company") {
      return (
        <div className="py-16 text-center space-y-2">
          <p className="text-lg font-semibold">{lang === "ar" ? "لا توجد شركة بهذا الرمز" : "No such company"}</p>
          <button onClick={() => navigate("market")} className="text-sm text-primary hover:underline">
            {tt(T.browseMarket, lang)}
          </button>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const c = data.company;

  const panels = [
    { key: "overview", t: T.panelOverview },
    { key: "valuation", t: { ar: "التقييم", en: "Valuation" } },
    { key: "technical", t: T.panelTechnical },
    { key: "statements", t: T.panelStatements },
    { key: "dividends", t: T.panelDividends },
    { key: "fundamentals", t: T.panelFundamentals },
    { key: "disclosures", t: T.panelDisclosures },
    { key: "activity", t: T.panelActivity },
    { key: "news", t: T.panelNews },
  ];

  const perf = [
    { label: "1W", value: c.perfW },
    { label: "1M", value: c.perf1M },
    { label: "3M", value: c.perf3M },
    { label: "6M", value: c.perf6M },
    { label: "YTD", value: c.perfYTD },
    { label: "1Y", value: c.perfY },
    { label: "3Y", value: c.perf3Y },
    { label: "5Y", value: c.perf5Y },
  ];

  return (
    <div className="space-y-5">
      {/* ticker row */}
      <div className="flex items-center flex-wrap gap-2">
        <span className="num text-lg font-bold">{c.ticker}</span>
        <WatchStar ticker={c.ticker} />
        <button
          onClick={() => navigate("tools")}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent/50 transition-colors"
        >
          <Calculator className="h-3.5 w-3.5" />
          {lang === "ar" ? "احسب عائد الكوبون" : "Compute coupon return"}
        </button>
        <SetAlertButton ticker={c.ticker} close={c.close} />
        {/* 21-b — the full company file (snapshot + technicals + dividends) as a branded Excel report */}
        <ExportXlsxButton report="company" payload={{ ticker: c.ticker }} />
      </div>

      {/* identity + quote */}
      <div className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-xs text-muted-foreground">
              {lang === "ar" ? c.sectorAr : c.sectorEn}
              {c.industry ? ` · ${c.industry}` : ""}
            </p>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{dn(c, lang)}</h1>
            {lang === "ar" && c.nameAr && c.nameAr !== c.name && (
              <p className="text-xs text-muted-foreground truncate">{c.name}</p>
            )}
            {lang === "en" && c.nameAr && (
              <p className="text-xs text-muted-foreground truncate" dir="rtl">{c.nameAr}</p>
            )}
            <p className="num text-xs text-muted-foreground">EGX · EGP · {tt(T.delayed, lang)}</p>
          </div>
          <div className="text-end space-y-0.5">
            <p className="text-xs text-muted-foreground">{tt(T.lastClose, lang)}</p>
            <p className="num text-3xl font-bold tracking-tight">{fmtNum(c.close)}</p>
            <p className={`num text-sm font-semibold ${directionClass(c.changePct)} flex items-center gap-1.5 justify-end`}>
              {c.changePct >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {c.changePct >= 0 ? "+" : ""}{fmtNum(c.changeAbs)} ({fmtPct(c.changePct)})
            </p>
            <p className="num text-[10px] text-muted-foreground">{data.session.lastSession}</p>
          </div>
        </div>

        {/* stat strip */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-3 border-t pt-4">
          <Stat label={tt(T.marketCap, lang)} value={`EGP ${fmtValue(c.marketCap)}`} />
          <Stat label={tt(T.week, lang)} value={fmtPct(c.perfW)} cls={directionClass(c.perfW)} />
          <Stat label={tt(T.month, lang)} value={fmtPct(c.perf1M)} cls={directionClass(c.perf1M)} />
          <Stat label={tt(T.ytd, lang)} value={fmtPct(c.perfYTD)} cls={directionClass(c.perfYTD)} />
          <Stat label={tt(T.volume, lang)} value={fmtInt(c.volume)} sub={`${tt(T.inSession, lang)} · ${tt(T.avg10, lang)} ${fmtInt(c.avgVolume)}`} />
          <Stat label="P/E" value={fmtPE(c.pe)} sub={c.eps ? `EPS ${fmtNum(c.eps)}` : undefined} />
        </div>
      </div>

      {/* panel tabs */}
      <div className="flex items-center gap-1 overflow-x-auto thin-scroll border-b" role="tablist">
        {panels.map((p) => (
          <button
            key={p.key}
            role="tab"
            aria-selected={activePanel === p.key}
            onClick={() => selectPanel(p.key)}
            className={`whitespace-nowrap px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${
              activePanel === p.key ? "border-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tt(p.t, lang)}
            {p.key === "news" && data.news.length > 0 && (
              <span className="num ms-1.5 text-xs text-muted-foreground">{data.news.length}</span>
            )}
            {p.key === "disclosures" && data.disclosures.length > 0 && (
              <span className="num ms-1.5 text-xs text-muted-foreground">{data.disclosures.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {activePanel === "overview" && (
        <div className="space-y-5">
          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="font-bold">{tt(T.priceChart, lang)}</h2>
              <span className="num text-xs text-muted-foreground">{c.ticker} · EGX</span>
            </div>
            <PriceChart key={c.ticker} symbol={c.ticker} defaultRange="6M" />
          </section>

          {/* valuation teaser — surfaces the G10 panel from the overview */}
          <ValuationTeaser company={c} sectorAgg={data.sectorAgg} onOpen={() => selectPanel("valuation")} />

          {/* T32 composite signal — technical + fundamental + news, the SAME
           *  three-pillar engine as the Signals tab, one card per stock */}
          {data.composite && <CompositeSignalCard comp={data.composite} lang={lang} onOpenTechnical={() => selectPanel("technical")} />}

          {data.signals && <SignalsCard signals={data.signals} lang={lang} />}

          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="font-bold">{tt(T.performance, lang)}</h2>
            </div>
            <PerfChart perf={perf} lang={lang} />
            <p className="mt-2 text-[11px] text-muted-foreground">{tt(T.perfNote, lang)}</p>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="font-bold mb-3">{tt(T.range52, lang)}</h2>
            <RangeBar
              low={c.low52}
              high={c.high52}
              close={c.close}
              labelLow={lang === "ar" ? "أدنى ٥٢ أسبوعاً" : "52-week low"}
              labelHigh={lang === "ar" ? "أعلى ٥٢ أسبوعاً" : "52-week high"}
            />
            {c.high1M !== null && c.low1M !== null && (
              <p className="num mt-3 text-[11px] text-muted-foreground">
                {lang === "ar" ? "مدى الشهر:" : "1-month range:"} {fmtNum(c.low1M, 1)} – {fmtNum(c.high1M, 1)}
              </p>
            )}
          </section>
        </div>
      )}

      {/* TECHNICAL ANALYSIS */}
      {activePanel === "technical" && <TechnicalPanel key={c.ticker} ticker={c.ticker} />}

      {/* STATEMENTS */}
      {activePanel === "statements" && (
        <StatementsPanel key={c.ticker} ticker={c.ticker} />
      )}

      {/* DIVIDENDS (G3) */}
      {activePanel === "dividends" && (
        <DividendsPanel key={c.ticker} ticker={c.ticker} close={c.close} />
      )}

      {/* VALUATION (G10) */}
      {activePanel === "valuation" && (
        <ValuationPanel key={c.ticker} company={c} sectorAgg={data.sectorAgg} />
      )}

      {/* DISCLOSURES (press-derived) */}
      {activePanel === "disclosures" && (
        <section className="rounded-lg border bg-card divide-y">
          <div className="px-4 py-3">
            <h2 className="font-bold flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-primary" />
              {tt(T.panelDisclosures, lang)}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground max-w-3xl leading-relaxed">{tt(T.disclosuresNote, lang)}</p>
          </div>
          {data.disclosures.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">{tt(T.noDisclosures, lang)}</p>
          )}
          {data.disclosures.map((n) => (
            <article key={n.id} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] font-medium">{n.source}</span>
                <span className="num text-[11px] text-muted-foreground">{fmtDateAr(n.publishedAt)} · {fmtTimeAr(n.publishedAt)}</span>
              </div>
              <a href={n.link} target="_blank" rel="noopener noreferrer" className="text-sm leading-snug font-medium hover:underline inline-flex items-start gap-1.5">
                {n.title}
                <ExternalLink className="h-3 w-3 mt-1 shrink-0 text-muted-foreground" />
              </a>
              {n.snippet && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{n.snippet}</p>}
            </article>
          ))}
        </section>
      )}

      {/* ACTIVITY */}
      {activePanel === "activity" && (
        <section className="rounded-lg border bg-card p-4 space-y-4">
          <h2 className="font-bold">{tt(T.panelActivity, lang)}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label={tt(T.volume, lang)} value={fmtInt(c.volume)} sub={tt(T.inSession, lang)} />
            <Stat label={tt(T.avg10, lang)} value={fmtInt(c.avgVolume)} />
            <Stat label={tt(T.valueTraded, lang)} value={`EGP ${fmtValue(c.valueTraded)}`} sub={tt(T.inSession, lang)} />
            <Stat label={lang === "ar" ? "الحجم ÷ المعتاد" : "Vol ÷ usual"} value={c.volumeRatio !== null ? `${fmtNum(c.volumeRatio, 1)}×` : "—"} sub={tt(T.inSession, lang)} />
          </div>
          <div className="rounded-md bg-secondary/70 p-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{lang === "ar" ? "الحجم ÷ المعتاد" : "Volume ÷ usual"}</span>
            <span className="num text-lg font-bold text-primary">
              {c.avgVolume ? fmtNum(c.volume / c.avgVolume, 1) + "×" : "—"}
            </span>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1 text-xs">
              <span className="text-muted-foreground">{lang === "ar" ? "مقابل متوسط ١٠ جلسات" : "vs 10-session average"}</span>
              <span className="num">{fmtInt(c.volume)} / {fmtInt(c.avgVolume)}</span>
            </div>
            <div className="h-2 rounded-full bg-secondary overflow-hidden" dir="ltr">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min((c.volume / Math.max(c.avgVolume ?? 1, 1)) * 50, 100)}%` }} />
            </div>
          </div>
          {c.avgTurnover30 !== null && (
            <Stat label={lang === "ar" ? "متوسط قيمة التداول (٣٠ يوماً)" : "Avg turnover (30d)"} value={`EGP ${fmtValue(c.avgTurnover30)}`} />
          )}
          <p className="text-[11px] text-muted-foreground">{tt(T.unusualNote, lang)}</p>
        </section>
      )}

      {/* FUNDAMENTALS */}
      {activePanel === "fundamentals" && (
        <div className="space-y-4">
          <section className="rounded-lg border bg-card p-4">
            <h2 className="font-bold mb-1">{tt(T.fundamentals, lang)}</h2>
            <p className="text-xs text-muted-foreground mb-3">
              {tt(T.vsSector, lang)} — {lang === "ar" ? data.sectorAgg.nameAr : data.sectorAgg.nameEn}{" "}
              <span className="num">({data.sectorAgg.count} {tt(T.companies, lang)})</span>
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
              <VsSector label="P/E" value={c.pe} agg={data.sectorAgg.pe} fmt={(v) => fmtNum(v, 1)} />
              <VsSector label={lang === "ar" ? "م/د (القيمة الدفترية)" : "P/B (book)"} value={c.pb} agg={data.sectorAgg.pb} fmt={(v) => fmtNum(v, 2)} />
              <VsSector label={lang === "ar" ? "العائد على حقوق الملكية" : "ROE"} value={c.roe} agg={data.sectorAgg.roe} fmt={(v) => `${fmtNum(v, 1)}%`} higherBetter />
              <VsSector label="EPS" value={c.eps} agg={data.sectorAgg.eps} fmt={(v) => fmtNum(v)} higherBetter />
              <VsSector label={lang === "ar" ? "عائد التوزيعات" : "Div yield"} value={c.divYield} agg={data.sectorAgg.divYield} fmt={(v) => `${fmtNum(v, 1)}%`} higherBetter />
              <VsSector label={tt(T.beta, lang)} value={c.beta} agg={data.sectorAgg.beta} fmt={(v) => fmtNum(v, 2)} />
              <MetricOnly label={tt(T.netMargin, lang)} value={c.netMarginTTM !== null ? `${fmtNum(c.netMarginTTM, 1)}%` : "—"} />
              <MetricOnly label={lang === "ar" ? "صافي الربح (١٢ شهراً)" : "Net income (TTM)"} value={c.netIncomeTTM !== null ? `EGP ${fmtValue(c.netIncomeTTM)}` : "—"} />
              <MetricOnly label={tt(T.revenueTtm, lang)} value={c.revenueTTM !== null ? `EGP ${fmtValue(c.revenueTTM)}` : "—"} />
              <MetricOnly label={lang === "ar" ? "الدين / حقوق الملكية" : "Debt / equity"} value={c.debtToEquity !== null ? fmtNum(c.debtToEquity, 2) : "—"} />
              <MetricOnly label={lang === "ar" ? "هامش الربح الإجمالي" : "Gross margin"} value={c.grossMarginTTM !== null ? `${fmtNum(c.grossMarginTTM, 1)}%` : "—"} />
              <MetricOnly label={lang === "ar" ? "صافي الدين" : "Net debt"} value={c.netDebt !== null ? `EGP ${fmtValue(c.netDebt)}` : "—"} />
              <MetricOnly label={tt(T.floatShares, lang)} value={c.floatShares !== null ? fmtInt(c.floatShares) : "—"} />
              <MetricOnly label={lang === "ar" ? "الموظفون" : "Employees"} value={c.employees !== null && c.employees !== undefined ? fmtInt(c.employees) : "—"} />
              <MetricOnly label={tt(T.marketCap, lang)} value={`EGP ${fmtValue(c.marketCap)}`} />
            </div>
          </section>

          {/* peers */}
          <section className="rounded-lg border bg-card overflow-hidden">
            <div className="border-b px-4 py-3">
              <h2 className="font-bold">{tt(T.peers, lang)}</h2>
            </div>
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm">
                <thead className="border-b bg-card">
                  <tr className="text-[11px] text-muted-foreground">
                    <th className="text-start font-medium px-3 py-2">{tt(T.colTicker, lang)}</th>
                    <th className="text-start font-medium px-3 py-2 hidden md:table-cell">{tt(T.colName, lang)}</th>
                    <th className="text-end font-medium px-3 py-2">{tt(T.colClose, lang)}</th>
                    <th className="text-end font-medium px-3 py-2">{tt(T.colChange, lang)}</th>
                    <th className="text-end font-medium px-3 py-2 hidden sm:table-cell">{tt(T.marketCap, lang)}</th>
                    <th className="text-end font-medium px-3 py-2 hidden md:table-cell">{tt(T.colPe, lang)}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.peers.map((p) => (
                    <tr key={p.ticker} className="hover:bg-accent/30 cursor-pointer transition-colors"
                      onClick={() => navigate("company", { ticker: p.ticker, panel: "fundamentals" })}>
                      <td className="num px-3 py-2.5 font-bold">{p.ticker}</td>
                      <td className="px-3 py-2.5 hidden md:table-cell max-w-[240px] truncate text-muted-foreground">{dn(p, lang)}</td>
                      <td className="num px-3 py-2.5 text-end font-medium">{fmtNum(p.close)}</td>
                      <td className="px-3 py-2.5 text-end"><ChangeCell pct={p.changePct} /></td>
                      <td className="num px-3 py-2.5 text-end hidden sm:table-cell text-muted-foreground">EGP {fmtValue(p.marketCap)}</td>
                      <td className="num px-3 py-2.5 text-end hidden md:table-cell text-muted-foreground">{fmtPE(p.pe)}</td>
                    </tr>
                  ))}
                  {data.peers.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      {lang === "ar" ? "لا شركات أخرى في هذا التصنيف" : "No other companies in this classification"}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* NEWS */}
      {activePanel === "news" && (
        <section className="rounded-lg border bg-card divide-y">
          <div className="px-4 py-3">
            <h2 className="font-bold">{tt(T.relatedNews, lang)}</h2>
          </div>
          {data.news.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {tt(T.noRelatedNews, lang)}
            </p>
          )}
          {data.news.map((n) => (
            <article key={n.id} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] font-medium">{n.source}</span>
                {n.categories[0] && <span className="rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-medium">{n.categories[0]}</span>}
                <span className="num text-[11px] text-muted-foreground">{fmtDateAr(n.publishedAt)} · {fmtTimeAr(n.publishedAt)}</span>
              </div>
              <a href={n.link} target="_blank" rel="noopener noreferrer" className="text-sm leading-snug font-medium hover:underline inline-flex items-start gap-1.5">
                {n.title}
                <ExternalLink className="h-3 w-3 mt-1 shrink-0 text-muted-foreground" />
              </a>
              {n.snippet && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{n.snippet}</p>}
            </article>
          ))}
        </section>
      )}

      <p className="text-[10px] text-muted-foreground">
        {lang === "ar"
          ? "الشرطة الطويلة تعني غياب البيانات من المصدر. البيانات حية مؤجلة وقد تتغير مع تحديث المصدر."
          : "Em-dashes mean the source has no data for the field. Data is live and delayed, and refreshes with the source."}
      </p>
    </div>
  );
}

// comparison vs sector median
function SignalsCard({
  signals,
  lang,
}: {
  signals: NonNullable<CompanyData["signals"]>;
  lang: "ar" | "en";
}) {
  const items: { icon: React.ReactNode; text: string; cls: string }[] = [];
  if (signals.streak) {
    const up = signals.streak.direction === "up";
    items.push({
      icon: up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />,
      text:
        lang === "ar"
          ? `${signals.streak.count} ${tt(up ? T.signalStreakUp : T.signalStreakDown, lang)} — منذ ${signals.streak.since}`
          : `${signals.streak.count} ${tt(up ? T.signalStreakUp : T.signalStreakDown, lang)} — since ${signals.streak.since}`,
      cls: up ? "text-up bg-up-soft border-up/20" : "text-down bg-down-soft border-down/20",
    });
  }
  if (signals.unusualVolume) {
    items.push({
      icon: <Zap className="h-3.5 w-3.5" />,
      text:
        lang === "ar"
          ? `${tt(T.signalUnusualVol, lang)} — ${fmtNum(signals.volumeRatio ?? 0, 1)}× ${tt(T.avg10, lang)}`
          : `${tt(T.signalUnusualVol, lang)} — ${fmtNum(signals.volumeRatio ?? 0, 1)}× ${tt(T.avg10, lang)}`,
      cls: "text-primary bg-secondary border",
    });
  }
  if (signals.nextEarnings) {
    items.push({
      icon: <CalendarClock className="h-3.5 w-3.5" />,
      text: `${tt(T.signalNextEarnings, lang)}: ${signals.nextEarnings}`,
      cls: "text-foreground bg-secondary border",
    });
  }
  if (signals.near52High) {
    items.push({
      icon: <TrendingUp className="h-3.5 w-3.5" />,
      text: tt(T.signalNear52High, lang),
      cls: "text-up bg-up-soft border-up/20",
    });
  }
  if (signals.near52Low) {
    items.push({
      icon: <TrendingDown className="h-3.5 w-3.5" />,
      text: tt(T.signalNear52Low, lang),
      cls: "text-down bg-down-soft border-down/20",
    });
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="font-bold mb-2">{tt(T.signalsTitle, lang)}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tt(T.noSignals, lang)}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {items.map((it, i) => (
            <li key={i} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${it.cls}`}>
              {it.icon}
              <span className="num">{it.text}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">{tt(T.signalsNote, lang)}</p>
    </section>
  );
}

// ── T32: the composite three-pillar signal card (same engine as the
//  Signals tab): technical + fundamental + news with honest renorm. ──

const COMP_RATING_LABEL: Record<CompositeRating, { ar: string; en: string }> = {
  strongBuy: T.techStrongBuy,
  buy: T.techBuy,
  neutral: T.techNeutral,
  sell: T.techSell,
  strongSell: T.techStrongSell,
};

const COMP_RATING_CLS: Record<CompositeRating, string> = {
  strongBuy: "bg-up-soft text-up border-up/30",
  buy: "bg-up-soft/60 text-up border-up/20",
  neutral: "bg-secondary text-muted-foreground border",
  sell: "bg-down-soft/60 text-down border-down/20",
  strongSell: "bg-down-soft text-down border-down/30",
};

function CompRatingBadge({ rating, lang }: { rating: CompositeRating; lang: "ar" | "en" }) {
  const l = COMP_RATING_LABEL[rating];
  return (
    <span className={`num rounded-md border px-2 py-0.5 text-[11px] font-bold ${COMP_RATING_CLS[rating]}`}>
      {tt(l, lang)}
    </span>
  );
}

/** −1…+1 score bar — center-anchored so the neutral point is visible. */
function CompScoreBar({ score }: { score: number | null }) {
  if (score === null) return <div className="h-1.5 w-full rounded-full bg-secondary" />;
  const pct = Math.min(Math.abs(score), 1) * 50; // 0…50% each side
  const left = score < 0 ? 50 - pct : 50;
  return (
    <div className="relative h-1.5 w-full rounded-full bg-secondary overflow-hidden">
      <div className="absolute inset-y-0 left-1/2 w-px bg-border" aria-hidden />
      <div
        className={`absolute inset-y-0 rounded-full ${score >= 0 ? "bg-up" : "bg-down"}`}
        style={{ left: `${left}%`, width: `${pct}%` }}
      />
    </div>
  );
}

function CompositeSignalCard({
  comp,
  lang,
  onOpenTechnical,
}: {
  comp: CompositeSignal;
  lang: "ar" | "en";
  onOpenTechnical: () => void;
}) {
  const fundReasons = (lang === "ar" ? comp.fundReasonsAr : comp.fundReasons) ?? [];
  const newsReasons = (lang === "ar" ? comp.newsReasonsAr : comp.newsReasons) ?? [];
  const pillars: { label: string; score: number | null; rating: CompositeRating; detail: string }[] = [
    {
      label: tt(T.compPillarTech, lang),
      score: comp.score,
      rating: comp.rating,
      detail:
        comp.rsi !== null
          ? `RSI ${fmtNum(comp.rsi, 1)} · ${comp.count} ${tt(T.techCountsNote, lang)}`
          : `${comp.count} ${tt(T.techCountsNote, lang)}`,
    },
    {
      label: tt(T.compPillarFund, lang),
      score: comp.fundScore,
      rating: comp.fundRating,
      detail:
        comp.fundScore !== null
          ? `V ${comp.valuation !== null ? fmtNum(comp.valuation, 2) : "—"} · Q ${comp.quality !== null ? fmtNum(comp.quality, 2) : "—"} · I ${comp.income !== null ? fmtNum(comp.income, 2) : "—"}`
          : tt(T.compPillarNoData, lang),
    },
    {
      label: tt(T.compPillarNews, lang),
      score: comp.newsScore,
      rating: comp.newsRating,
      detail:
        comp.newsCount > 0
          ? `${comp.newsCount} ${tt(T.compNewsCount, lang)} — ${comp.newsBull}↑ / ${comp.newsBear}↓`
          : tt(T.compNewsNoCoverage, lang),
    },
  ];
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h2 className="font-bold flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" aria-hidden />
          {tt(T.compSignalTitle, lang)}
        </h2>
        <div className="flex items-center gap-2">
          <span className="num text-xs text-muted-foreground">{fmtNum(comp.composite, 2)}</span>
          <CompRatingBadge rating={comp.compositeRating} lang={lang} />
        </div>
      </div>

      <div className="space-y-2.5">
        {pillars.map((p) => (
          <div key={p.label} className="space-y-1">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-medium">{p.label}</span>
              <span className="flex items-center gap-1.5">
                <span className={`num text-xs font-bold ${p.score === null ? "text-muted-foreground" : directionClass(p.score)}`}>
                  {p.score === null ? "—" : p.score > 0 ? "+" : ""}{fmtNum(p.score, 2)}
                </span>
                <CompRatingBadge rating={p.rating} lang={lang} />
              </span>
            </div>
            <CompScoreBar score={p.score} />
            <p className="num text-[10px] text-muted-foreground">{p.detail}</p>
          </div>
        ))}
      </div>

      {(fundReasons.length > 0 || newsReasons.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {fundReasons.slice(0, 3).map((r) => (
            <span key={r} className="num rounded-sm bg-secondary/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {r}
            </span>
          ))}
          {newsReasons.slice(0, 2).map((r) => (
            <span key={r} className="num rounded-sm bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {r}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
        <button onClick={onOpenTechnical} className="text-[11px] text-primary hover:underline">
          {tt(T.panelTechnical, lang)} →
        </button>
        <span className="num text-[10px] text-muted-foreground">{comp.lastDate}</span>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{tt(T.compSignalNote, lang)}</p>
    </section>
  );
}

// comparison vs sector median
function VsSector({ label, value, agg, fmt, higherBetter }: {
  label: string; value: number | null | undefined; agg: number | null | undefined;
  fmt: (v: number) => string; higherBetter?: boolean;
}) {
  const has = typeof value === "number" && typeof agg === "number";
  let better: boolean | null = null;
  if (has) {
    better = higherBetter ? value > agg : value < agg;
  }
  return (
    <div className="border-b border-dotted pb-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="num text-sm font-semibold">{value !== null && value !== undefined ? fmt(value) : "—"}</span>
        {has && (
          <span className={`num text-[10px] px-1 rounded ${better ? "text-up bg-up-soft" : "text-down bg-down-soft"}`}>
            {better ? "▲" : "▼"} {fmt(agg!)}
          </span>
        )}
      </div>
    </div>
  );
}

function MetricOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-dotted pb-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <span className="num text-sm font-semibold">{value}</span>
    </div>
  );
}

function Stat({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
      <p className={`num text-sm font-semibold ${cls ?? ""}`}>{value}</p>
      {sub && <p className="num text-[10px] text-muted-foreground leading-tight">{sub}</p>}
    </div>
  );
}

/** Compact valuation summary on the company overview — built from the exact
 *  same math as the full G10 panel (snowflakeScores + default-assumption
 *  DCF), so the feature is discoverable without hunting for its tab. */
function ValuationTeaser({
  company,
  sectorAgg,
  onOpen,
}: {
  company: CompanyFund;
  sectorAgg: SectorAgg;
  onOpen: () => void;
}) {
  const { lang } = useApp();

  const scores = useMemo(() => snowflakeScores(company, sectorAgg), [company, sectorAgg]);
  const total = useMemo(() => {
    const vals = Object.values(scores).filter((x): x is number => x !== null);
    return vals.length ? vals.reduce((s, x) => s + x, 0) : null;
  }, [scores]);

  const shares =
    company.marketCap && company.close && company.close > 0 ? company.marketCap / company.close : null;
  const fcf0 =
    company.netIncomeTTM != null
      ? company.netIncomeTTM
      : company.revenueTTM != null && company.netMarginTTM != null
        ? company.revenueTTM * company.netMarginTTM
        : null;
  const dcf = fcf0 != null && shares != null ? dcfPerShare(fcf0, 10, 22, 5, company.netDebt ?? 0, shares) : null;
  const upside = dcf && company.close ? (dcf.perShare / company.close - 1) * 100 : null;

  const factors = [
    { key: "value", ar: "القيمة", en: "Value" },
    { key: "future", ar: "المستقبل", en: "Future" },
    { key: "past", ar: "الأداء", en: "Past" },
    { key: "health", ar: "الملاءة", en: "Health" },
    { key: "div", ar: "التوزيعات", en: "Dividends" },
  ];

  return (
    <section className="rounded-lg border bg-card p-4" aria-label="valuation summary">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-bold flex items-center gap-2">
          <Snowflake className="h-4 w-4 text-primary" />
          {lang === "ar" ? "التقييم" : "Valuation"}
        </h2>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onOpen}>
          {tt(T.valTeaserOpen, lang)}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* DCF at defaults */}
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground">{tt(T.valTeaserFairValue, lang)}</p>
          {dcf ? (
            <>
              <p className="num text-2xl font-bold tracking-tight">
                {fmtNum(dcf.perShare)} <span className="text-xs font-normal text-muted-foreground">EGP</span>
              </p>
              {upside != null && (
                <p className={`num text-xs font-semibold ${directionClass(upside)}`}>
                  {/* T38 — fmtPct already signs; the manual "+" doubled it into "++52.53%" */}
                  {fmtPct(upside)} {tt(T.valTeaserVsPrice, lang)}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {lang === "ar" ? "لا تكفي بيانات هذا السهم لبناء النموذج." : "Not enough data to model this stock."}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground leading-relaxed">{tt(T.valTeaserNote, lang)}</p>
        </div>

        {/* five-factor score */}
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground flex items-baseline justify-between">
            {tt(T.valTeaserScore, lang)}
            {total != null && (
              <span className="num text-sm font-bold">
                {fmtNum(total, 1)}
                <span className="text-[10px] font-normal text-muted-foreground"> / 25</span>
              </span>
            )}
          </p>
          <div className="space-y-1">
            {factors.map((f) => {
              const s = scores[f.key];
              return (
                <div key={f.key} className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-14 shrink-0">{lang === "ar" ? f.ar : f.en}</span>
                  <span className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden" aria-hidden>
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: s == null ? 0 : `${(s / 5) * 100}%` }}
                    />
                  </span>
                  <span className="num text-[10px] w-6 text-end text-muted-foreground">{s == null ? "—" : fmtNum(s, 1)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
