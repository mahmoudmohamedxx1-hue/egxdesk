"use client";

import { useApp } from "../market/app-context";
import { useLiveData } from "../market/use-live-data";
import { DivergingBars, DonutChart, TrendLines } from "../market/charts";
import { ErrorCard } from "./overview-view";
import { InsidersPanel } from "./insiders-panel";
import type { FlowCatKey, InvestorsData } from "../market/types";
import { T, tt } from "@/lib/i18n";
import { fmtNum, fmtInt, fmtValue } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, ArrowLeftRight, PieChart as PieIcon, TrendingUp, Landmark, Info } from "lucide-react";

const CAT_META: Record<FlowCatKey, { t: { ar: string; en: string }; colorVar: string }> = {
  EGY_RETAIL: { t: T.egyRetail, colorVar: "--c1" },
  EGY_INST: { t: T.egyInst, colorVar: "--c2" },
  ARAB_RETAIL: { t: T.arabRetail, colorVar: "--c3" },
  ARAB_INST: { t: T.arabInst, colorVar: "--c4" },
  FOR_RETAIL: { t: T.forRetail, colorVar: "--c5" },
  FOR_INST: { t: T.forInst, colorVar: "--c6" },
};

const NATION_COLORS = { egy: "--c1", ar: "--c2", fo: "--c3" } as const;

