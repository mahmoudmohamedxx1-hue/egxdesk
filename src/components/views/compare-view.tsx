"use client";

/** Company comparison view (G4): up to four companies side by side — price,
 *  valuation, profitability, dividends — plus a one-year rebased performance
 *  race (base 100, same math as the technical panel's stock-vs-index chart).
 *  Selection persists in localStorage (same pattern as the screener).
 *  Data: /api/companies rows + /api/chart 1Y candles per selection. */

import { Fragment, useEffect, useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { useLiveData, isDeadFeed } from "../market/use-live-data";
import type { CompanyRow, SessionMeta } from "../market/types";
import { T, tt, dn } from "@/lib/i18n";
import { fmtNum, fmtValue, fmtPct, fmtInt, directionClass } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorCard } from "./overview-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Scale, X } from "lucide-react";
import { bootParam, patchUrlParams } from "@/lib/url-state";
import { downloadCsv, fileStamp } from "@/lib/export";
import { rowMatchesQuery } from "@/lib/ar-search";
import { ExportMenu } from "../market/export-xlsx-button";
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, Legend,
} from "recharts";

type Row = CompanyRow;

const COMPARE_KEY = "egx-compare";
const MAX = 4;
/** Curve colors by column position (app palette vars). */
const LINE_COLORS = ["var(--c1)", "var(--c3)", "var(--c4)", "var(--c5)"];

type Candle = { date: string; close: number };

