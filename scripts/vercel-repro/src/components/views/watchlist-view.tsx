"use client";

import { useEffect, useState } from "react";
import { useApp } from "../market/app-context";
import { bootParam, patchUrlParams } from "@/lib/url-state";
import { useLiveData, isDeadFeed } from "../market/use-live-data";
import type { CompanyRow, SessionMeta } from "../market/types";
import { T, tt, dn } from "@/lib/i18n";
import { fmtNum, fmtValue } from "@/lib/format";
import { WatchStar } from "../market/watch-star";
import { ChangeCell } from "../market/change-cell";
import { ExportXlsxButton } from "../market/export-xlsx-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Star } from "lucide-react";
import { PortfolioView } from "./portfolio-view";
import { ErrorCard } from "./overview-view";

type Row = CompanyRow;

/** "My stuff" hub: watchlist (what I watch) + portfolio (what I own, G2). */
export function WatchlistView() {
  const { lang } = useApp();
  const [tab, setTab] = useState<"watch" | "portfolio">("watch");

  // 21-c — shareable state: ?view=watchlist&tab=portfolio
  useEffect(() => {
    if (bootParam("tab") === "portfolio") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab("portfolio");
    }
  }, []);
  useEffect(() => {
    patchUrlParams({ tab: tab === "watch" ? null : tab });
  }, [tab]);

  return (
    <div className="space-y-4">
      {/* tabs */}
      <div className="flex items-center gap-1 border-b" role="tablist">
        {(
          [
            ["watch", T.watchlist],
            ["portfolio", T.portfolioTitle],
          ] as const
        ).map(([key, t]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`whitespace-nowrap px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${
              tab === key ? "border-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tt(t, lang)}
          </button>
        ))}
      </div>
      {tab === "portfolio" ? <PortfolioView /> : <WatchlistTable lang={lang} />}
    </div>
  );
}

function WatchlistTable({ lang }: { lang: "ar" | "en" }) {
  const { watch, navigate } = useApp();
  const { data, error, refresh, staleMs } = useLiveData<{ session: SessionMeta; total: number; rows: Row[] }>("/api/companies");

  const watchRows = data
    ? watch.tickers.map((t) => data.rows.find((r) => r.ticker === t)).filter((r): r is Row => !!r)
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{tt(T.watchTitle, lang)}</h1>
        <div className="flex items-center gap-2">
          {watchRows && watchRows.length > 0 && (
            <ExportXlsxButton
              report="watchlist"
              payload={() => ({
                columns: [
                  lang === "ar" ? "الرمز" : "ticker",
                  lang === "ar" ? "الاسم" : "name",
                  lang === "ar" ? "القطاع" : "sector",
                  lang === "ar" ? "الإغلاق (جنيه)" : "close (EGP)",
                  lang === "ar" ? "التغير %" : "change %",
                  lang === "ar" ? "قيمة التداول (جنيه)" : "value traded (EGP)",
                  "P/E",
                ],
                rows: watchRows.map((r) => [
                  r.ticker,
                  dn(r, lang),
                  lang === "ar" ? r.sectorAr : r.sectorEn,
                  r.close,
                  r.changePct,
                  r.valueTraded,
                  r.pe,
                ]),
              })}
            />
          )}
          <p className="num text-xs text-muted-foreground">
            <span className="font-semibold">{watch.tickers.length}</span> · {data?.session.lastSession} · {tt(T.delayed, lang)}
          </p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">{tt(T.watchNote, lang)}</p>

      {/* T41 — a total outage must say so. An empty watchlist still shows
          the honest empty state below; a brief hiccup keeps fresh data. */}
      {isDeadFeed({ error, data, staleMs }) ? (
        <ErrorCard lang={lang} onRetry={refresh} />
      ) : !watch.ready || !watchRows ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : watchRows.length === 0 ? (
        <Empty title={tt(T.emptyWatch, lang)} hint={tt(T.emptyWatchHint, lang)} action />
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-sm">
              <thead className="border-b bg-card sticky top-0">
                <tr className="text-[11px] text-muted-foreground">
                  <th className="w-10" aria-label="watch" />
                  <th className="text-start font-medium px-3 py-2.5">{tt(T.colTicker, lang)}</th>
                  <th className="text-start font-medium px-3 py-2.5 hidden md:table-cell">{tt(T.colName, lang)}</th>
                  <th className="text-start font-medium px-3 py-2.5 hidden lg:table-cell">{tt(T.colSector, lang)}</th>
                  <th className="text-end font-medium px-3 py-2.5">{tt(T.colClose, lang)}</th>
                  <th className="text-end font-medium px-3 py-2.5">{tt(T.colChange, lang)}</th>
                  <th className="text-end font-medium px-3 py-2.5 hidden sm:table-cell">{tt(T.colValue, lang)}</th>
                  <th className="text-end font-medium px-3 py-2.5 hidden md:table-cell">{tt(T.colPe, lang)}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {watchRows.map((r) => (
                  <tr key={r.ticker} className="hover:bg-accent/30 cursor-pointer transition-colors"
                    onClick={() => navigate("company", { ticker: r.ticker, panel: "overview" })}>
                    <td className="ps-1"><WatchStar ticker={r.ticker} /></td>
                    <td className="num px-3 py-2.5 font-bold">{r.ticker}</td>
                    <td className="px-3 py-2.5 hidden md:table-cell max-w-[240px] truncate text-muted-foreground">
                      {dn(r, lang)}
                    </td>
                    <td className="px-3 py-2.5 hidden lg:table-cell text-xs text-muted-foreground max-w-[150px] truncate">
                      {lang === "ar" ? r.sectorAr : r.sectorEn}
                    </td>
                    <td className="num px-3 py-2.5 text-end font-medium">{fmtNum(r.close)}{r.usdQuoted ? <span className="ms-1 text-[9px] text-muted-foreground">US$</span> : null}</td>
                    <td className="px-3 py-2.5 text-end"><ChangeCell pct={r.changePct} /></td>
                    <td className="num px-3 py-2.5 text-end hidden sm:table-cell text-muted-foreground">{fmtValue(r.valueTraded)}</td>
                    <td className="num px-3 py-2.5 text-end hidden md:table-cell text-muted-foreground">
                      {r.pe ? fmtNum(r.pe, 1) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Empty({ title, hint, action }: { title: string; hint: string; action?: boolean }) {
  const { lang, navigate } = useApp();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <div className="rounded-lg border bg-card p-10 text-center space-y-3">
        <Star className="h-8 w-8 mx-auto text-muted-foreground" aria-hidden />
        <p className="font-medium">{hint}</p>
        {action && (
          <button onClick={() => navigate("market")} className="text-sm text-primary hover:underline">
            {tt(T.browseMarket, lang)}
          </button>
        )}
      </div>
    </div>
  );
}
