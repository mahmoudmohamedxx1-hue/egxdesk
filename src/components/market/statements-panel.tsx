"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { useApp } from "./app-context";
import { T, tt } from "@/lib/i18n";
import { fmtNum, fmtValue } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw, FileSpreadsheet } from "lucide-react";

type StmtLine = {
  label: string;
  labelAr: string | null;
  values: (number | null)[];
};

type StmtTable = {
  periods: string[];
  periodEndings: string[];
  lines: StmtLine[];
};

export type StatementsData = {
  ticker: string;
  currency: string;
  scale: string;
  source: string;
  sourceUrl: string;
  annual: { income: StmtTable | null; balance: StmtTable | null; cashflow: StmtTable | null };
  quarterly: { income: StmtTable | null };
  note: { ar: string; en: string };
};

/** Lazy-loaded statements tab for the company view — real per-period
 *  statements from stockanalysis.com (EGP millions, cumulative as filed). */
export function StatementsPanel({ ticker }: { ticker: string }) {
  const { lang } = useApp();
  const [data, setData] = useState<StatementsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"annual" | "quarterly">("annual");
  const [stmt, setStmt] = useState<"income" | "balance" | "cashflow">("income");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/statements/${encodeURIComponent(ticker)}`, { cache: "no-store" });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "statements unavailable");
        if (!cancelled) {
          setData(j as StatementsData);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "statements unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [ticker, reload]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center space-y-2">
        <FileSpreadsheet className="h-6 w-6 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
          {tt(T.stmtNoData, lang)}
        </p>
        <Button size="sm" variant="ghost" onClick={() => setReload((r) => r + 1)}>
          <RefreshCw className="h-3.5 w-3.5 me-1.5" />
          {tt(T.retry, lang)}
        </Button>
      </div>
    );
  }

  const table =
    mode === "quarterly"
      ? data.quarterly.income
      : stmt === "income"
        ? data.annual.income
        : stmt === "balance"
          ? data.annual.balance
          : data.annual.cashflow;

  const cmp = data.annual.income; // FY-vs-FY comparison from the income table
  const showFinCharts = mode === "annual" && stmt === "income" && !!data.annual.income;

  return (
    <div className="space-y-4">
      {/* financial charts — revenue / net income / EPS history */}
      {showFinCharts && <FinCharts table={data.annual.income as StmtTable} lang={lang} />}
      {/* mode + statement switches */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center rounded-lg border overflow-hidden text-xs" role="tablist">
          {(["annual", "quarterly"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              disabled={m === "quarterly" && !data.quarterly.income}
              className={`px-3 py-1.5 transition-colors disabled:opacity-40 ${
                mode === m ? "bg-secondary font-semibold" : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              {tt(m === "annual" ? T.stmtAnnual : T.stmtQuarterly, lang)}
            </button>
          ))}
        </div>
        {mode === "annual" && (
          <div className="flex items-center rounded-lg border overflow-hidden text-xs" role="tablist">
            {([
              ["income", T.stmtIncome],
              ["balance", T.stmtBalance],
              ["cashflow", T.stmtCashflow],
            ] as const).map(([k, t]) => (
              <button
                key={k}
                role="tab"
                aria-selected={stmt === k}
                onClick={() => setStmt(k)}
                disabled={!data.annual[k]}
                className={`px-3 py-1.5 transition-colors disabled:opacity-40 ${
                  stmt === k ? "bg-secondary font-semibold" : "text-muted-foreground hover:bg-accent/50"
                }`}
              >
                {tt(t, lang)}
              </button>
            ))}
          </div>
        )}
        <a
          href={data.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ms-auto text-[11px] text-muted-foreground hover:text-primary hover:underline"
        >
          {data.source}
        </a>
      </div>

      {/* the table */}
      {table ? (
        <section className="rounded-lg border bg-card overflow-hidden">
          <div className="border-b px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-bold">
              {tt(
                mode === "quarterly"
                  ? T.stmtQuarterly
                  : stmt === "income"
                    ? T.stmtIncome
                    : stmt === "balance"
                      ? T.stmtBalance
                      : T.stmtCashflow,
                lang
              )}{" "}
              <span className="text-xs font-normal text-muted-foreground">· {tt(T.inMnEgp, lang)}</span>
            </h2>
            <span className="num text-[11px] text-muted-foreground">
              {tt(T.stmtPeriodEnding, lang)}: {table.periodEndings.find((e) => e) ?? "—"}
            </span>
          </div>
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-sm">
              <thead className="border-b bg-card sticky top-0">
                <tr className="text-[11px] text-muted-foreground">
                  <th className="text-start font-medium px-4 py-2 min-w-[180px]">{tt(T.stmtLineItem, lang)}</th>
                  {table.periods.map((p) => (
                    <th key={p} className="text-end font-medium px-3 py-2 whitespace-nowrap num">
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {table.lines.map((l) => (
                  <tr key={l.label} className="hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-2">
                      {lang === "ar" && l.labelAr ? l.labelAr : l.label}
                      {lang === "ar" && l.labelAr && (
                        <span className="ms-2 text-[10px] text-muted-foreground num">{l.label}</span>
                      )}
                    </td>
                    {l.values.map((v, i) => (
                      <td key={i} className={`num px-3 py-2 text-end ${v === null ? "text-muted-foreground" : ""}`}>
                        {v === null ? "—" : fmtNum(v, Math.abs(v) >= 1000 ? 0 : v % 1 === 0 ? 0 : 2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2.5 text-[11px] text-muted-foreground border-t">{tt(data.note, lang)}</p>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">{tt(T.stmtNoData, lang)}</p>
      )}

      {/* FY-vs-FY comparison (equal-length periods only) */}
      {cmp && cmp.periods.filter((p) => p.startsWith("FY")).length >= 2 && (
        <FyCompare table={cmp} lang={lang} />
      )}
    </div>
  );
}

/** Annual revenue / net income bars + EPS line, from the parsed income
 *  statement (same numbers as the table — a visual, not a new source). */
function FinCharts({ table, lang }: { table: StmtTable; lang: "ar" | "en" }) {
  const find = (needle: string) =>
    table.lines.find((l) => l.label.toLowerCase().includes(needle)) ?? null;
  const rev = find("revenue");
  const ni = find("net income");
  const eps = find("earnings per share");

  // periods are newest-first (TTM, FY 2025, …) — reverse for a left→right time axis
  const order = table.periods.map((p, i) => ({ p, i })).reverse();
  const rows = order
    .map(({ p, i }) => ({
      period: p,
      revenue: rev?.values[i] ?? null,
      netIncome: ni?.values[i] ?? null,
      eps: eps?.values[i] ?? null,
    }))
    .filter((r) => r.revenue !== null || r.netIncome !== null);

  if (rows.length < 2) return null;

  return (
    <section aria-label="financial charts" className="rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
        <h2 className="text-lg font-bold">{tt(T.finChartsTitle, lang)}</h2>
        <span className="text-[11px] text-muted-foreground num">{tt(T.inMnEgp, lang)}</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">{tt(T.finChartsNote, lang)}</p>
      <div className="h-72" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="period"
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
            />
            <YAxis
              yAxisId="mn"
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              width={54}
              tickFormatter={(v: number) => fmtValue(v * 1e6)}
            />
            {eps && (
              <YAxis
                yAxisId="eps"
                orientation="right"
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={40}
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => fmtNum(v, 1)}
              />
            )}
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--popover-foreground)",
              }}
              labelStyle={{ color: "var(--muted-foreground)" }}
              formatter={(value: number, key: string) => [
                key === "eps" ? fmtNum(value, 2) : fmtValue(value * 1e6),
                key === "revenue"
                  ? tt(T.revenueName, lang)
                  : key === "netIncome"
                    ? tt(T.netIncomeName, lang)
                    : tt(T.epsName, lang),
              ]}
            />
            <Legend
              formatter={(key: string) => (
                <span style={{ color: "var(--muted-foreground)", fontSize: 11 }}>
                  {key === "revenue"
                    ? tt(T.revenueName, lang)
                    : key === "netIncome"
                      ? tt(T.netIncomeName, lang)
                      : tt(T.epsName, lang)}
                </span>
              )}
            />
            <Bar yAxisId="mn" dataKey="revenue" fill="var(--c4)" fillOpacity={0.75} radius={[3, 3, 0, 0]} maxBarSize={42} />
            <Bar yAxisId="mn" dataKey="netIncome" fill="var(--c3)" fillOpacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={42} />
            {eps && (
              <Line
                yAxisId="eps"
                type="monotone"
                dataKey="eps"
                stroke="var(--c5)"
                strokeWidth={2}
                dot={{ r: 2.5, fill: "var(--c5)", strokeWidth: 0 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {/* quick stat readouts for the two headline bars */}
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
        {(
          [
            [tt(T.revenueName, lang), rows[rows.length - 1].revenue],
            [tt(T.netIncomeName, lang), rows[rows.length - 1].netIncome],
            [tt(T.epsName, lang), rows[rows.length - 1].eps],
          ] as [string, number | null][]
        ).map(([label, v]) => {
          const prev = rows[rows.length - 2];
          const pv = label === tt(T.revenueName, lang) ? prev?.revenue : label === tt(T.netIncomeName, lang) ? prev?.netIncome : prev?.eps;
          const growth = v !== null && pv != null && pv !== 0 ? ((v - pv) / Math.abs(pv)) * 100 : null;
          return (
            <div key={label} className="rounded-md bg-secondary/50 p-2.5">
              <p className="text-[10px] text-muted-foreground leading-tight">
                {label} · <span className="num">{rows[rows.length - 1].period}</span>
              </p>
              <p className="num text-sm font-bold">{v === null ? "—" : label === tt(T.epsName, lang) ? fmtNum(v, 2) : fmtValue(v * 1e6)}</p>
              {growth !== null && (
                <p className={`num text-[10px] ${growth >= 0 ? "text-up" : "text-down"}`}>
                  {growth >= 0 ? "+" : ""}
                  {fmtNum(growth, 1)}% vs {rows[rows.length - 2].period}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {tt(T.finEpsTitle, lang)} — {tt(T.epsName, lang)} × <span className="num">{tt(T.inMnEgp, lang)}</span>
      </p>
    </section>
  );
}

/** Matching-period comparison: the two most recent fiscal years, line by line. */
function FyCompare({ table, lang }: { table: StmtTable; lang: "ar" | "en" }) {
  // periods are newest-first: "TTM", "FY 2025", "FY 2024", … — the latest FY
  // is the first "FY" index, the prior FY is the next one.
  const fyIdx = table.periods.map((p, i) => (p.startsWith("FY") ? i : -1)).filter((i) => i >= 0);
  const last = fyIdx[0];
  const prev = fyIdx[1];
  const label = (l: StmtLine) => (lang === "ar" && l.labelAr ? l.labelAr : l.label);

  const rows = table.lines
    .filter((l) => l.values[last] !== null || l.values[prev] !== null)
    .slice(0, 8);

  const pct = (a: number | null, b: number | null) => {
    if (a === null || b === null || b === 0) return null;
    return ((a - b) / Math.abs(b)) * 100;
  };

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="font-bold mb-1">{tt(T.stmtFyCompare, lang)}</h2>
      <p className="text-[11px] text-muted-foreground mb-3">{tt(T.stmtFyCompareNote, lang)}</p>
      <div className="overflow-x-auto thin-scroll">
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-[11px] text-muted-foreground">
              <th className="text-start font-medium py-2 pe-4">{tt(T.fyCol, lang)}</th>
              <th className="text-end font-medium px-3 py-2 num">{table.periods[prev]}</th>
              <th className="text-end font-medium px-3 py-2 num">{table.periods[last]}</th>
              <th className="text-end font-medium px-3 py-2">%</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((l) => {
              const a = l.values[last];
              const b = l.values[prev];
              const p = pct(a, b);
              return (
                <tr key={l.label} className="hover:bg-accent/30 transition-colors">
                  <td className="py-2 pe-4">{label(l)}</td>
                  <td className="num px-3 py-2 text-end text-muted-foreground">{b === null ? "—" : fmtNum(b, Math.abs(b) >= 1000 ? 0 : 2)}</td>
                  <td className="num px-3 py-2 text-end font-medium">{a === null ? "—" : fmtNum(a, Math.abs(a) >= 1000 ? 0 : 2)}</td>
                  <td className={`num px-3 py-2 text-end ${p === null ? "text-muted-foreground" : p >= 0 ? "text-up" : "text-down"}`}>
                    {p === null ? "—" : `${p >= 0 ? "+" : ""}${fmtNum(p, 1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
