"use client";

import { useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { useLiveData } from "../market/use-live-data";
import type { CompanyRow, SessionMeta } from "../market/types";
import { T, tt } from "@/lib/i18n";
import { fmtPct } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

function heatColor(pct: number): { bg: string; fg: string } {
  if (pct === 0) return { bg: "var(--secondary)", fg: "var(--muted-foreground)" };
  const cap = 4; // full saturation at ±4%
  const intensity = Math.min(Math.abs(pct) / cap, 1);
  const alpha = 0.12 + intensity * 0.55;
  if (pct > 0) return { bg: `oklch(0.55 0.16 150 / ${alpha.toFixed(2)})`, fg: intensity > 0.55 ? "#fff" : "var(--up)" };
  return { bg: `oklch(0.52 0.19 25 / ${alpha.toFixed(2)})`, fg: intensity > 0.55 ? "#fff" : "var(--down)" };
}

export function HeatView() {
  const { lang, navigate } = useApp();
  const { data } = useLiveData<{ session: SessionMeta; total: number; rows: CompanyRow[] }>("/api/companies");
  const [scope, setScope] = useState<"all" | "top30">("all");
  const [sectorFocus, setSectorFocus] = useState<string>("");

  const rows = data?.rows ?? null;

  const scoped = useMemo(() => {
    if (!rows) return null;
    if (scope === "top30") {
      return [...rows]
        .filter((r) => r.marketCap !== null)
        .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
        .slice(0, 30);
    }
    return rows;
  }, [rows, scope]);

  const groups = useMemo(() => {
    if (!scoped) return [];
    const bySector = new Map<string, { name: string; rows: CompanyRow[] }>();
    scoped.forEach((r) => {
      if (sectorFocus && r.sectorCode !== sectorFocus) return;
      const g = bySector.get(r.sectorCode) ?? { name: lang === "ar" ? r.sectorAr : r.sectorEn, rows: [] };
      g.rows.push(r);
      bySector.set(r.sectorCode, g);
    });
    return Array.from(bySector.entries())
      .map(([code, g]) => ({
        code,
        name: g.name,
        rows: [...g.rows].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)),
        cap: g.rows.reduce((acc, r) => acc + (r.marketCap ?? 0), 0),
      }))
      .sort((a, b) => b.cap - a.cap);
  }, [scoped, sectorFocus, lang]);

  if (!rows || !scoped) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{tt(T.heatTitle, lang)}</h1>
      <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">{tt(T.heatNote, lang)}</p>

      {/* scope selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="num text-xs text-muted-foreground">{data?.session.lastSession} · {tt(T.delayed, lang)}</span>
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
          {([
            ["all", T.wholeExchange],
            ["top30", T.topCaps],
          ] as const).map(([key, label]) => {
            const count = key === "all" ? rows.length : Math.min(30, rows.filter((r) => r.marketCap !== null).length);
            return (
              <button
                key={key}
                onClick={() => { setScope(key); setSectorFocus(""); }}
                className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                  scope === key ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-accent"
                }`}
                aria-pressed={scope === key}
              >
                {tt(label, lang)} <span className="num opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        {sectorFocus && (
          <button onClick={() => setSectorFocus("")} className="text-xs text-muted-foreground hover:text-foreground underline">
            {tt(T.clearFilters, lang)}
          </button>
        )}
      </div>

      {/* sector chips */}
      <div className="flex flex-wrap gap-1.5">
        {groups.map((g) => (
          <button
            key={g.code}
            onClick={() => setSectorFocus(sectorFocus === g.code ? "" : g.code)}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              sectorFocus === g.code ? "bg-secondary font-semibold border-ring" : "bg-card hover:border-ring"
            }`}
          >
            {g.name} <span className="num text-muted-foreground">{g.rows.length}</span>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{tt(T.fillSector, lang)}</p>

      {/* treemap-ish grid */}
      <div className="space-y-4">
        {groups.map((g) => (
          <section key={g.code} aria-label={g.name}>
            <h2 className="text-xs font-semibold text-muted-foreground mb-1.5">
              {g.name} · <span className="num">{g.rows.length}</span>
            </h2>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-1">
              {g.rows.map((r, i) => {
                // bigger cap => span more cells (first 3 rows get larger spans)
                const span = i === 0 ? "col-span-2 row-span-2" : i < 4 ? "col-span-2" : "";
                const { bg, fg } = heatColor(r.changePct);
                return (
                  <button
                    key={r.ticker}
                    onClick={() => navigate("company", { ticker: r.ticker, panel: "overview" })}
                    style={{ backgroundColor: bg, color: fg }}
                    className={`${span} flex flex-col items-center justify-center rounded-md p-2 min-h-14 transition-transform hover:scale-105 hover:z-10`}
                    title={`${r.ticker} · ${fmtPct(r.changePct)}`}
                  >
                    <span className="num text-xs font-bold">{r.ticker}</span>
                    <span className="num text-[10px]">{fmtPct(r.changePct)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
