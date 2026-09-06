"use client";

import { useEffect, useState } from "react";
import { useApp } from "../market/app-context";
import { T, tt } from "@/lib/i18n";
import { fmtNum, fmtPct, fmtValue, fmtInt, directionClass } from "@/lib/format";
import { WatchStar } from "../market/watch-star";
import { ChangeCell } from "../market/change-cell";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUpRight, ArrowDownRight, MoveRight } from "lucide-react";
import { fmtDateAr, fmtTimeAr } from "@/lib/format";

type Row = {
  ticker: string; nameAr: string; nameEn: string; sectorAr: string; sectorEn: string;
  close: number; changePct: number; marketCap: number; valueTraded: number;
  pe: number | null; volumeRatio: number | null; volume: number; avgVolume30d: number;
};

type Overview = {
  authed: boolean;
  session: { date: string; updated: string; kind: string };
  indices: { code: string; nameAr: string; nameEn: string; value: number; change: number; changePct: number }[];
  flows: { categoryAr: string; categoryEn: string; sharePct: number; buyValue: number; sellValue: number; netFlow: number }[];
  breadth: { total: number; up: number; down: number; flat: number };
  actives: Row[];
  movers: Row[];
  colors: Row[];
  news: { id: string; title: string; impact: string; publisher: string; category: string; publishedAt: string }[];
};

export function OverviewView() {
  const { lang, navigate, auth } = useApp();
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    fetch("/api/overview")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [auth.email]);

  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* session line */}
      <p className="text-xs text-muted-foreground num">
        {fmtDateAr(data.session.date)} · {data.session.kind}
      </p>
      <h1 className="text-2xl font-bold tracking-tight">{tt(T.marketGlance, lang)}</h1>

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

      {/* indices */}
      <section aria-label="indices" className="grid gap-3 sm:grid-cols-3">
        {data.indices.map((ix) => (
          <button key={ix.code} onClick={() => navigate("heat")} className="rounded-lg border bg-card p-4 text-start hover:border-ring transition-colors">
            <p className="text-sm text-muted-foreground">{lang === "ar" ? ix.nameAr : ix.nameEn}</p>
            <p className="num text-2xl font-bold tracking-tight">{fmtNum(ix.value)}</p>
            <p className={`num text-sm font-medium ${directionClass(ix.changePct)} flex items-center gap-1`}>
              {ix.changePct >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              {ix.change > 0 ? "+" : ""}{fmtNum(ix.change)} ({fmtPct(ix.changePct)})
            </p>
          </button>
        ))}
      </section>

      {/* investor flows */}
      <section aria-label="investor categories">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-bold">{tt(T.behindMoves, lang)}</h2>
          <button onClick={() => navigate("investors")} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
            {tt(T.catsDetail, lang)}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {data.flows.map((f) => (
            <div key={f.categoryAr} className="rounded-lg border bg-card p-4">
              <p className="font-semibold">{lang === "ar" ? f.categoryAr : f.categoryEn}</p>
              <p className="num text-xl font-bold">{f.sharePct.toFixed(2)}%</p>
              <p className="text-xs text-muted-foreground">{lang === "ar" ? "صافي التعاملات (شراء/بيع)" : "Net trading (buy/sell)"}</p>
              <p className={`num text-sm font-semibold ${directionClass(f.netFlow)}`}>
                {f.netFlow > 0 ? "+" : ""}{f.netFlow.toFixed(1)}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  {lang === "ar" ? "مليون ج.م" : "EGP mn"}
                </span>
              </p>
              {/* share bar */}
              <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${f.sharePct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* unusual volume actives */}
      <section aria-label="most active">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-bold">{tt(T.activeStocks, lang)}</h2>
        </div>
        <div className="rounded-lg border bg-card divide-y">
          {data.actives.map((r) => (
            <button key={r.ticker} onClick={() => navigate("company", { ticker: r.ticker, panel: "overview" })}
              className="flex w-full items-center gap-3 p-3 text-start hover:bg-accent/40 transition-colors">
              <WatchStar ticker={r.ticker} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="num text-sm font-bold">{r.ticker}</span>
                  <ChangeCell pct={r.changePct} />
                </div>
                <p className="truncate text-xs text-muted-foreground">{lang === "ar" ? r.nameAr : r.nameEn}</p>
              </div>
              <div className="text-end shrink-0">
                <p className="num text-sm font-semibold text-primary">{fmtNum(r.volumeRatio, 1)}×</p>
                <p className="text-[10px] text-muted-foreground">{lang === "ar" ? "حجم ÷ المعتاد" : "vol ÷ usual"}</p>
              </div>
            </button>
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

      {/* breadth */}
      <section aria-label="breadth" className="rounded-lg border bg-card p-4">
        <h2 className="text-lg font-bold mb-3">{tt(T.breadth, lang)}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="num text-2xl font-bold">{data.breadth.total}</span>
          <span className="text-sm text-muted-foreground">{tt(T.stock, lang)}</span>
          <span className="flex-1" />
          <Badge label={tt(T.rose, lang)} value={data.breadth.up} cls="text-up bg-up-soft" />
          <Badge label={tt(T.fell, lang)} value={data.breadth.down} cls="text-down bg-down-soft" />
          <Badge label={tt(T.steady, lang)} value={data.breadth.flat} cls="text-muted-foreground bg-secondary" />
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
            <button key={r.ticker} onClick={() => navigate("company", { ticker: r.ticker, panel: "overview" })}
              className="flex w-full items-center gap-3 p-3 text-start hover:bg-accent/40 transition-colors">
              <WatchStar ticker={r.ticker} />
              <div className="min-w-0 flex-1">
                <span className="num text-sm font-bold">{r.ticker}</span>
                <p className="truncate text-xs text-muted-foreground">{lang === "ar" ? r.nameAr : r.nameEn}</p>
              </div>
              <div className="num text-sm font-semibold">{fmtNum(r.close)}</div>
              <ChangeCell pct={r.changePct} />
            </button>
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
            <button key={n.id} onClick={() => navigate("today")} className="rounded-lg border bg-card p-3.5 text-start hover:border-ring transition-colors">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] font-medium">{n.category}</span>
                <span className="num text-[10px] text-muted-foreground">{fmtDateAr(n.publishedAt)} · {fmtTimeAr(n.publishedAt)}</span>
              </div>
              <p className="text-sm font-medium leading-snug line-clamp-2">{n.title}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{n.publisher}</p>
            </button>
          ))}
        </div>
      </section>
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
