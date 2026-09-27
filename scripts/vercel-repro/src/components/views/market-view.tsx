"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { bootParam, patchUrlParams } from "@/lib/url-state";
import { useLiveData, isDeadFeed } from "../market/use-live-data";
import type { CompanyRow, SessionMeta } from "../market/types";
import { T, tt, dn } from "@/lib/i18n";
import { fmtNum, fmtValue, fmtPct, fmtPE, directionClass } from "@/lib/format";
import { ExportXlsxButton } from "../market/export-xlsx-button";
import { WatchStar } from "../market/watch-star";
import { ChangeCell } from "../market/change-cell";
import { ErrorCard } from "./overview-view";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Search, Filter, X } from "lucide-react";
import { rowMatchesArabic } from "@/lib/ar-search";

const METRICS = [
  { key: "marketCap", ar: "القيمة السوقية", en: "Market cap", t: T.metricMarketCap },
  { key: "close", ar: "سعر السهم", en: "Share price", t: T.metricClose },
  { key: "divYield", ar: "عائد التوزيعات", en: "Dividend yield", t: T.metricDivYield },
  { key: "pe", ar: "مضاعف الربحية", en: "P/E", t: T.metricPe },
  { key: "pb", ar: "مضاعف القيمة الدفترية", en: "P/B", t: T.metricPb },
  { key: "netIncomeTTM", ar: "صافي الربح (١٢ شهراً)", en: "Net income (TTM)", t: T.metricNetIncome },
  { key: "roe", ar: "العائد على حقوق الملكية", en: "ROE", t: T.metricRoe },
  { key: "debtToEquity", ar: "الدين / حقوق الملكية", en: "Debt / equity", t: T.metricDe },
  { key: "eps", ar: "ربحية السهم", en: "EPS", t: T.metricEps },
  { key: "volumeRatio", ar: "الحجم غير المعتاد", en: "Unusual volume" },
  { key: "perfYTD", ar: "الأداء من بداية العام", en: "YTD performance" },
] as const;

type SortKey = (typeof METRICS)[number]["key"];

function metricOf(r: CompanyRow, key: SortKey): number | null {
  switch (key) {
    case "marketCap": return r.marketCap;
    case "close": return r.close;
    case "divYield": return r.divYield;
    case "pe": return r.pe;
    case "pb": return r.pb ?? null;
    case "netIncomeTTM": return r.netIncomeTTM ?? null;
    case "roe": return r.roe ?? null;
    case "debtToEquity": return r.debtToEquity ?? null;
    case "eps": return r.eps;
    case "volumeRatio": return r.volumeRatio;
    case "perfYTD": return r.perfYTD;
  }
}

