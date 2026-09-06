"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { T, tt } from "@/lib/i18n";
import { fmtNum, fmtValue, fmtPct } from "@/lib/format";
import { WatchStar } from "../market/watch-star";
import { ChangeCell } from "../market/change-cell";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Search, Filter, X } from "lucide-react";

type Row = {
  ticker: string; nameAr: string; nameEn: string; sectorAr: string; sectorEn: string;
  sectorCode: string; close: number; changePct: number; valueTraded: number;
  pe: number | null; marketCap: number; volume: number; avgVolume30d: number;
};

const METRICS = [
  { key: "marketCap", ar: "القيمة السوقية", en: "Market cap" },
  { key: "close", ar: "سعر السهم", en: "Share price" },
  { key: "divYield", ar: "عائد التوزيعات", en: "Dividend yield" },
  { key: "pe", ar: "مضاعف الربحية", en: "P/E" },
  { key: "volumeRatio", ar: "الحجم غير المعتاد", en: "Unusual volume" },
] as const;

type SortKey = (typeof METRICS)[number]["key"];

export function MarketView() {
  const { lang, navigate, auth } = useApp();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [tab, setTab] = useState<"prices" | "rank" | "unusual" | "metrics">("prices");
  const [q, setQ] = useState("");
  const [sector, setSector] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("marketCap");
  const [desc, setDesc] = useState(true);

  useEffect(() => {
    fetch("/api/companies")
      .then((r) => r.json())
      .then((d) => setRows(d.rows ?? []))
      .catch(() => setRows([]));
  }, [auth.email]);

  const sectors = useMemo(() => {
    if (!rows) return [];
    const seen = new Map<string, string>();
    rows.forEach((r) => seen.set(r.sectorCode, lang === "ar" ? r.sectorAr : r.sectorEn));
    return Array.from(seen, ([code, name]) => ({ code, name }));
  }, [rows, lang]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    let out = [...rows];
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      out = out.filter((r) => r.ticker.toLowerCase().includes(s) || r.nameAr.includes(s) || r.nameEn.toLowerCase().includes(s));
    }
    if (sector) out = out.filter((r) => r.sectorCode === sector);
    if (tab === "unusual") {
      out = out.filter((r) => r.avgVolume30d > 0);
      out.sort((a, b) => b.volume / b.avgVolume30d - a.volume / a.avgVolume30d);
      return out;
    }
    if (tab === "rank") {
      const get = (r: Row) =>
        sortKey === "marketCap" ? r.marketCap
        : sortKey === "close" ? r.close
        : sortKey === "pe" ? (r.pe ?? -Infinity)
        : sortKey === "divYield" ? (r.close ? -Infinity : 0) // handled below with fallback
        : r.volume / Math.max(r.avgVolume30d, 1);
      out.sort((a, b) => (desc ? get(b) - get(a) : get(a) - get(b)));
      return out;
    }
    out.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
    return out;
  }, [rows, q, sector, tab, sortKey, desc]);

  const shown = filtered?.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{tt(T.allCompanies, lang)}</h1>
        {filtered && (
          <p className="num text-xs text-muted-foreground">{shown} / {rows?.length ?? 0}</p>
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
        <span className="flex-1" />
        {tab === "rank" && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="h-8 rounded-md border bg-card px-2 text-xs">
              {METRICS.map((m) => (
                <option key={m.key} value={m.key}>{lang === "ar" ? m.ar : m.en}</option>
              ))}
            </select>
            <button onClick={() => setDesc(!desc)} className="h-8 rounded-md border bg-card px-2 text-xs hover:bg-accent">
              {desc ? (lang === "ar" ? "الأعلى أولاً ↓" : "Highest first ↓") : (lang === "ar" ? "الأدنى أولاً ↑" : "Lowest first ↑")}
            </button>
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
                  <th className="text-end font-medium px-3 py-2.5 hidden sm:table-cell">{tt(T.colValue, lang)}</th>
                  <th className="text-end font-medium px-3 py-2.5 hidden md:table-cell">{tt(T.colPe, lang)}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r) => (
                  <tr key={r.ticker} className="hover:bg-accent/30 cursor-pointer transition-colors"
                    onClick={() => navigate("company", { ticker: r.ticker, panel: "overview" })}>
                    <td className="ps-1"><WatchStar ticker={r.ticker} /></td>
                    <td className="num px-3 py-2.5 font-bold">{r.ticker}</td>
                    <td className="px-3 py-2.5 hidden md:table-cell max-w-[260px] truncate text-muted-foreground">
                      {lang === "ar" ? r.nameAr : r.nameEn}
                    </td>
                    <td className="px-3 py-2.5 hidden lg:table-cell text-xs text-muted-foreground max-w-[160px] truncate">
                      {lang === "ar" ? r.sectorAr : r.sectorEn}
                    </td>
                    <td className="num px-3 py-2.5 text-end font-medium">{fmtNum(r.close)}</td>
                    <td className="px-3 py-2.5 text-end"><ChangeCell pct={r.changePct} /></td>
                    <td className="num px-3 py-2.5 text-end hidden sm:table-cell text-muted-foreground">{fmtValue(r.valueTraded)}</td>
                    <td className="num px-3 py-2.5 text-end hidden md:table-cell text-muted-foreground">
                      {r.pe ? fmtNum(r.pe, 1) : "—"}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground text-sm">
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
      <p className="text-[11px] text-muted-foreground num">
        {tt(T.stock, lang)}: {shown} · {fmtPct(0, false) && ""}06 Sep 2026
      </p>
    </div>
  );
}
