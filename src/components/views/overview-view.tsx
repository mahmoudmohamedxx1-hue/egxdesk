"use client";

import { useState } from "react";
import { useApp } from "../market/app-context";
import { useLiveData, isDeadFeed } from "../market/use-live-data";
import { DivergingBars, BreadthTrend } from "../market/charts";
import { PriceChart } from "../market/price-chart";
import type { CompanyRow, IndexRow, NewsRow, SectorCard, SessionMeta } from "../market/types";
import { T, tt, dn } from "@/lib/i18n";
import { fmtNum, fmtPct, fmtValue, fmtInt, directionClass, fmtDateAr, fmtTimeAr } from "@/lib/format";
import { WatchStar } from "../market/watch-star";
import { FearGreedCard } from "../market/fear-greed-card";
import { ChangeCell } from "../market/change-cell";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ExportXlsxButton } from "../market/export-xlsx-button";
import { ArrowUpRight, ArrowDownRight, MoveRight, RefreshCw, AlertTriangle, Coins, Globe2, Sparkles } from "lucide-react";
import { marketNarrative } from "@/lib/narrative";

type Overview = {
  session: SessionMeta;
  indices: IndexRow[];
  breadth: { total: number; up: number; down: number; flat: number };
  breadthHistory?: { date: string; up: number; down: number; flat: number; counted: number }[];
  flowsSummary?: {
    asOf: string;
    egyNet: number;
    arabNet: number;
    forNet: number;
    retailPct: number;
    instPct: number;
    turnoverTotal: number;
  } | null;
  totals: { valueTraded: number; volume: number; marketCap: number };
  actives: CompanyRow[];
  movers: CompanyRow[];
  colors: CompanyRow[];
  sectorsSnapshot: { best: SectorCard[]; worst: SectorCard[] };
  sectorPerformance?: { nameEn: string; nameAr: string; v: number }[];
  news: NewsRow[];
};

type WorldQuote = {
  key: string;
  nameAr: string;
  nameEn: string;
  group: "index" | "commodity";
  price: number | null;
  changePct: number | null;
  currency: string;
  unitAr: string;
  unitEn: string;
  whyAr: string;
  whyEn: string;
};

type EconomyLite = {
  fx: { code: string; egpPer: number | null }[];
  gold: { egpPerGram21: number | null; egpPerGram: number | null };
  world?: {
    quotes: WorldQuote[];
    silver: { egpPerGram: number | null };
    asOf: string | null;
  } | null;
};

