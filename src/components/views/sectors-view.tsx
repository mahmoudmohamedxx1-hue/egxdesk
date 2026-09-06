"use client";

import { useApp } from "../market/app-context";
import { useLiveData } from "../market/use-live-data";
import { DivergingBars, DonutChart } from "../market/charts";
import type { SectorCard, SessionMeta } from "../market/types";
import { T, tt } from "@/lib/i18n";
import { fmtNum, fmtValue, fmtPct, directionClass } from "@/lib/format";
import { ChangeCell } from "../market/change-cell";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Building2 } from "lucide-react";

const DONUT_COLORS = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c7", "--c8"] as const;

export function SectorsView() {
  const { lang, navigate } = useApp();
  const { data } = useLiveData<{ session: SessionMeta; total: number; sectors: SectorCard[] }>("/api/sectors");
  const sectors = data?.sectors ?? null;

  if (!sectors) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-52" />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{tt(T.sectors, lang)}</h1>
        <p className="num text-xs text-muted-foreground">
          <span className="font-semibold">{sectors.length}</span> {tt(T.sectorCount, lang)} · {data?.session.lastSession} · {tt(T.delayed, lang)}
        </p>
      </div>
      <p className="text-xs text-muted-foreground -mt-3">{tt(T.sectorClassNote, lang)}</p>

      {/* sector performance chart */}
      <section className="rounded-lg border bg-card p-4 space-y-2">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h2 className="text-base font-bold">{tt(T.sectorPerfChart, lang)}</h2>
          <p className="text-[11px] text-muted-foreground">{tt(T.capWeighted, lang)}</p>
        </div>
        <DivergingBars
          items={sectors.map((s) => ({ label: lang === "ar" ? s.nameAr : s.nameEn, value: s.capWeightedChangePct }))}
          unit="pct"
          lang={lang}
        />
      </section>

      {/* market-cap weight donut */}
      <section className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="text-base font-bold">{tt(T.sectorWeightChart, lang)}</h2>
        <SectorWeightDonut sectors={sectors} lang={lang} />
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {sectors.map((s) => (
          <button
            key={s.code}
            onClick={() => navigate("market")}
            className="group rounded-lg border bg-card p-4 text-start hover:border-ring transition-colors"
          >
            {/* header */}
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                <h2 className="font-bold leading-tight truncate">{lang === "ar" ? s.nameAr : s.nameEn}</h2>
              </div>
              <ChangeCell pct={s.capWeightedChangePct} size="md" />
            </div>

            {/* breadth */}
            <div className="flex items-center gap-2 mb-3 text-xs">
              <span className="num text-muted-foreground">
                <span className="font-semibold">{s.count}</span> {tt(T.companies, lang)}
              </span>
              <span className="flex-1 min-w-8 h-1.5 rounded-full bg-secondary overflow-hidden" aria-hidden>
                <span className={`block h-full ${s.up > 0 ? "bg-up" : ""}`} style={{ width: `${(s.up / s.count) * 100}%`, float: "inline-end" }} />
              </span>
              <span className="inline-flex items-center gap-1 text-up">
                <TrendingUp className="h-3 w-3" aria-hidden />
                <span className="num font-semibold">{s.up}</span>
              </span>
              <span className="inline-flex items-center gap-1 text-down">
                <TrendingDown className="h-3 w-3" aria-hidden />
                <span className="num font-semibold">{s.down}</span>
              </span>
              <span className="num text-muted-foreground">= {s.flat}</span>
            </div>

            {/* metrics */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <Metric label={tt(T.capWeighted, lang)} value={fmtPct(s.capWeightedChangePct)} cls={directionClass(s.capWeightedChangePct)} />
              <Metric label={tt(T.equalWeighted, lang)} value={fmtPct(s.avgChangePct)} cls={directionClass(s.avgChangePct)} />
              <Metric label={tt(T.marketCap, lang)} value={`EGP ${fmtValue(s.marketCap)}`} />
              <Metric label={tt(T.valueTraded, lang)} value={`EGP ${fmtValue(s.valueTraded)}`} />
              <Metric label={lang === "ar" ? "مكرر الربحية (وسيط)" : "P/E (median)"} value={s.pe !== null ? fmtNum(s.pe, 1) : "—"} />
              <Metric label={lang === "ar" ? "عائد التوزيعات (وسيط)" : "Div yield (median)"} value={s.divYield !== null ? `${fmtNum(s.divYield, 1)}%` : "—"} />
            </div>

            {/* movers */}
            <div className="mt-3 pt-3 border-t space-y-1.5">
              {s.biggestMover && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">{tt(T.biggestMover, lang)}</span>
                  <span className="flex items-center gap-2">
                    <span className="num text-sm font-bold">{s.biggestMover.ticker}</span>
                    <ChangeCell pct={s.biggestMover.changePct} />
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                {s.topGainer && (
                  <span className="flex items-center gap-1.5 text-[11px]">
                    <span className="text-muted-foreground">{tt(T.topGainer, lang)}</span>
                    <span className="num font-bold">{s.topGainer.ticker}</span>
                    <ChangeCell pct={s.topGainer.changePct} />
                  </span>
                )}
                {s.topLoser && (
                  <span className="flex items-center gap-1.5 text-[11px]">
                    <span className="text-muted-foreground">{tt(T.topLoser, lang)}</span>
                    <span className="num font-bold">{s.topLoser.ticker}</span>
                    <ChangeCell pct={s.topLoser.changePct} />
                  </span>
                )}
                {s.turnoverLeader && (
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {tt(T.turnoverLeader, lang)}:
                    <span className="num font-bold text-foreground">{s.turnoverLeader.ticker}</span>
                    <span className="num">EGP {fmtValue(s.turnoverLeader.valueTraded)}</span>
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dotted pb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={`num font-medium ${cls ?? ""}`}>{value}</span>
    </div>
  );
}

/** Top sectors by market cap + an "other" bucket, as a donut. */
function SectorWeightDonut({ sectors, lang }: { sectors: SectorCard[]; lang: "ar" | "en" }) {
  const sorted = [...sectors].sort((a, b) => b.marketCap - a.marketCap);
  const top = sorted.slice(0, 7);
  const rest = sorted.slice(7);
  const restCap = rest.reduce((a, s) => a + s.marketCap, 0);
  const items = [
    ...top.map((s, i) => ({
      label: lang === "ar" ? s.nameAr : s.nameEn,
      value: s.marketCap,
      colorVar: DONUT_COLORS[i % DONUT_COLORS.length],
    })),
    ...(restCap > 0
      ? [{ label: `${tt(T.otherSectors, lang)} (${rest.length})`, value: restCap, colorVar: "--c8" as const }]
      : []),
  ];
  const total = items.reduce((a, i) => a + i.value, 0);
  return (
    <DonutChart
      items={items}
      centerTop={`EGP ${fmtValue(total)}`}
      centerBottom={tt(T.totalMarketCap, lang)}
      legendValueFmt={(v) => `EGP ${fmtValue(v)}`}
    />
  );
}
