"use client";

import { useApp } from "../market/app-context";
import { useLiveData } from "../market/use-live-data";
import type { CompanyRow, SessionMeta } from "../market/types";
import { T, tt } from "@/lib/i18n";
import { fmtValue, fmtInt, fmtNum } from "@/lib/format";
import { WatchStar } from "../market/watch-star";
import { ChangeCell } from "../market/change-cell";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";

type ActivityData = {
  session: SessionMeta;
  totals: {
    valueTraded: number;
    volume: number;
    breadth: { total: number; up: number; down: number; flat: number };
  };
  turnoverLeaders: CompanyRow[];
  unusual: CompanyRow[];
};

export function ActivityView() {
  const { lang, navigate } = useApp();
  const { data } = useLiveData<ActivityData>("/api/activity");

  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const b = data.totals.breadth;
  const upPct = b.total ? (b.up / b.total) * 100 : 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{tt(T.activityTitle, lang)}</h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-2xl leading-relaxed">
          {tt(T.activityNote, lang)}
        </p>
      </div>

      <p className="text-xs text-muted-foreground num">
        {data.session.lastSession} · {tt(T.delayed, lang)} · {tt(T.updated, lang)} {data.session.cairoTime} {tt(T.cairoTime, lang)}
      </p>

      {/* totals + breadth */}
      <section className="rounded-lg border bg-card p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <BigStat label={tt(T.valueTradedTotal, lang)} value={`EGP ${fmtValue(data.totals.valueTraded)}`} />
          <BigStat label={tt(T.volumeTotal, lang)} value={fmtInt(data.totals.volume)} />
          <BigStat label={tt(T.stock, lang)} value={fmtInt(b.total)} sub={`${b.up} ${tt(T.rose, lang)} · ${b.down} ${tt(T.fell, lang)}`} />
        </div>
        {/* breadth bar */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="inline-flex items-center gap-1 text-up">
              <TrendingUp className="h-3 w-3" aria-hidden />
              <span className="num font-semibold">{b.up}</span> {tt(T.rose, lang)}
            </span>
            <span className="num text-muted-foreground">{tt(T.breadth, lang)}</span>
            <span className="inline-flex items-center gap-1 text-down">
              <TrendingDown className="h-3 w-3" aria-hidden />
              <span className="num font-semibold">{b.down}</span> {tt(T.fell, lang)}
            </span>
          </div>
          <div className="flex h-3 rounded-full overflow-hidden bg-secondary" dir="ltr" role="img" aria-label={tt(T.breadth, lang)}>
            <div className="h-full bg-up" style={{ width: `${(b.up / b.total) * 100}%` }} />
            <div className="h-full bg-muted-foreground/30" style={{ width: `${(b.flat / b.total) * 100}%` }} />
            <div className="h-full bg-down" style={{ width: `${(b.down / b.total) * 100}%` }} />
          </div>
          <p className="num mt-1 text-[10px] text-muted-foreground">{fmtNum(upPct, 1)}% {lang === "ar" ? "من السوق صاعد" : "of the market is up"}</p>
        </div>
      </section>

      {/* turnover leaders */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-bold">{tt(T.turnoverLeaders, lang)}</h2>
          <button onClick={() => navigate("market")} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
            {tt(T.viewAll, lang)}
          </button>
        </div>
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-sm">
              <thead className="border-b bg-card">
                <tr className="text-[11px] text-muted-foreground">
                  <th className="w-10" aria-label="watch" />
                  <th className="text-start font-medium px-3 py-2.5">{tt(T.colTicker, lang)}</th>
                  <th className="text-start font-medium px-3 py-2.5 hidden md:table-cell">{tt(T.colName, lang)}</th>
                  <th className="text-end font-medium px-3 py-2.5">{tt(T.colClose, lang)}</th>
                  <th className="text-end font-medium px-3 py-2.5">{tt(T.colChange, lang)}</th>
                  <th className="text-end font-medium px-3 py-2.5">{tt(T.colValue, lang)}</th>
                  <th className="text-end font-medium px-3 py-2.5 hidden sm:table-cell">{tt(T.volume, lang)}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.turnoverLeaders.map((r) => (
                  <tr key={r.ticker} className="hover:bg-accent/30 cursor-pointer transition-colors"
                    onClick={() => navigate("company", { ticker: r.ticker, panel: "activity" })}>
                    <td className="ps-1"><WatchStar ticker={r.ticker} /></td>
                    <td className="num px-3 py-2.5 font-bold">{r.ticker}</td>
                    <td className="px-3 py-2.5 hidden md:table-cell max-w-[260px] truncate text-muted-foreground">{r.name}</td>
                    <td className="num px-3 py-2.5 text-end font-medium">{fmtNum(r.close)}</td>
                    <td className="px-3 py-2.5 text-end"><ChangeCell pct={r.changePct} /></td>
                    <td className="num px-3 py-2.5 text-end font-semibold text-primary">EGP {fmtValue(r.valueTraded)}</td>
                    <td className="num px-3 py-2.5 text-end hidden sm:table-cell text-muted-foreground">{fmtInt(r.volume)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {lang === "ar" ? "القيمة ≈ حجم الجلسة × آخر سعر." : "Value ≈ session volume × last price."}
        </p>
      </section>

      {/* unusual volume */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-bold inline-flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" aria-hidden />
            {tt(T.unusualActivity, lang)}
          </h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {data.unusual.map((r) => (
            <div key={r.ticker} role="button" tabIndex={0} onClick={() => navigate("company", { ticker: r.ticker, panel: "activity" })}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") navigate("company", { ticker: r.ticker, panel: "activity" }); }}
              className="flex items-center gap-3 rounded-lg border bg-card p-3 text-start hover:border-ring focus-visible:ring-2 focus-visible:ring-ring outline-none cursor-pointer transition-colors">
              <WatchStar ticker={r.ticker} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="num text-sm font-bold">{r.ticker}</span>
                  <ChangeCell pct={r.changePct} />
                </div>
                <p className="truncate text-xs text-muted-foreground">{r.name}</p>
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
    </div>
  );
}

function BigStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md bg-secondary/50 px-3 py-2.5">
      <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
      <p className="num text-lg font-bold">{value}</p>
      {sub && <p className="num text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