export function InvestorsView() {
  const { lang } = useApp();
  const { data, error, loading, refresh } = useLiveData<InvestorsData>("/api/investors", 120_000);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24" />
        <Skeleton className="h-56" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (error && !data) return <ErrorCard lang={lang} onRetry={refresh} />;

  const today = data?.today ?? null;
  const part = (data?.history.participation ?? []).filter(
    (p) => p.egyptiansPct !== null || p.arabsPct !== null || p.foreignersPct !== null
  );
  const flowHist = data?.history.flows ?? [];

  const catLabel = (key: FlowCatKey) => tt(CAT_META[key].t, lang);

  return (
    <div className="space-y-5">
      {/* header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{tt(T.investorsTitle, lang)}</h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-2xl leading-relaxed">
          {tt(T.investorsNote, lang)}
        </p>
      </div>

      {today ? (
        <p className="text-xs text-muted-foreground num">
          {tt(T.session, lang)} {today.asOf} · {tt(T.flowsSourceName, lang)}{" "}
          <a
            href={today.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted hover:text-foreground"
          >
            {today.source}
          </a>{" "}
          · {today.scope}
        </p>
      ) : (
        <div className="rounded-lg border border-down/30 bg-down-soft px-4 py-3 text-sm">
          {tt(T.flowsUnavailable, lang)}
        </div>
      )}

      {/* headline stats */}
      {today && (
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Stat
            icon={<ArrowLeftRight className="h-4 w-4" aria-hidden />}
            label={tt(T.totalTurnover, lang)}
            value={`EGP ${fmtNum(today.turnoverTotal, 0)} ${tt(T.egpMn, lang)}`}
          />
          <Stat
            icon={<Landmark className="h-4 w-4" aria-hidden />}
            label={tt(T.oneWayValue, lang)}
            value={`EGP ${fmtNum(today.valueTradedOneWay, 0)} ${tt(T.egpMn, lang)}`}
          />
          <Stat
            icon={<Users className="h-4 w-4" aria-hidden />}
            label={tt(T.retailVsInst, lang)}
            value={`${fmtNum(today.retailPct, 1)}% / ${fmtNum(today.instPct, 1)}%`}
          />
        </section>
      )}

      {/* net flow by category */}
      {today && (
        <Panel title={tt(T.netFlowChart, lang)} note={tt(T.netFlowNote, lang)}>
          <DivergingBars
            items={today.categories.map((c) => ({ label: catLabel(c.key), value: c.net }))}
            unit="egpMn"
            lang={lang}
          />
        </Panel>
      )}

      {/* distribution donut */}
      {today && (
        <Panel title={tt(T.participationChart, lang)}>
          <DonutChart
            items={today.categories.map((c) => ({
              label: catLabel(c.key),
              value: c.turnover,
              colorVar: CAT_META[c.key].colorVar,
            }))}
            centerTop={`EGP ${fmtValue(today.turnoverTotal * 1e6)}`}
            centerBottom={tt(T.totalTurnover, lang)}
            legendValueFmt={(v) => fmtNum(v, 0)}
          />
        </Panel>
      )}

      {/* participation trend */}
      {part.length >= 2 && (
        <Panel
          title={tt(T.participationTrend, lang)}
          note={tt(T.participationTrendNote, lang)}
          icon={<TrendingUp className="h-4 w-4 text-primary" aria-hidden />}
        >
          <TrendLines
            points={part.map((p) => ({
              x: p.date,
              values: { egy: p.egyptiansPct, ar: p.arabsPct, fo: p.foreignersPct },
            }))}
            series={[
              { key: "egy", label: tt(T.egyptiansTotal, lang), colorVar: NATION_COLORS.egy },
              { key: "ar", label: tt(T.arabsTotal, lang), colorVar: NATION_COLORS.ar },
              { key: "fo", label: tt(T.foreignersTotal, lang), colorVar: NATION_COLORS.fo },
            ]}
            yFmt={(v) => `${fmtNum(v, 0)}%`}
          />
        </Panel>
      )}

      {/* net flow history */}
      <Panel
        title={tt(T.flowHistoryChart, lang)}
        note={tt(T.flowHistoryNote, lang)}
        icon={<TrendingUp className="h-4 w-4 text-primary" aria-hidden />}
      >
        {flowHist.length >= 2 ? (
          <TrendLines
            points={flowHist.map((h) => ({
              x: h.date,
              values: { egy: h.egyNet, ar: h.arabNet, fo: h.forNet },
            }))}
            series={[
              { key: "egy", label: tt(T.egyptiansTotal, lang), colorVar: NATION_COLORS.egy },
              { key: "ar", label: tt(T.arabsTotal, lang), colorVar: NATION_COLORS.ar },
              { key: "fo", label: tt(T.foreignersTotal, lang), colorVar: NATION_COLORS.fo },
            ]}
            yFmt={(v) => fmtNum(v, 0)}
          />
        ) : (
          <div className="rounded-md bg-secondary/50 px-4 py-6 text-center text-sm text-muted-foreground">
            <p className="num font-semibold text-foreground mb-1">
              {flowHist.length === 1 ? flowHist[0].date : "—"}
            </p>
            <p className="max-w-md mx-auto leading-relaxed">{tt(T.flowHistoryNote, lang)}</p>
          </div>
        )}
      </Panel>

      {/* detailed table */}
      {today && (
        <section>
          <h2 className="text-lg font-bold mb-3">{tt(T.investorsTitle, lang)}</h2>
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm">
                <thead className="border-b bg-card">
                  <tr className="text-[11px] text-muted-foreground">
                    <th className="text-start font-medium px-3 py-2.5">{tt(T.colCategory, lang)}</th>
                    <th className="text-end font-medium px-3 py-2.5">{tt(T.colBuy, lang)}</th>
                    <th className="text-end font-medium px-3 py-2.5">{tt(T.colSell, lang)}</th>
                    <th className="text-end font-medium px-3 py-2.5">{tt(T.colNet, lang)}</th>
                    <th className="text-end font-medium px-3 py-2.5 hidden sm:table-cell">
                      {tt(T.colTurnoverShort, lang)}
                    </th>
                    <th className="text-end font-medium px-3 py-2.5">{tt(T.colShare, lang)}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {today.categories.map((c) => (
                    <tr key={c.key} className="hover:bg-accent/30 transition-colors">
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ background: `var(${CAT_META[c.key].colorVar})` }}
                            aria-hidden
                          />
                          {catLabel(c.key)}
                        </span>
                      </td>
                      <td className="num px-3 py-2.5 text-end">{fmtNum(c.buy, 0)}</td>
                      <td className="num px-3 py-2.5 text-end">{fmtNum(c.sell, 0)}</td>
                      <td className={`num px-3 py-2.5 text-end font-semibold ${c.net > 0 ? "text-up" : c.net < 0 ? "text-down" : ""}`}>
                        {c.net > 0 ? "+" : ""}
                        {fmtNum(c.net, 0)}
                      </td>
                      <td className="num px-3 py-2.5 text-end hidden sm:table-cell text-muted-foreground">
                        {fmtNum(c.turnover, 0)}
                      </td>
                      <td className="num px-3 py-2.5 text-end">{fmtNum(c.tradingPct, 2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {lang === "ar" ? "القيم بالمليون جنيه مصري." : "All values in EGP millions."} {today.scope}
          </p>
        </section>
      )}

      {/* block trades */}
      {today && today.blockTrades.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3 inline-flex items-center gap-2">
            <PieIcon className="h-4 w-4 text-primary" aria-hidden />
            {tt(T.blockTrades, lang)}
          </h2>
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm">
                <thead className="border-b bg-card">
                  <tr className="text-[11px] text-muted-foreground">
                    <th className="text-start font-medium px-3 py-2.5">{tt(T.colName, lang)}</th>
                    <th className="text-end font-medium px-3 py-2.5">{tt(T.colQty, lang)}</th>
                    <th className="text-end font-medium px-3 py-2.5">{tt(T.colValue, lang)}</th>
                    <th className="text-end font-medium px-3 py-2.5">{tt(T.colDeals, lang)}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {today.blockTrades.map((b) => (
                    <tr key={b.name + b.value} className="hover:bg-accent/30 transition-colors">
                      <td className="px-3 py-2.5 max-w-[280px] truncate">{b.name}</td>
                      <td className="num px-3 py-2.5 text-end">{fmtInt(b.qty)}</td>
                      <td className="num px-3 py-2.5 text-end font-semibold text-primary">EGP {fmtValue(b.value)}</td>
                      <td className="num px-3 py-2.5 text-end text-muted-foreground">{fmtInt(b.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* sources */}
      <section>
        <h2 className="text-base font-bold mb-2 inline-flex items-center gap-2">
          <Info className="h-4 w-4 text-muted-foreground" aria-hidden />
          {tt(T.sourcesTitle, lang)}
        </h2>
        <ul className="text-xs text-muted-foreground space-y-1.5">
          {(data?.sources ?? []).map((s) => (
            <li key={s.name} className="leading-relaxed">
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-dotted hover:text-foreground"
              >
                {s.name}
              </a>{" "}
              — {s.role}
            </li>
          ))}
        </ul>
      </section>

      {/* insider & treasury-share dealing log — real filed EGX disclosures */}
      <InsidersPanel />
    </div>
  );
}

function Panel({
  title,
  note,
  icon,
  children,
}: {
  title: string;
  note?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="text-base font-bold inline-flex items-center gap-2">
          {icon}
          {title}
        </h2>
        {note && <p className="text-[11px] text-muted-foreground max-w-md leading-snug">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="flex items-center gap-2 text-[11px] text-muted-foreground leading-tight">
        <span className="text-primary">{icon}</span>
        {label}
      </p>
      <p className="num text-lg font-bold mt-1.5">{value}</p>
    </div>
  );
}