export function CompareView() {
  const { lang, navigate, toast } = useApp();
  const { data, error, refresh, staleMs } = useLiveData<{ session: SessionMeta; total: number; rows: Row[] }>("/api/companies");
  const [selected, setSelected] = useState<string[]>([]);
  const [q, setQ] = useState("");

  // restore last comparison (G6-style persistence)
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COMPARE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          // SSR-safe localStorage restore — this is the one honest use of a
          // mount effect; the rule's suggested alternatives break hydration.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setSelected(arr.filter((x): x is string => typeof x === "string").slice(0, MAX));
        }
      }
    } catch {}
    // 21-c — a shared link's ?tickers=COMI,HDBK wins over the saved selection
    const t = bootParam("tickers");
    if (t) {
      const arr = t.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean).slice(0, MAX);
      if (arr.length) setSelected(arr);
    }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(COMPARE_KEY, JSON.stringify(selected));
    } catch {}
    // keep the URL current so the header Share copies the exact comparison
    patchUrlParams({ tickers: selected.length ? selected.join(",") : null });
  }, [restored, selected]);

  const suggestions = useMemo(() => {
    if (!data || q.trim().length < 1) return [];
    // T39 — the shared tolerant matcher: Arabic brand aliases (كومي → COMI)
    // and normalized letter variants now work here exactly like header search
    return data.rows
      .filter((r) => !selected.includes(r.ticker))
      .filter((r) => rowMatchesQuery(r, q))
      .slice(0, 7);
  }, [data, q, selected]);

  const rowsByTicker = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of data?.rows ?? []) m.set(r.ticker, r);
    return m;
  }, [data]);

  const selectedRows = useMemo(
    () => selected.map((t) => rowsByTicker.get(t)).filter((r): r is Row => !!r),
    [selected, rowsByTicker]
  );

  const add = (ticker: string) => {
    if (selected.length >= MAX) {
      toast(tt(T.compareMax, lang));
      return;
    }
    if (!selected.includes(ticker)) setSelected((s) => [...s, ticker]);
    setQ("");
  };

  const remove = (ticker: string) => setSelected((s) => s.filter((x) => x !== ticker));

  // performance race: rebase each series to 100 on its first session
  const race = useCompareRace(selected);

  // T41 — a total quote outage must say so; a brief hiccup keeps fresh data.
  // AFTER every hook (useCompareRace included) so the Rules of Hooks hold.
  if (isDeadFeed({ error, data, staleMs })) return <ErrorCard lang={lang} onRetry={refresh} />;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Scale className="h-5 w-5 text-primary" />
          {tt(T.compareTitle, lang)}
        </h1>
        {data && (
          <p className="num text-xs text-muted-foreground">
            {selected.length}/{MAX} · {data.session.lastSession} · {tt(T.delayed, lang)}
          </p>
        )}
      </div>
      <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">{tt(T.compareNote, lang)}</p>

      {/* picker */}
      <div className="rounded-lg border bg-card p-2.5 flex items-center gap-1.5 flex-wrap">
        <div className="relative flex-1 min-w-[12rem] max-w-xs">
          <Input
            dir="ltr"
            value={q}
            onChange={(e) => setQ(e.target.value.toUpperCase())}
            placeholder={tt(T.compareAddPlaceholder, lang)}
            aria-label={tt(T.compareAddPlaceholder, lang)}
            className="h-8 text-xs num"
          />
          {suggestions.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full rounded-md border bg-card shadow-md overflow-hidden" role="listbox">
              {suggestions.map((r) => (
                <li key={r.ticker}>
                  <button
                    className="w-full text-start px-2 py-1.5 text-[11px] hover:bg-accent/50 flex items-baseline justify-between gap-2"
                    onClick={() => add(r.ticker)}
                  >
                    <span className="num font-bold">{r.ticker}</span>
                    <span className="text-muted-foreground truncate">{dn(r, lang)}</span>
                    <span className="num text-muted-foreground shrink-0">{fmtNum(r.close)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {selected.map((t, i) => {
          const r = rowsByTicker.get(t);
          return (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full border ps-2.5 pe-1 py-1 text-[11px] bg-secondary/40"
              style={{ borderColor: `color-mix(in srgb, ${LINE_COLORS[i]} 45%, transparent)` }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: LINE_COLORS[i] }} aria-hidden />
              <button className="num font-bold hover:text-primary" onClick={() => navigate("company", { ticker: t, panel: "overview" })}>
                {t}
              </button>
              <span className="text-muted-foreground hidden sm:inline max-w-[10rem] truncate">{r ? dn(r, lang) : ""}</span>
              <button
                onClick={() => remove(t)}
                aria-label={tt(T.compareRemove, lang)}
                title={tt(T.compareRemove, lang)}
                className="text-muted-foreground hover:text-down p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        {/* T38 — hint only while EXACTLY one is picked; with zero picked the
            big empty-state card below is the single message (it used to
            render twice) */}
        {selected.length === 1 && (
          <span className="text-[11px] text-muted-foreground">{tt(T.compareNeedTwo, lang)}</span>
        )}
      </div>

      {selectedRows.length >= 2 ? (
        <>
          {/* performance race */}
          {race && (
            <section aria-label="performance race" className="rounded-lg border bg-card p-4">
              <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
                <h2 className="text-sm font-bold">{tt(T.comparePerfTitle, lang)}</h2>
                <span className="num text-[11px] text-muted-foreground">
                  {race.from} → {race.to}
                </span>
              </div>
              <div className="h-64" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={race.rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--border)" }}
                      minTickGap={48}
                      tickFormatter={(d: string) => d.slice(2)}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      width={44}
                      domain={["auto", "auto"]}
                      tickFormatter={(v: number) => fmtNum(v, 0)}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--popover-foreground)",
                      }}
                      labelStyle={{ color: "var(--muted-foreground)" }}
                      formatter={(value: number, key: string) => [fmtNum(value, 1), key]}
                    />
                    <Legend
                      formatter={(key: string) => (
                        <span style={{ color: "var(--muted-foreground)", fontSize: 11 }}>{key}</span>
                      )}
                    />
                    <ReferenceLine y={100} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                    {selected.map((t, i) => (
                      <Line key={t} type="monotone" dataKey={t} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={i === 0 ? 2.2 : 1.8} dot={false} />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {selected.map((t, i) => {
                  const perf = race.perf[t];
                  return (
                    <div key={t} className="rounded-md bg-secondary/50 px-2.5 py-1.5 min-w-[7rem]">
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full" style={{ background: LINE_COLORS[i % LINE_COLORS.length] }} aria-hidden />
                        <span className="num font-bold">{t}</span>
                      </p>
                      <p className={`num text-base font-bold ${directionClass(perf)}`}>{fmtPct(perf)}</p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* metrics table */}
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b bg-card/50 gap-2 flex-wrap">
              <p className="text-xs text-muted-foreground">{tt(T.compareNote, lang)}</p>
              <ExportMenu
                report="compare"
                payload={{ tickers: selected }}
                onCsv={() => {
                  const headers = ["metric", ...selectedRows.map((r) => r.ticker)];
                  const metrics = metricDefs(lang).flatMap((g) => g.rows);
                  const body = metrics.map((m) => [m.label, ...selectedRows.map((r) => {
                    const v = m.val(r);
                    return typeof v === "number" ? v : v;
                  })]);
                  downloadCsv(`egx-compare-${fileStamp()}`, headers, body);
                }}
                title={tt(T.csvExportHint, lang)}
              />
            </div>
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="border-b bg-card sticky top-0">
                  <tr className="text-[11px] text-muted-foreground">
                    <th className="text-start font-medium px-3 py-2.5 w-40">{tt(T.colName, lang)}</th>
                    {selectedRows.map((r, i) => (
                      <th key={r.ticker} className="text-end font-medium px-3 py-2.5">
                        <button
                          className="inline-flex items-center gap-1.5 hover:text-primary"
                          onClick={() => navigate("company", { ticker: r.ticker, panel: "overview" })}
                        >
                          <span className="h-2 w-2 rounded-full" style={{ background: LINE_COLORS[i % LINE_COLORS.length] }} aria-hidden />
                          <span className="num font-bold">{r.ticker}</span>
                          <span className="hidden md:inline font-normal max-w-[8rem] truncate">{dn(r, lang)}</span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {metricDefs(lang).map((group) => (
                    <Fragment key={group.label}>
                      <tr className="bg-secondary/40">
                        <td colSpan={selectedRows.length + 1} className="px-3 py-1.5 text-[11px] font-semibold text-foreground/70">
                          {group.label}
                        </td>
                      </tr>
                      {group.rows.map((m) => (
                        <tr key={m.key} className="hover:bg-accent/20">
                          <td className="px-3 py-2 text-xs text-muted-foreground">{m.label}</td>
                          {selectedRows.map((r) => {
                            const v = m.val(r);
                            const cell =
                              typeof v === "number" ? (
                                <span className={`num ${m.signed ? directionClass(v) : ""} ${m.bold ? "font-semibold" : ""}`}>
                                  {m.fmt ? m.fmt(v) : fmtNum(v, 2)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              );
                            return <td key={r.ticker} className="px-3 py-2 text-end">{cell}</td>;
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-lg border bg-card p-10 text-center">
          <Scale className="h-8 w-8 mx-auto text-muted-foreground" aria-hidden />
          <p className="mt-2 text-sm text-muted-foreground">{tt(T.compareNeedTwo, lang)}</p>
        </div>
      )}
    </div>
  );
}

// ── metrics registry ──

type MetricDef = {
  key: string;
  label: string;
  val: (r: Row) => number | null;
  fmt?: (v: number) => string;
  signed?: boolean;
  bold?: boolean;
};

function metricDefs(lang: "ar" | "en"): { label: string; rows: MetricDef[] }[] {
  return [
    {
      label: tt(T.compareGroupPrice, lang),
      rows: [
        { key: "close", label: tt(T.colClose, lang), val: (r) => r.close, fmt: (v) => fmtNum(v), bold: true },
        { key: "chg", label: tt(T.colChange, lang), val: (r) => r.changePct, fmt: (v) => fmtPct(v), signed: true },
        { key: "cap", label: tt(T.marketCap, lang), val: (r) => r.marketCap, fmt: (v) => `EGP ${fmtValue(v)}` },
        { key: "ytd", label: tt(T.ytd, lang), val: (r) => r.perfYTD, fmt: (v) => fmtPct(v), signed: true },
        { key: "y1", label: tt(T.period1Y, lang) ?? "1Y", val: (r) => r.perfY, fmt: (v) => fmtPct(v), signed: true },
        {
          key: "range52",
          label: tt(T.filter52, lang),
          val: (r) => (r.high52 != null && r.low52 != null && r.close != null && r.high52 > r.low52 ? ((r.close - r.low52) / (r.high52 - r.low52)) * 100 : null),
          fmt: (v) => `${v.toFixed(0)}%`,
        },
      ],
    },
    {
      label: tt(T.compareGroupValuation, lang),
      rows: [
        { key: "pe", label: "P/E", val: (r) => r.pe, fmt: (v) => fmtNum(v, 1) },
        { key: "pb", label: "P/B", val: (r) => r.pb ?? null, fmt: (v) => fmtNum(v, 2) },
        { key: "eps", label: "EPS", val: (r) => r.eps, fmt: (v) => fmtNum(v, 2) },
      ],
    },
    {
      label: tt(T.compareGroupProfit, lang),
      rows: [
        { key: "roe", label: "ROE", val: (r) => r.roe ?? null, fmt: (v) => `${fmtNum(v, 1)}%`, signed: true },
        { key: "gm", label: lang === "ar" ? "هامش إجمالي" : "Gross margin", val: (r) => r.grossMarginTTM ?? null, fmt: (v) => `${fmtNum(v, 1)}%`, signed: true },
        { key: "rg", label: lang === "ar" ? "نمو الإيرادات (ربع)" : "Revenue growth (Q)", val: (r) => r.revenueGrowthQ ?? null, fmt: (v) => `${fmtNum(v, 1)}%`, signed: true },
        { key: "de", label: lang === "ar" ? "دين ÷ حقوق" : "Debt/Equity", val: (r) => r.debtToEquity ?? null, fmt: (v) => fmtNum(v, 2) },
        { key: "ni", label: lang === "ar" ? "صافي الربح (TTM)" : "Net income (TTM)", val: (r) => r.netIncomeTTM ?? null, fmt: (v) => `EGP ${fmtValue(v)}` },
        { key: "emp", label: lang === "ar" ? "الموظفون" : "Employees", val: (r) => r.employees ?? null, fmt: (v) => fmtInt(v) },
      ],
    },
    {
      label: tt(T.compareGroupDiv, lang),
      rows: [
        { key: "yield", label: tt(T.filterYield, lang), val: (r) => r.divYield, fmt: (v) => `${fmtNum(v, 1)}%` },
        { key: "payout", label: lang === "ar" ? "نسبة التوزيع" : "Payout ratio", val: (r) => (r.payoutRatio != null ? r.payoutRatio * 100 : null), fmt: (v) => `${fmtNum(v, 0)}%` },
      ],
    },
  ];
}

// ── performance race hook ──

type Race = {
  rows: Record<string, string | number>[];
  perf: Record<string, number>;
  from: string;
  to: string;
};

/** Fetch 1Y candles for every selected ticker, rebase each to 100 on the
 *  first common session and merge onto one date axis (union of dates; each
 *  series carries its last value forward across gaps). */
function useCompareRace(selected: string[]): Race | null {
  const [race, setRace] = useState<Race | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (selected.length < 2) {
        setRace(null);
        return;
      }
      try {
        const series = await Promise.all(
          selected.map(async (t) => {
            const res = await fetch(`/api/chart?symbol=${encodeURIComponent(t)}&range=1Y`, { cache: "no-store" });
            if (!res.ok) return null;
            const json = (await res.json()) as { points?: Candle[] };
            return { t, points: (json.points ?? []).filter((p) => Number.isFinite(p.close)) };
          })
        );
        if (!alive) return;
        const valid = series.filter((s): s is { t: string; points: Candle[] } => !!s && s.points.length >= 30);
        if (valid.length < 2) {
          setRace(null);
          return;
        }
        // union of dates, sorted
        const dates = Array.from(new Set(valid.flatMap((s) => s.points.map((p) => p.date)))).sort();
        // per-series: value map + forward fill from 100-base
        const maps = valid.map((s) => {
          const m = new Map(s.points.map((p) => [p.date, p.close]));
          return { t: s.t, m };
        });
        const rows: Record<string, string | number>[] = [];
        const lastVal: Record<string, number> = {};
        for (const t of valid.map((s) => s.t)) lastVal[t] = 0;
        const base: Record<string, number> = {};
        for (const d of dates) {
          const row: Record<string, string | number> = { date: d };
          for (const { t, m } of maps) {
            const v = m.get(d);
            if (v != null) {
              if (base[t] === undefined) base[t] = v;
              lastVal[t] = (v / base[t]) * 100;
            }
            row[t] = lastVal[t]; // forward-filled; 0 until series starts
          }
          rows.push(row);
        }
        // trim leading rows where any series is still 0 (not started)
        const firstFull = rows.findIndex((r) => selected.every((t) => typeof r[t] === "number" && (r[t] as number) > 0));
        const trimmed = firstFull > 0 ? rows.slice(firstFull) : rows;
        const perf: Record<string, number> = {};
        const last = trimmed[trimmed.length - 1];
        for (const { t } of maps) perf[t] = (last[t] as number) - 100;
        setRace({
          rows: trimmed,
          perf,
          from: String(trimmed[0]?.date ?? ""),
          to: String(trimmed[trimmed.length - 1]?.date ?? ""),
        });
      } catch {
        if (alive) setRace(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selected]);
  return race;
}
