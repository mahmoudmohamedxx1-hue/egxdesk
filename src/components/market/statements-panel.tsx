"use client";

import { useEffect, useState } from "react";
import { useApp } from "./app-context";
import { T, tt } from "@/lib/i18n";
import { fmtNum } from "@/lib/format";
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

  return (
    <div className="space-y-4">
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
