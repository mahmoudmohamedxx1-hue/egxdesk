"use client";

/** Dividend history panel (G3) — per-company cash dividend record with dates,
 *  per-year bars, and income-investor stats. Data from /api/dividends/[ticker]
 *  (stockanalysis.com public dividend tables). Amounts are per share in EGP. */

import { useMemo } from "react";
import { useApp } from "./app-context";
import { useLiveData } from "./use-live-data";
import { T, tt } from "@/lib/i18n";
import { fmtNum, fmtPct, directionClass } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Coins, Download, ExternalLink, RefreshCw } from "lucide-react";
import { downloadCsv, fileStamp } from "@/lib/export";

type DivRow = {
  exDate: string;
  recordDate: string | null;
  payDate: string | null;
  amount: number;
};

type DividendsData = {
  ticker: string;
  currency: string;
  perShare: boolean;
  rows: DivRow[];
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  note?: { ar: string; en: string };
};

export function DividendsPanel({ ticker, close }: { ticker: string; close: number | null }) {
  const { lang } = useApp();
  const { data, error, refresh } = useLiveData<DividendsData>(
    `/api/dividends/${encodeURIComponent(ticker)}`,
    10 * 60_000
  );

  // stats + per-year aggregates (newest-first rows -> oldest last)
  const stats = useMemo(() => {
    if (!data || data.rows.length === 0) return null;
    const rows = data.rows;
    const thisYear = new Date().getFullYear();
    const years = new Map<number, number>(); // year -> total EGP
    for (const r of rows) {
      const y = Number(r.exDate.slice(0, 4));
      if (!Number.isFinite(y)) continue;
      years.set(y, (years.get(y) ?? 0) + r.amount);
    }
    // last 5 full years + current partial year
    const yearList = [...years.keys()].sort((a, b) => b - a);
    const last5 = yearList.filter((y) => y < thisYear).slice(0, 5);
    const total5 = last5.reduce((s, y) => s + (years.get(y) ?? 0), 0);
    const avgAnnual = last5.length ? total5 / last5.length : (years.get(thisYear) ?? 0);
    // growth: current full year total vs previous full year total
    const latestFull = yearList[0] >= thisYear ? yearList[0] : yearList[0];
    const prevFull = yearList.find((y) => y < latestFull);
    const growth =
      prevFull != null && (years.get(prevFull) ?? 0) > 0
        ? ((years.get(latestFull) ?? 0) / (years.get(prevFull) ?? 1) - 1) * 100
        : null;
    // next upcoming payment (ex or pay date in the future)
    const today = new Date().toISOString().slice(0, 10);
    const next = rows.find((r) => (r.payDate ?? r.exDate) >= today) ?? null;
    return {
      count: rows.length,
      total5: last5.length ? total5 : null,
      avgAnnual,
      avgYield: close && close > 0 && avgAnnual > 0 ? (avgAnnual / close) * 100 : null,
      growth,
      next,
      yearBars: yearList.slice(0, 6).reverse().map((y) => ({ year: y, total: years.get(y) ?? 0 })),
    };
  }, [data, close]);

  if (error && !data) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center space-y-3">
        <p className="text-sm text-muted-foreground">{tt(T.errorLoad, lang)}</p>
        <Button size="sm" variant="outline" onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5 me-1.5" />
          {tt(T.retry, lang)}
        </Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}
      </div>
    );
  }

  const hasRows = data.rows.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5">
        <Coins className="h-4 w-4 text-primary mt-1 shrink-0" aria-hidden />
        <div>
          <h3 className="font-semibold">{tt(T.divHistoryTitle, lang)}</h3>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
            {tt(T.divHistoryNote, lang)}
          </p>
        </div>
      </div>

      {!hasRows ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">{tt(T.divNoHistory, lang)}</p>
        </div>
      ) : (
        <>
          {/* stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label={tt(T.divStatCount, lang)}
              value={String(stats?.count ?? data.rows.length)}
            />
            <StatCard
              label={tt(T.divStatTotal, lang)}
              value={stats?.total5 != null ? `${fmtNum(stats.total5, 2)} EGP` : "—"}
              sub={lang === "ar" ? "لكل سهم" : "per share"}
            />
            <StatCard
              label={tt(T.divStatAvgYield, lang)}
              value={stats?.avgYield != null ? fmtPct(stats.avgYield, false) : "—"}
              sub={close != null ? `${tt(T.alertCurrentPrice, lang)} ${fmtNum(close)}` : undefined}
              cls={directionClass(stats?.avgYield)}
            />
            <StatCard
              label={tt(T.divNextExpected, lang)}
              value={stats?.next ? (stats.next.payDate ?? stats.next.exDate) : "—"}
              sub={stats?.next ? `${fmtNum(stats.next.amount, 2)} EGP` : undefined}
            />
          </div>

          {/* per-year bars */}
          {stats && stats.yearBars.length > 1 && (
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs font-medium text-foreground/80 mb-3">{tt(T.divAnnualBars, lang)}</p>
              <div className="flex items-end gap-3 h-28" dir="ltr">
                {stats.yearBars.map((b) => {
                  const max = Math.max(...stats.yearBars.map((x) => x.total), 0.0001);
                  const h = Math.max((b.total / max) * 100, 2);
                  return (
                    <div key={b.year} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                      <span className="num text-[10px] text-muted-foreground">{fmtNum(b.total, 2)}</span>
                      <div
                        className="w-full rounded-t-sm bg-primary/80"
                        style={{ height: `${h}%` }}
                        title={`${b.year}: ${fmtNum(b.total, 3)} EGP`}
                      />
                      <span className="num text-[10px] text-muted-foreground">{b.year}</span>
                    </div>
                  );
                })}
              </div>
              {stats.growth != null && (
                <p className="num text-[11px] text-muted-foreground mt-2">
                  {tt(T.divGrowth, lang)}: <span className={directionClass(stats.growth)}>{fmtPct(stats.growth)}</span>
                </p>
              )}
              <p className="text-[10px] text-muted-foreground mt-1">{tt(T.divPerYearNote, lang)}</p>
            </div>
          )}

          {/* history table + CSV export (G7) */}
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b bg-card/50">
              <p className="text-xs text-muted-foreground num">
                {data.rows.length} {lang === "ar" ? "توزيعة" : "payments"}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-[11px] text-muted-foreground"
                title={tt(T.csvExportHint, lang)}
                onClick={() => {
                  const headers = ["ticker", "ex_date", "record_date", "pay_date", "amount_egp_per_share"];
                  const body = data.rows.map((r) => [
                    data.ticker, r.exDate, r.recordDate ?? "", r.payDate ?? "", r.amount,
                  ]);
                  downloadCsv(`egx-dividends-${data.ticker}-${fileStamp()}`, headers, body);
                }}
              >
                <Download className="h-3 w-3" />
                CSV
              </Button>
            </div>
            <div className="max-h-[50vh] overflow-auto thin-scroll">
              <table className="w-full text-sm min-w-[520px]">
                <thead className="sticky top-0 bg-card z-10 border-b">
                  <tr className="text-[11px] text-muted-foreground">
                    <th className="text-start font-medium px-3 py-2.5">{tt(T.divColExDate, lang)}</th>
                    <th className="text-start font-medium px-3 py-2.5 hidden sm:table-cell">{tt(T.divColRecord, lang)}</th>
                    <th className="text-start font-medium px-3 py-2.5">{tt(T.divColPay, lang)}</th>
                    <th className="text-end font-medium px-3 py-2.5">{tt(T.divColAmount, lang)}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.rows.map((r, i) => (
                    <tr key={`${r.exDate}-${i}`} className="hover:bg-accent/30">
                      <td className="num px-3 py-2.5">{r.exDate}</td>
                      <td className="num px-3 py-2.5 hidden sm:table-cell text-muted-foreground">{r.recordDate ?? "—"}</td>
                      <td className="num px-3 py-2.5 text-muted-foreground">{r.payDate ?? "—"}</td>
                      <td className="num px-3 py-2.5 text-end font-medium">{fmtNum(r.amount, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* source */}
          <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {data.source}
            </a>
          </p>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  cls,
}: {
  label: string;
  value: string;
  sub?: string;
  cls?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-[11px] text-muted-foreground leading-tight">{label}</p>
      <p className={`num text-lg font-bold mt-1 ${cls ?? ""}`}>{value}</p>
      {sub && <p className="num text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