export function OverviewView() {
  const { lang, navigate } = useApp();
  // T41 — the news slice is language-dependent server-side (?lang=en swaps
  // in the real English feed), so the URL must vary with the reader's lang.
  const { data, error, loading, refresh, staleMs } = useLiveData<Overview>(`/api/overview?lang=${lang}`);
  const { data: econ } = useLiveData<EconomyLite>("/api/economy", 600_000);
  const [indexSel, setIndexSel] = useState<string>("EGX30");

  if (isDeadFeed({ error, data, staleMs })) {
    return <ErrorCard lang={lang} onRetry={refresh} />;
  }
  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-8">
      {/* session line */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-muted-foreground num">
          {fmtDateAr(data.session.lastSession)} · {tt(T.delayed, lang)} · {tt(T.updated, lang)}{" "}
          <span className="text-up font-medium">{data.session.cairoTime}</span> {tt(T.cairoTime, lang)}
        </p>
        <Button variant="ghost" size="sm" onClick={refresh} aria-label="refresh">
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="text-xs ms-1">{tt(T.updated, lang)}</span>
        </Button>
        {/* 21-b — indices + breadth + sectors as a branded Excel report */}
        <ExportXlsxButton report="overview" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">{tt(T.marketGlance, lang)}</h1>
      <p className="text-xs text-muted-foreground -mt-4">{tt(T.liveNote, lang)}</p>

      {/* quick links */}
      <div className="grid gap-3 sm:grid-cols-2">
        <button onClick={() => navigate("market")} className="group flex items-center justify-between rounded-lg border bg-card p-4 text-start hover:border-ring transition-colors">
          <div>
            <p className="font-semibold">{tt(T.exploreCompanies, lang)}</p>
            <p className="text-xs text-muted-foreground">{tt(T.exploreHint, lang)}</p>
          </div>
          <MoveRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform rtl:rotate-180" />
        </button>
        <button onClick={() => navigate("watchlist")} className="group flex items-center justify-between rounded-lg border bg-card p-4 text-start hover:border-ring transition-colors">
          <div>
            <p className="font-semibold">{tt(T.yourWatchlist, lang)}</p>
            <p className="text-xs text-muted-foreground">{tt(T.watchlistHint, lang)}</p>
          </div>
          <MoveRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform rtl:rotate-180" />
        </button>
      </div>

      {/* G15 — one plain-language sentence joining the move, breadth, flows and sectors */}
      {(() => {
        const egx30 = data.indices.find((ix) => ix.code === "EGX30") ?? data.indices[0];
        if (!egx30) return null;
        const n = marketNarrative(
          {
            indexName: lang === "ar" ? (egx30.nameAr ?? egx30.name) : egx30.name,
            indexChangePct: egx30.changePct,
            up: data.breadth.up,
            down: data.breadth.down,
            total: data.breadth.total,
            flows: data.flowsSummary
              ? {
                  egyNet: data.flowsSummary.egyNet,
                  arabNet: data.flowsSummary.arabNet,
                  forNet: data.flowsSummary.forNet,
                }
              : null,
            bestSector: data.sectorsSnapshot.best[0]
              ? lang === "ar" ? data.sectorsSnapshot.best[0].nameAr : data.sectorsSnapshot.best[0].nameEn
              : null,
            worstSector: data.sectorsSnapshot.worst[0]
              ? lang === "ar" ? data.sectorsSnapshot.worst[0].nameAr : data.sectorsSnapshot.worst[0].nameEn
              : null,
            topMover: data.movers[0]
              ? { ticker: data.movers[0].ticker, changePct: data.movers[0].changePct }
              : null,
          },
          lang
        );
        if (!n) return null;
        return (
          <section aria-label="market narrative" className="rounded-lg border bg-primary/5 p-4">
            <p className="text-[11px] font-semibold text-primary flex items-center gap-1.5 mb-1.5">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {tt(T.narrativeTitle, lang)}
            </p>
            <p className="text-sm leading-relaxed">{n}</p>
            <p className="text-[10px] text-muted-foreground mt-1.5">{tt(T.narrativeNote, lang)}</p>
          </section>
        );
      })()}

      {/* indices */}
      <section aria-label="indices" className="grid gap-3 sm:grid-cols-3">
        {data.indices.map((ix) => (
          <button key={ix.code} onClick={() => { setIndexSel(ix.code); document.getElementById("index-charts")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} className="rounded-lg border bg-card p-4 text-start hover:border-ring transition-colors">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{lang === "ar" && ix.nameAr ? ix.nameAr : ix.name}</p>
              {ix.perfYTD !== null && (
                <span className={`num text-[10px] font-medium px-1.5 py-0.5 rounded-sm ${directionClass(ix.perfYTD)} ${ix.perfYTD > 0 ? "bg-up-soft" : "bg-down-soft"}`}>
                  {lang === "ar" ? "من بداية العام" : "YTD"} {fmtPct(ix.perfYTD)}
                </span>
              )}
            </div>
            <p className="num text-2xl font-bold tracking-tight">{fmtNum(ix.close, 1)}</p>
            <p className={`num text-sm font-medium ${directionClass(ix.changePct)} flex items-center gap-1`}>
              {ix.changePct >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              {ix.changeAbs > 0 ? "+" : ""}{fmtNum(ix.changeAbs, 1)} ({fmtPct(ix.changePct)})
            </p>
          </button>
        ))}
      </section>

      {/* T57 — fear & greed gauge (foudalens parity) */}
      <FearGreedCard />

      {/* WORLD MARKETS & COMMODITIES — international context on the home page */}
      {econ?.world && econ.world.quotes.some((q) => q.price !== null) && (
        <section aria-label="world markets" className="rounded-lg border bg-card p-4">
          <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-primary" />
              {tt(T.worldHomeTitle, lang)}
            </h2>
            <button onClick={() => navigate("exchange")} className="text-xs text-primary hover:underline">
              {tt(T.seeExchangeFull, lang)}
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{tt(T.worldHomeNote, lang)}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {econ.world.quotes.map((q) => (
              <div key={q.key} className="rounded-md border bg-secondary/30 p-2.5" title={lang === "ar" ? q.whyAr : q.whyEn}>
                <div className="flex items-baseline justify-between gap-1.5">
                  <p className="text-xs font-semibold truncate">{lang === "ar" ? q.nameAr : q.nameEn}</p>
                  {q.changePct !== null && (
                    <span className={`num text-[11px] font-semibold shrink-0 ${directionClass(q.changePct)} flex items-center gap-0.5`}>
                      {q.changePct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {fmtPct(q.changePct)}
                    </span>
                  )}
                </div>
                <p className="num text-lg font-bold tracking-tight mt-0.5">
                  {q.price !== null ? fmtNum(q.price, q.price < 100 ? 2 : 0) : "—"}
                  <span className="text-[9px] font-normal text-muted-foreground ms-1">{q.currency}</span>
                </p>
                <p className="text-[9px] text-muted-foreground leading-snug mt-1 line-clamp-2">{lang === "ar" ? q.whyAr : q.whyEn}</p>
              </div>
            ))}
            {/* gold 21k — the Egyptian retail standard */}
            <div className="rounded-md border bg-secondary/40 p-2.5">
              <div className="flex items-baseline justify-between gap-1.5">
                <p className="text-xs font-semibold truncate flex items-center gap-1">
                  <Coins className="h-3 w-3 text-primary" />
                  {tt(T.goldPerGram21, lang)}
                </p>
              </div>
              <p className="num text-lg font-bold tracking-tight mt-0.5">
                {econ.gold.egpPerGram21 !== null ? fmtNum(econ.gold.egpPerGram21) : "—"}
                <span className="text-[9px] font-normal text-muted-foreground ms-1">{lang === "ar" ? "ج.م" : "EGP"}</span>
              </p>
              <p className="text-[9px] text-muted-foreground leading-snug mt-1">
                {lang === "ar" ? "معيار التجزئة المصري (عيار ٢١) من سعر الأونصة العالمي." : "Egypt's retail standard, from the world ounce price."}
              </p>
            </div>
            {/* silver per gram */}
            {econ.world.silver.egpPerGram != null && (
              <div className="rounded-md border bg-secondary/30 p-2.5">
                <p className="text-xs font-semibold truncate">{tt(T.silverPerGram, lang)}</p>
                <p className="num text-lg font-bold tracking-tight mt-0.5">
                  {fmtNum(econ.world.silver.egpPerGram)}
                  <span className="text-[9px] font-normal text-muted-foreground ms-1">{lang === "ar" ? "ج.م" : "EGP"}</span>
                </p>
                <p className="text-[9px] text-muted-foreground leading-snug mt-1">{tt(T.worldGoldSilver, lang)}</p>
              </div>
            )}
            {/* USD/EGP */}
            {econ.fx.find((f) => f.code === "USD")?.egpPer != null && (
              <div className="rounded-md border bg-secondary/30 p-2.5">
                <p className="text-xs font-semibold truncate">{tt(T.usdEgp, lang)}</p>
                <p className="num text-lg font-bold tracking-tight mt-0.5">
                  {fmtNum(econ.fx.find((f) => f.code === "USD")?.egpPer as number, 3)}
                </p>
                <p className="text-[9px] text-muted-foreground leading-snug mt-1">
                  {lang === "ar" ? "سعر السوق المفتوح (مرجع، ليس رسمياً)." : "Open-market reference rate."}
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* index price charts */}
      <section id="index-charts" aria-label="index price charts" className="rounded-lg border bg-card p-4 scroll-mt-24">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-lg font-bold">{tt(T.indexChartTitle, lang)}</h2>
          <p className="text-[11px] text-muted-foreground">{tt(T.indexChartNote, lang)}</p>
        </div>
        <div className="flex items-center gap-1.5 mb-3 flex-wrap" role="tablist" aria-label={tt(T.indexChartTitle, lang)}>
          {data.indices.map((ix) => {
            const active = indexSel === ix.code;
            return (
              <button
                key={ix.code}
                role="tab"
                aria-selected={active}
                onClick={() => setIndexSel(ix.code)}
                className={`num rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  active ? "bg-secondary font-semibold border-ring" : "text-muted-foreground hover:bg-accent/50"
                }`}
              >
                {ix.code}
              </button>
            );
          })}
        </div>
        <PriceChart key={indexSel} symbol={indexSel} defaultRange="3M" />
      </section>

      {/* session totals + breadth */}
      <section aria-label="session totals" className="rounded-lg border bg-card p-4">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-lg font-bold">{tt(T.sessionTotals, lang)}</h2>
          <div className="flex items-center gap-1.5">
            <Badge label={tt(T.rose, lang)} value={data.breadth.up} cls="text-up bg-up-soft" />
            <Badge label={tt(T.fell, lang)} value={data.breadth.down} cls="text-down bg-down-soft" />
            <Badge label={tt(T.steady, lang)} value={data.breadth.flat} cls="text-muted-foreground bg-secondary" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Stat label={tt(T.valueTradedTotal, lang)} value={`EGP ${fmtValue(data.totals.valueTraded)}`} />
          <Stat label={tt(T.volumeTotal, lang)} value={fmtInt(data.totals.volume)} />
          <Stat label={tt(T.capTotal, lang)} value={`EGP ${fmtValue(data.totals.marketCap)}`} />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {lang === "ar" ? "القيمة ≈ حجم الجلسة × آخر سعر لكل سهم." : "Value ≈ session volume × last price per stock."}
        </p>
        {data.breadthHistory && data.breadthHistory.length > 1 && (
          <div className="mt-3 pt-3 border-t">
            <p className="text-xs font-semibold text-muted-foreground mb-1">
              {lang === "ar" ? "اتساع حركة السوق — آخر الجلسات المسجلة" : "Market breadth trend — recent stored sessions"}
            </p>
            <BreadthTrend data={data.breadthHistory} lang={lang} />
          </div>
        )}
      </section>

      {/* behind the market move — real investor-category net flows */}
      {data.flowsSummary && (
        <section aria-label="behind the move" className="rounded-lg border bg-card p-4">
          <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
            <h2 className="text-lg font-bold">{tt(T.behindMove, lang)}</h2>
            <button onClick={() => navigate("investors")} className="text-xs text-primary hover:underline">
              {tt(T.seeInvestorFlows, lang)}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mb-3">{tt(T.behindMoveNote, lang)}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              {([
                [tt(T.egyptiansTotal, lang), data.flowsSummary.egyNet],
                [tt(T.arabsTotal, lang), data.flowsSummary.arabNet],
                [tt(T.foreignersTotal, lang), data.flowsSummary.forNet],
              ] as const).map(([label, v]) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className={`num font-bold ${v > 0 ? "text-up" : v < 0 ? "text-down" : "text-muted-foreground"}`}>
                    {v > 0 ? "+" : v < 0 ? "−" : ""}
                    {fmtValue(Math.abs(v) * 1_000_000)} <span className="text-[10px] font-normal text-muted-foreground">{lang === "ar" ? "ج.م" : "EGP"}</span>
                  </span>
                </div>
              ))}
              <p className="num text-[10px] text-muted-foreground">{data.flowsSummary.asOf} · {tt(T.netFlowLabel, lang)} ({tt(T.egpMn, lang)})</p>
            </div>
            <div className="rounded-md bg-secondary/60 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">{tt(T.retailVsInst, lang)}</p>
              <div className="flex items-center gap-2 h-3" dir="ltr">
                <div className="h-full rounded-s-sm bg-primary" style={{ width: `${data.flowsSummary.retailPct}%` }} />
                <div className="h-full flex-1 rounded-e-sm bg-muted-foreground/40" />
              </div>
              <div className="flex justify-between text-xs">
                <span className="num">{tt(T.retailShare, lang)} {fmtPct(data.flowsSummary.retailPct, false)}</span>
                <span className="num">{tt(T.instShare, lang)} {fmtPct(data.flowsSummary.instPct, false)}</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* sector snapshot */}
      <section aria-label="sector snapshot">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-bold">{tt(T.sectorSnapshot, lang)}</h2>
          <button onClick={() => navigate("sectors")} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
            {tt(T.viewAll, lang)}
          </button>
        </div>
        {data.sectorPerformance && data.sectorPerformance.length > 0 && (
          <div className="rounded-lg border bg-card p-4 mb-3">
            <p className="text-xs font-semibold mb-2">{tt(T.sectorPerfChart, lang)}</p>
            <DivergingBars
              items={data.sectorPerformance.map((s) => ({
                label: lang === "ar" ? s.nameAr : s.nameEn,
                value: s.v,
              }))}
              unit="pct"
              lang={lang}
              compact
            />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
          <SectorMini title={tt(T.strongest, lang)} sectors={data.sectorsSnapshot.best} lang={lang} onOpen={() => navigate("sectors")} />
          <SectorMini title={tt(T.weakest, lang)} sectors={data.sectorsSnapshot.worst} lang={lang} onOpen={() => navigate("sectors")} />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{tt(T.capWeighted, lang)} · {tt(T.sectorClassNote, lang)}</p>
      </section>

      {/* unusual volume actives */}
      <section aria-label="most active">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-bold">{tt(T.activeStocks, lang)}</h2>
          <button onClick={() => navigate("activity")} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
            {tt(T.viewAll, lang)}
          </button>
        </div>
        <div className="rounded-lg border bg-card divide-y">
          {data.actives.map((r) => (
            <div key={r.ticker} role="button" tabIndex={0} onClick={() => navigate("company", { ticker: r.ticker, panel: "overview" })}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") navigate("company", { ticker: r.ticker, panel: "overview" }); }}
              className="flex w-full items-center gap-3 p-3 text-start hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring outline-none cursor-pointer transition-colors">
              <WatchStar ticker={r.ticker} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="num text-sm font-bold">{r.ticker}</span>
                  <ChangeCell pct={r.changePct} />
                </div>
                <p className="truncate text-xs text-muted-foreground">{dn(r, lang)}</p>
              </div>
              <div className="text-end shrink-0">
                <p className="num text-sm font-semibold text-primary">{fmtNum(r.volumeRatio, 1)}×</p>
                <p className="text-[10px] text-muted-foreground">{lang === "ar" ? "حجم ÷ المعتاد" : "vol ÷ usual"}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{tt(T.unusualNote, lang)}</p>
      </section>

      {/* market colors grid */}
      <section aria-label="market colors">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-bold">{tt(T.marketColors, lang)}</h2>
          <button onClick={() => navigate("heat")} className="text-xs text-muted-foreground hover:text-foreground hover:underline">{tt(T.viewAll, lang)}</button>
        </div>
        <p className="mb-2 text-[11px] text-muted-foreground">{tt(T.colorsNote, lang)}</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
          {data.colors.map((r) => (
            <button key={r.ticker} onClick={() => navigate("company", { ticker: r.ticker, panel: "overview" })}
              className={`rounded-md p-2.5 border transition-transform hover:scale-[1.03] ${
                r.changePct > 0 ? "bg-up-soft border-up/20" : r.changePct < 0 ? "bg-down-soft border-down/20" : "bg-secondary"
              }`}>
              <p className="num text-sm font-bold">{r.ticker}</p>
              <p className={`num text-xs font-medium ${directionClass(r.changePct)}`}>{fmtPct(r.changePct)}</p>
            </button>
          ))}
        </div>
      </section>

      {/* biggest movers */}
      <section aria-label="biggest movers">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-bold">{tt(T.biggestMoves, lang)}</h2>
          <button onClick={() => navigate("market")} className="text-xs text-muted-foreground hover:text-foreground hover:underline">{tt(T.viewAll, lang)}</button>
        </div>
        <div className="rounded-lg border bg-card divide-y">
          {data.movers.map((r) => (
            <div key={r.ticker} role="button" tabIndex={0} onClick={() => navigate("company", { ticker: r.ticker, panel: "overview" })}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") navigate("company", { ticker: r.ticker, panel: "overview" }); }}
              className="flex w-full items-center gap-3 p-3 text-start hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring outline-none cursor-pointer transition-colors">
              <WatchStar ticker={r.ticker} />
              <div className="min-w-0 flex-1">
                <span className="num text-sm font-bold">{r.ticker}</span>
                <p className="truncate text-xs text-muted-foreground">{dn(r, lang)}</p>
              </div>
              <div className="num text-sm font-semibold">{fmtNum(r.close)}</div>
              <ChangeCell pct={r.changePct} />
            </div>
          ))}
        </div>
      </section>

      {/* latest news */}
      <section aria-label="latest news">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-bold">{tt(T.latestNews, lang)}</h2>
          <button onClick={() => navigate("today")} className="text-xs text-muted-foreground hover:text-foreground hover:underline">{tt(T.viewAll, lang)}</button>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {data.news.map((n) => (
            <a key={n.id} href={n.link} target="_blank" rel="noopener noreferrer" className="rounded-lg border bg-card p-3.5 text-start hover:border-ring transition-colors">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] font-medium">{n.source}</span>
                {n.categories[0] && <span className="rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-medium">{n.categories[0]}</span>}
                <span className="num text-[10px] text-muted-foreground">{fmtDateAr(n.publishedAt)} · {fmtTimeAr(n.publishedAt)}</span>
              </div>
              <p className="text-sm font-medium leading-snug line-clamp-2">{n.title}</p>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

function SectorMini({ title, sectors, lang, onOpen }: { title: string; sectors: SectorCard[]; lang: "ar" | "en"; onOpen: () => void }) {
  return (
    <div className="rounded-lg border bg-card divide-y">
      <div className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">{title}</div>
      {sectors.map((s) => (
        <button key={s.code} onClick={onOpen} className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-start hover:bg-accent/40 transition-colors">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{lang === "ar" ? s.nameAr : s.nameEn}</p>
            <p className="text-[11px] text-muted-foreground num">
              {s.count} {tt(T.companies, lang)} · EGP {fmtValue(s.marketCap)}
            </p>
          </div>
          <ChangeCell pct={s.capWeightedChangePct} size="md" />
        </button>
      ))}
    </div>
  );
}

export function ErrorCard({ lang, onRetry }: { lang: "ar" | "en"; onRetry: () => void }) {
  return (
    <div className="rounded-lg border bg-card p-8 text-center space-y-3">
      <AlertTriangle className="h-8 w-8 mx-auto text-muted-foreground" aria-hidden />
      <p className="font-medium">{tt(T.errorLoad, lang)}</p>
      <Button size="sm" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5 me-1.5" />
        {tt(T.retry, lang)}
      </Button>
    </div>
  );
}

function Badge({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
      <span className="num font-bold">{fmtInt(value)}</span>
      {label}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-secondary/50 px-3 py-2.5">
      <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
      <p className="num text-lg font-bold">{value}</p>
    </div>
  );
}
