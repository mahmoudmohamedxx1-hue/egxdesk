"use client";

/** Portfolio tracker view (G2): holdings with live P&L. Positions are
 *  device-stored (no account — the app has no auth by design); every number
 *  is recomputed from the live quote table on each refresh. Mounted as a
 *  tab inside the watchlist view (watchlist = what I watch, portfolio =
 *  what I own). */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { useLiveData } from "../market/use-live-data";
import type { CompanyRow, SessionMeta } from "../market/types";
import { T, tt, dn } from "@/lib/i18n";
import { fmtNum, fmtValue, fmtInt, directionClass } from "@/lib/format";
import { ChangeCell } from "../market/change-cell";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Briefcase, Download, Trash2 } from "lucide-react";
import { loadPositions, savePositions, type Position } from "@/lib/portfolio";
import { downloadCsv, fileStamp } from "@/lib/export";

type Row = CompanyRow;

export function PortfolioView() {
  const { lang, navigate, toast } = useApp();
  const { data } = useLiveData<{ session: SessionMeta; total: number; rows: Row[] }>("/api/companies");

  const [positions, setPositions] = useState<Position[] | null>(null); // null = not yet restored
  useEffect(() => {
    try {
      // SSR-safe localStorage restore (mount effect is the honest pattern here)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPositions(loadPositions());
    } catch {
      setPositions([]);
    }
  }, []);

  const persist = (next: Position[]) => {
    setPositions(next);
    savePositions(next);
  };

  // add-position form state
  const [q, setQ] = useState("");
  const [shares, setShares] = useState("");
  const [cost, setCost] = useState("");
  const [err, setErr] = useState("");

  const suggestions = useMemo(() => {
    if (!data || q.trim().length < 1) return [];
    const needle = q.trim().toLowerCase();
    const ar = /[\u0600-\u06FF]/.test(needle);
    return data.rows
      .filter((r) => {
        if (r.ticker.toLowerCase().startsWith(needle)) return true;
        if (!ar && r.name.toLowerCase().includes(needle)) return true;
        if (ar && (r.nameAr ?? "").includes(q.trim())) return true;
        return false;
      })
      .slice(0, 7);
  }, [data, q]);

  // joined rows: position + live quote (quotes missing → row dropped with a count note)
  const joined = useMemo(() => {
    if (!data || !positions) return null;
    const byTicker = new Map(data.rows.map((r) => [r.ticker, r] as const));
    const out = positions.map((p) => ({ p, r: byTicker.get(p.ticker) ?? null }));
    return { rows: out, missing: out.filter((x) => !x.r).length };
  }, [data, positions]);

  // aggregates
  const agg = useMemo(() => {
    if (!joined) return null;
    let value = 0;
    let costBasis = 0;
    let dayPl = 0;
    for (const { p, r } of joined.rows) {
      if (!r || r.close == null) continue;
      const mv = p.shares * r.close;
      value += mv;
      costBasis += p.shares * p.cost;
      if (r.changeAbs != null) dayPl += p.shares * r.changeAbs;
    }
    const totalPl = value - costBasis;
    return {
      value,
      costBasis,
      dayPl,
      totalPl,
      totalPlPct: costBasis > 0 ? (totalPl / costBasis) * 100 : null,
      shares: joined.rows.reduce((s, x) => s + x.p.shares, 0),
    };
  }, [joined]);

  const addPosition = () => {
    const t = q.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const sh = Math.floor(Number(shares));
    const c = Number(cost);
    if (!t || !data?.rows.some((r) => r.ticker === t)) {
      setErr(lang === "ar" ? "اختر شركة من القائمة" : "Pick a company from the list");
      return;
    }
    if (!Number.isFinite(sh) || sh <= 0) {
      setErr(tt(T.invalidShares, lang));
      return;
    }
    if (!Number.isFinite(c) || c <= 0) {
      setErr(tt(T.invalidCost, lang));
      return;
    }
    setErr("");
    const existing = positions ?? [];
    const next = existing.some((p) => p.ticker === t)
      ? existing.map((p) => (p.ticker === t ? { ...p, shares: p.shares + sh, cost: (p.cost * p.shares + c * sh) / (p.shares + sh) } : p))
      : [...existing, { ticker: t, shares: sh, cost: c, addedAt: new Date().toISOString() }];
    persist(next);
    setQ("");
    setShares("");
    setCost("");
    toast(lang === "ar" ? `أُضيفت ${t} إلى المحفظة` : `${t} added to portfolio`);
  };

  const removePosition = (ticker: string) => {
    persist((positions ?? []).filter((p) => p.ticker !== ticker));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{tt(T.portfolioTitle, lang)}</h1>
        <p className="num text-xs text-muted-foreground">
          {positions ? `${positions.length} ${tt(T.portfolioPositions, lang)}` : ""} · {data?.session.lastSession} · {tt(T.delayed, lang)}
        </p>
      </div>
      <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">{tt(T.portfolioNote, lang)}</p>

      {/* add position */}
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <p className="text-xs font-semibold flex items-center gap-1.5">
          <Briefcase className="h-3.5 w-3.5 text-primary" />
          {tt(T.portfolioAdd, lang)}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="relative col-span-2 sm:col-span-1">
            <Input
              dir="ltr"
              value={q}
              onChange={(e) => setQ(e.target.value.toUpperCase())}
              placeholder={tt(T.portfolioTicker, lang)}
              aria-label={tt(T.portfolioTicker, lang)}
              className="h-8 text-xs num"
            />
            {suggestions.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full rounded-md border bg-card shadow-md overflow-hidden" role="listbox">
                {suggestions.map((r) => (
                  <li key={r.ticker}>
                    <button
                      className="w-full text-start px-2 py-1.5 text-[11px] hover:bg-accent/50 flex items-baseline justify-between gap-2"
                      onClick={() => {
                        setQ(r.ticker);
                        setCost((v) => v || (r.close != null ? String(r.close) : v));
                      }}
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
          <Input
            dir="ltr"
            inputMode="numeric"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            placeholder={tt(T.portfolioShares, lang)}
            aria-label={tt(T.portfolioShares, lang)}
            className="h-8 text-xs num"
          />
          <Input
            dir="ltr"
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder={tt(T.portfolioCost, lang)}
            aria-label={tt(T.portfolioCost, lang)}
            className="h-8 text-xs num"
          />
          <Button size="sm" className="h-8 text-xs" onClick={addPosition}>
            {tt(T.portfolioSave, lang)}
          </Button>
        </div>
        {err && <p className="text-[11px] text-down">{err}</p>}
        <p className="text-[10px] text-muted-foreground">{tt(T.portfolioCostHint, lang)}</p>
      </div>

      {/* summary + table */}
      {positions === null || !joined || !agg ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : positions.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center space-y-3">
          <Briefcase className="h-8 w-8 mx-auto text-muted-foreground" aria-hidden />
          <p className="font-medium">{tt(T.portfolioEmpty, lang)}</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">{tt(T.portfolioEmptyHint, lang)}</p>
        </div>
      ) : (
        <>
          {/* summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card label={tt(T.portfolioTotalValue, lang)} value={`EGP ${fmtValue(agg.value)}`} sub={`${fmtInt(agg.shares)} ${tt(T.portfolioSharesSum, lang)}`} />
            <Card label={tt(T.portfolioDayPl, lang)} value={`${agg.dayPl >= 0 ? "+" : ""}${fmtNum(agg.dayPl, 0)}`} cls={directionClass(agg.dayPl)} sub="EGP" />
            <Card
              label={tt(T.portfolioTotalPl, lang)}
              value={`${agg.totalPl >= 0 ? "+" : ""}${fmtNum(agg.totalPl, 0)}`}
              cls={directionClass(agg.totalPl)}
              sub={agg.totalPlPct != null ? `${agg.totalPlPct >= 0 ? "+" : ""}${agg.totalPlPct.toFixed(2)}% · EGP` : "EGP"}
            />
            <Card label={tt(T.portfolioCostValue, lang)} value={`EGP ${fmtValue(agg.costBasis)}`} />
          </div>

          {joined.missing > 0 && (
            <p className="text-[11px] text-muted-foreground num">
              {joined.missing} {lang === "ar" ? "حيازة بلا سعر حالي (خارج نطاق التغطية)" : "position(s) without a live quote (outside coverage)"}
            </p>
          )}

          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b bg-card/50">
              <p className="text-xs text-muted-foreground num">
                {positions.length} {tt(T.portfolioPositions, lang)}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-[11px] text-muted-foreground"
                title={tt(T.csvExportHint, lang)}
                onClick={() => {
                  const headers = [
                    "ticker", "name", "shares", "avg_cost_egp", "last_close", "market_value_egp",
                    "day_pl_egp", "total_pl_egp", "total_pl_pct", "weight_pct",
                  ];
                  const body = joined.rows
                    .filter((x) => x.r && x.r.close != null)
                    .map(({ p, r }) => {
                      const mv = p.shares * (r?.close ?? 0);
                      const pl = (r ? (r.close ?? 0) - p.cost : 0) * p.shares;
                      return [
                        p.ticker, r?.name ?? "", p.shares, p.cost, r?.close ?? null,
                        +mv.toFixed(2),
                        +(r?.changeAbs != null ? r.changeAbs * p.shares : 0).toFixed(2),
                        +pl.toFixed(2),
                        p.cost > 0 ? +((pl / (p.cost * p.shares)) * 100).toFixed(2) : null,
                        agg.value > 0 ? +((mv / agg.value) * 100).toFixed(2) : null,
                      ];
                    });
                  downloadCsv(`egx-portfolio-${fileStamp()}`, headers, body);
                }}
              >
                <Download className="h-3 w-3" />
                CSV
              </Button>
            </div>
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="border-b bg-card sticky top-0">
                  <tr className="text-[11px] text-muted-foreground">
                    <th className="w-8" aria-label="remove" />
                    <th className="text-start font-medium px-3 py-2.5">{tt(T.colTicker, lang)}</th>
                    <th className="text-start font-medium px-3 py-2.5 hidden md:table-cell">{tt(T.colName, lang)}</th>
                    <th className="text-end font-medium px-3 py-2.5">{tt(T.portfolioShares, lang)}</th>
                    <th className="text-end font-medium px-3 py-2.5">{tt(T.portfolioCost, lang)}</th>
                    <th className="text-end font-medium px-3 py-2.5">{tt(T.colClose, lang)}</th>
                    <th className="text-end font-medium px-3 py-2.5">{tt(T.colChange, lang)}</th>
                    <th className="text-end font-medium px-3 py-2.5 hidden sm:table-cell">{tt(T.portfolioMarketValue, lang)}</th>
                    <th className="text-end font-medium px-3 py-2.5">{tt(T.portfolioTotalPl, lang)}</th>
                    <th className="text-end font-medium px-3 py-2.5 hidden lg:table-cell">{tt(T.portfolioWeight, lang)}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {joined.rows.map(({ p, r }) => {
                    const mv = r?.close != null ? p.shares * r.close : null;
                    const pl = r?.close != null ? (r.close - p.cost) * p.shares : null;
                    const plPct = pl != null && p.cost > 0 ? (pl / (p.cost * p.shares)) * 100 : null;
                    const weight = mv != null && agg.value > 0 ? (mv / agg.value) * 100 : null;
                    return (
                      <tr
                        key={p.ticker}
                        className="hover:bg-accent/30 cursor-pointer transition-colors"
                        onClick={() => navigate("company", { ticker: p.ticker, panel: "overview" })}
                      >
                        <td className="ps-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removePosition(p.ticker);
                            }}
                            aria-label={tt(T.portfolioRemove, lang)}
                            title={tt(T.portfolioRemove, lang)}
                            className="text-muted-foreground hover:text-down"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                        <td className="num px-3 py-2.5 font-bold">{p.ticker}</td>
                        <td className="px-3 py-2.5 hidden md:table-cell max-w-[220px] truncate text-muted-foreground">
                          {r ? dn(r, lang) : "—"}
                        </td>
                        <td className="num px-3 py-2.5 text-end">{fmtInt(p.shares)}</td>
                        <td className="num px-3 py-2.5 text-end text-muted-foreground">{fmtNum(p.cost)}</td>
                        <td className="num px-3 py-2.5 text-end font-medium">{r ? fmtNum(r.close) : "—"}</td>
                        <td className="px-3 py-2.5 text-end">{r ? <ChangeCell pct={r.changePct} /> : "—"}</td>
                        <td className="num px-3 py-2.5 text-end hidden sm:table-cell text-muted-foreground">
                          {mv != null ? fmtValue(mv) : "—"}
                        </td>
                        <td className={`num px-3 py-2.5 text-end font-semibold ${directionClass(pl)}`}>
                          {pl != null ? `${pl >= 0 ? "+" : ""}${fmtNum(pl, 0)}` : "—"}
                          {plPct != null && <span className="block text-[10px] font-normal">{plPct >= 0 ? "+" : ""}{plPct.toFixed(1)}%</span>}
                        </td>
                        <td className="num px-3 py-2.5 text-end hidden lg:table-cell">
                          {weight != null ? (
                            <div className="flex items-center gap-1.5 justify-end">
                              <span className="text-[10px] text-muted-foreground">{weight.toFixed(1)}%</span>
                              <span className="h-1.5 w-10 rounded-full bg-secondary overflow-hidden" dir="ltr">
                                <span className="block h-full bg-primary/70" style={{ width: `${Math.min(weight, 100)}%` }} />
                              </span>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Card({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-[11px] text-muted-foreground leading-tight">{label}</p>
      <p className={`num text-lg font-bold mt-1 ${cls ?? ""}`}>{value}</p>
      {sub && <p className="num text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