export function MarketView() {
  const { lang, navigate } = useApp();
  // T41 — a total /api/companies outage must say so, not skeleton forever
  const { data, error, refresh, staleMs } = useLiveData<{ session: SessionMeta; total: number; rows: CompanyRow[] }>("/api/companies");
  const [tab, setTab] = useState<"prices" | "rank" | "unusual" | "metrics">("prices");
  const [q, setQ] = useState("");
  const [sector, setSector] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("marketCap");
  const [desc, setDesc] = useState(true);
  const [compareKey, setCompareKey] = useState<SortKey | "">("");

  // 21-c — shareable state: ?view=market&tab=…&sector=… (restores on boot;
  // kept in the URL live so the header Share button copies the exact table)
  useEffect(() => {
    const t = bootParam("tab");
    if (t === "prices" || t === "rank" || t === "unusual" || t === "metrics") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab(t);
    }
    const s = bootParam("sector");
    if (s) setSector(s);
  }, []);
  useEffect(() => {
    patchUrlParams({ tab: tab === "prices" ? null : tab, sector: sector || null });
  }, [tab, sector]);

  const rows = data?.rows ?? null;

  const sectors = useMemo(() => {
    if (!rows) return [];
    // T39 — label each sectorCode with the deterministic taxonomy label
    // (sectorGroupAr), NOT the per-company official label: the old
    // last-company-wins labeling made several codes show the SAME Arabic
    // text in the dropdown (and the label didn't even cover every member).
    const seen = new Map<string, string>();
    rows.forEach((r) => seen.set(r.sectorCode, lang === "ar" ? r.sectorGroupAr : r.sectorEn));
    return Array.from(seen.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name, lang === "ar" ? "ar" : "en"));
  }, [rows, lang]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    let out = rows;
    if (q) {
      const needle = q.toLowerCase();
      out = out.filter(
        (r) =>
          r.ticker.toLowerCase().includes(needle) ||
          r.name.toLowerCase().includes(needle) ||
          (r.nameAr ?? "").includes(q) ||
          (lang === "ar" ? r.sectorAr : r.sectorEn).includes(q) ||
          rowMatchesArabic(r.ticker, q)
      );
    }
    if (sector) out = out.filter((r) => r.sectorCode === sector);
    if (tab === "unusual") {
      out = out.filter((r) => r.avgVolume && r.avgVolume > 0);
      out = [...out].sort((a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0));
      return out;
    }
    if (tab === "rank") {
      const get = (r: CompanyRow): number => {
        switch (sortKey) {
          case "marketCap": return r.marketCap ?? -Infinity;
          case "close": return r.close;
          case "divYield": return r.divYield ?? -Infinity;
          case "pe": return r.pe ?? (desc ? -Infinity : Infinity);
          case "pb": return r.pb ?? (desc ? -Infinity : Infinity);
          case "netIncomeTTM": return r.netIncomeTTM ?? -Infinity;
          case "roe": return r.roe ?? -Infinity;
          case "debtToEquity": return r.debtToEquity ?? (desc ? -Infinity : Infinity);
          case "eps": return r.eps ?? -Infinity;
          case "volumeRatio": return r.volumeRatio ?? -Infinity;
          case "perfYTD": return r.perfYTD ?? -Infinity;
        }
      };
      // companies missing the ranked metric drop to the bottom regardless
      const withMetric = out.filter((r) => metricOf(r, sortKey) !== null);
      const without = out.filter((r) => metricOf(r, sortKey) === null);
      const sorted = [...withMetric].sort((a, b) => (desc ? get(b) - get(a) : get(a) - get(b)));
      return [...sorted, ...without];
    }
    if (tab === "metrics") {
      return [...out].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
    }
    return [...out].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  }, [rows, q, sector, tab, sortKey, desc, lang]);

  // T41 — a total outage must say so (after every hook, so the Rules of
  // Hooks hold when the refetch lands); a brief hiccup keeps fresh data
  if (isDeadFeed({ error, data, staleMs })) return <ErrorCard lang={lang} onRetry={refresh} />;

  const shown = filtered?.length ?? 0;

  const fmtMetric = (key: SortKey, v: number | null): string => {
    if (v === null || v === undefined) return "—";
    if (key === "marketCap" || key === "netIncomeTTM") return `EGP ${fmtValue(v)}`;
    if (key === "divYield" || key === "roe" || key === "perfYTD") return `${fmtNum(v, 1)}%`;
    if (key === "volumeRatio") return `${fmtNum(v, 1)}×`;
    if (key === "eps" || key === "close") return fmtNum(v);
    if (key === "pe") return fmtPE(v); // T39 — extreme P/E renders as —
    return fmtNum(v, 2);
  };

  const withMetricCount = rows ? rows.filter((r) => metricOf(r, sortKey) !== null).length : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{tt(T.allCompanies, lang)}</h1>
        {filtered && (
          <p className="num text-xs text-muted-foreground">
            {shown} / {rows?.length ?? 0} · {data?.session.lastSession} · {tt(T.delayed, lang)}
          </p>
        )}
      </div>

      {/* tabs */}
      <div className="flex items-center gap-1 overflow-x-auto thin-scroll border-b" role="tablist">
        {([
          ["prices", T.pricesTab], ["rank", T.rankTab], ["unusual", T.unusualTab], ["metrics", T.sectorMetricsTab],
        ] as const).map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`whitespace-nowrap px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${
              tab === key ? "border-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            {tt(label, lang)}
          </button>
        ))}
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={lang === "ar" ? "بحث في الجدول…" : "Filter table…"}
            className="ps-8 h-9 text-sm" />
        </div>
        <select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          className="h-9 rounded-md border bg-card px-2.5 text-sm text-foreground"
          aria-label={tt(T.allSectors, lang)}
        >
          <option value="">{tt(T.allSectors, lang)}</option>
          {sectors.map((s) => (
            <option key={s.code} value={s.code}>{s.name}</option>
          ))}
        </select>
        {(q || sector) && (
          <button onClick={() => { setQ(""); setSector(""); }} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" /> {tt(T.clearFilters, lang)}
          </button>
        )}
        <button
          onClick={() => navigate("screener")}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          title={tt(T.screenerNote, lang)}
        >
          <Filter className="h-3 w-3" /> {tt(T.fullScreener, lang)}
        </button>
        {/* 21-b — the whole live market table as a branded Excel report */}
        {filtered && filtered.length > 0 && <ExportXlsxButton report="market" />}
        <span className="flex-1" />
        {tab === "rank" && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
            <Filter className="h-3.5 w-3.5" />
            <label className="flex items-center gap-1">
              <span className="hidden sm:inline">{tt(T.rankMetric, lang)}:</span>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="h-8 rounded-md border bg-card px-2 text-xs">
                {METRICS.map((m) => (
                  <option key={m.key} value={m.key}>{lang === "ar" ? m.ar : m.en}</option>
                ))}
              </select>
            </label>
            <button onClick={() => setDesc(!desc)} className="h-8 rounded-md border bg-card px-2 text-xs hover:bg-accent">
              {desc ? (lang === "ar" ? "الأعلى أولاً ↓" : "Highest first ↓") : (lang === "ar" ? "الأدنى أولاً ↑" : "Lowest first ↑")}
            </button>
            <label className="flex items-center gap-1">
              <span className="hidden sm:inline">{tt(T.compareMetric, lang)}:</span>
              <select value={compareKey} onChange={(e) => setCompareKey(e.target.value as SortKey | "")} className="h-8 rounded-md border bg-card px-2 text-xs">
                <option value="">—</option>
                {METRICS.filter((m) => m.key !== sortKey).map((m) => (
                  <option key={m.key} value={m.key}>{lang === "ar" ? m.ar : m.en}</option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {/* table */}
      {!filtered ? (
        <div className="space-y-2">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <Skeleton key={i} className="h-11" />)}</div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="max-h-[70vh] overflow-auto thin-scroll">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10 border-b">
                <tr className="text-[11px] text-muted-foreground">
                  <th className="w-10" aria-label="watch" />
                  <th className="text-start font-medium px-3 py-2.5">{tt(T.colTicker, lang)}</th>
                  <th className="text-start font-medium px-3 py-2.5 hidden md:table-cell">{tt(T.colName, lang)}</th>
                  <th className="text-start font-medium px-3 py-2.5 hidden lg:table-cell">{tt(T.colSector, lang)}</th>
                  <th className="text-end font-medium px-3 py-2.5">{tt(T.colClose, lang)}</th>
                  <th className="text-end font-medium px-3 py-2.5">{tt(T.colChange, lang)}</th>
                  {tab === "unusual" ? (
                    <th className="text-end font-medium px-3 py-2.5">{lang === "ar" ? "الحجم ÷ المعتاد" : "Vol ÷ usual"}</th>
                  ) : (
                    <th className="text-end font-medium px-3 py-2.5 hidden sm:table-cell">{tt(T.colValue, lang)}</th>
                  )}
                  {tab === "rank" && (
                    <>
                      <th className="text-end font-medium px-3 py-2.5 whitespace-nowrap">
                        {METRICS.find((m) => m.key === sortKey) ? (lang === "ar" ? METRICS.find((m) => m.key === sortKey)!.ar : METRICS.find((m) => m.key === sortKey)!.en) : ""}
                      </th>
                      {compareKey && (
                        <th className="text-end font-medium px-3 py-2.5 whitespace-nowrap hidden md:table-cell">
                          {lang === "ar" ? METRICS.find((m) => m.key === compareKey)?.ar : METRICS.find((m) => m.key === compareKey)?.en}
                        </th>
                      )}
                    </>
                  )}
                  <th className="text-end font-medium px-3 py-2.5 hidden md:table-cell">{tt(T.colPe, lang)}</th>
                  {tab === "metrics" && (
                    <>
                      <th className="text-end font-medium px-3 py-2.5 hidden sm:table-cell">{tt(T.col52w, lang)}</th>
                      <th className="text-end font-medium px-3 py-2.5 hidden md:table-cell">{tt(T.ytd, lang)}</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r) => (
                  <tr key={r.ticker} className="hover:bg-accent/30 cursor-pointer transition-colors"
                    onClick={() => navigate("company", { ticker: r.ticker, panel: "overview" })}>
                    <td className="ps-1"><WatchStar ticker={r.ticker} /></td>
                    <td className="num px-3 py-2.5 font-bold">{r.ticker}</td>
                    <td className="px-3 py-2.5 hidden md:table-cell max-w-[260px] truncate text-muted-foreground">
                      {dn(r, lang)}
                    </td>
                    <td className="px-3 py-2.5 hidden lg:table-cell text-xs text-muted-foreground max-w-[160px] truncate">
                      {lang === "ar" ? r.sectorAr : r.sectorEn}
                    </td>
                    <td className="num px-3 py-2.5 text-end font-medium">{fmtNum(r.close)}{r.usdQuoted ? <span className="ms-1 text-[9px] text-muted-foreground">US$</span> : null}</td>
                    <td className="px-3 py-2.5 text-end"><ChangeCell pct={r.changePct} /></td>
                    {tab === "unusual" ? (
                      <td className="num px-3 py-2.5 text-end font-semibold text-primary">
                        {r.volumeRatio !== null ? `${fmtNum(r.volumeRatio, 1)}×` : "—"}
                      </td>
                    ) : (
                      <td className="num px-3 py-2.5 text-end hidden sm:table-cell text-muted-foreground">{fmtValue(r.valueTraded)}</td>
                    )}
                    {tab === "rank" && (
                      <>
                        <td className="num px-3 py-2.5 text-end font-semibold">
                          {fmtMetric(sortKey, metricOf(r, sortKey))}
                        </td>
                        {compareKey && (
                          <td className="num px-3 py-2.5 text-end hidden md:table-cell text-muted-foreground">
                            {fmtMetric(compareKey, metricOf(r, compareKey))}
                          </td>
                        )}
                      </>
                    )}
                    <td className="num px-3 py-2.5 text-end hidden md:table-cell text-muted-foreground">
                      {fmtPE(r.pe)}
                    </td>
                    {tab === "metrics" && (
                      <>
                        <td className="num px-3 py-2.5 text-end hidden sm:table-cell text-muted-foreground text-xs">
                          {r.high52 !== null && r.low52 !== null ? `${fmtNum(r.low52, 1)} – ${fmtNum(r.high52, 1)}` : "—"}
                        </td>
                        <td className={`num px-3 py-2.5 text-end hidden md:table-cell ${directionClass(r.perfYTD)}`}>
                          {fmtPct(r.perfYTD)}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={tab === "metrics" ? 10 : 8} className="px-3 py-10 text-center text-muted-foreground text-sm">
                    {lang === "ar" ? "لا نتائج مطابقة" : "No matching rows"}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "unusual" && filtered && filtered.length > 0 && (
        <p className="text-[11px] text-muted-foreground">{tt(T.unusualNote, lang)}</p>
      )}
      {tab === "rank" && rows && (
        <p className="text-[11px] text-muted-foreground num">
          <span className="font-semibold text-foreground">{withMetricCount}</span> {tt(T.companiesWithMetric, lang)} · {tt(T.rankNote, lang)}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground num">
        {tt(T.stock, lang)}: {shown}
      </p>
    </div>
  );
}
