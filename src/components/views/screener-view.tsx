"use client";

import { useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { useLiveData } from "../market/use-live-data";
import type { CompanyRow, SessionMeta } from "../market/types";
import { T, tt, type Lang } from "@/lib/i18n";
import { fmtNum, fmtValue, fmtPct, fmtInt, directionClass } from "@/lib/format";
import { WatchStar } from "../market/watch-star";
import { ChangeCell } from "../market/change-cell";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Search, X, SlidersHorizontal, ChevronDown, Zap } from "lucide-react";
import { rowMatchesArabic } from "@/lib/ar-search";

/** Investing.com-style stock screener over the live company universe.
 *  All filtering happens client-side on the same /api/companies rows the
 *  market table uses; nothing is sent to a server. */

type Bound = { min: string; max: string };

const EMPTY_BOUND: Bound = { min: "", max: "" };

type PerfPeriod =
  | "perfW"
  | "perf1M"
  | "perf3M"
  | "perf6M"
  | "perfYTD"
  | "perfY"
  | "perf3Y"
  | "perf5Y";

type Filters = {
  q: string;
  sector: string;
  price: Bound;
  change: Bound;
  perfPeriod: PerfPeriod;
  perf: Bound;
  cap: Bound; // EGP mn
  pe: Bound;
  pb: Bound;
  yield: Bound;
  roe: Bound;
  de: Bound;
  eps: Bound;
  volumeMin: string;
  valueMin: string; // EGP mn
  volRatioMin: string;
  range52: "" | "high" | "low";
};

const DEFAULT_FILTERS: Filters = {
  q: "",
  sector: "",
  price: EMPTY_BOUND,
  change: EMPTY_BOUND,
  perfPeriod: "perfYTD",
  perf: EMPTY_BOUND,
  cap: EMPTY_BOUND,
  pe: EMPTY_BOUND,
  pb: EMPTY_BOUND,
  yield: EMPTY_BOUND,
  roe: EMPTY_BOUND,
  de: EMPTY_BOUND,
  eps: EMPTY_BOUND,
  volumeMin: "",
  valueMin: "",
  volRatioMin: "",
  range52: "",
};

const PERF_OPTIONS = [
  ["perfW", T.week],
  ["perf1M", T.month],
  ["perf3M", T.period3M],
  ["perf6M", T.period6M],
  ["perfYTD", T.ytd],
  ["perfY", T.period1Y],
  ["perf3Y", T.period3Y],
  ["perf5Y", T.period5Y],
] as const;

const PRESETS: { key: string; t: { ar: string; en: string }; patch: Partial<Filters> }[] = [
  { key: "gainers", t: T.presetGainers, patch: { change: { min: "0.01", max: "" } } },
  { key: "losers", t: T.presetLosers, patch: { change: { min: "", max: "-0.01" } } },
  { key: "payers", t: T.presetPayers, patch: { yield: { min: "0.1", max: "" } } },
  { key: "lowPe", t: T.presetLowPe, patch: { pe: { min: "", max: "10" } } },
  { key: "unusual", t: T.presetUnusual, patch: { volRatioMin: "2" } },
  { key: "largeCaps", t: T.presetLargeCaps, patch: { cap: { min: "10000", max: "" } } },
];

// ── sortable columns ──

type ColKey =
  | "ticker"
  | "close"
  | "changePct"
  | "marketCap"
  | "pe"
  | "pb"
  | "divYield"
  | "roe"
  | "perfYTD"
  | "volume"
  | "valueTraded";

type ColDef = {
  key: ColKey;
  ar: string;
  en: string;
  align: "start" | "end";
  hidden?: string; // responsive hiding classes
  val: (r: CompanyRow) => number | string | null;
  cell: (r: CompanyRow, lang: Lang) => React.ReactNode;
};

const COLUMNS: ColDef[] = [
  {
    key: "ticker",
    ar: "الرمز",
    en: "Ticker",
    align: "start",
    val: (r) => r.ticker,
    cell: (r) => <span className="num font-bold">{r.ticker}</span>,
  },
  {
    key: "close",
    ar: "الإغلاق",
    en: "Close",
    align: "end",
    val: (r) => r.close,
    cell: (r) => <span className="num font-medium">{fmtNum(r.close)}</span>,
  },
  {
    key: "changePct",
    ar: "%",
    en: "%",
    align: "end",
    val: (r) => r.changePct,
    cell: (r) => <ChangeCell pct={r.changePct} />,
  },
  {
    key: "marketCap",
    ar: "القيمة السوقية",
    en: "Market cap",
    align: "end",
    val: (r) => r.marketCap,
    cell: (r) => <span className="num text-muted-foreground">{fmtValue(r.marketCap)}</span>,
  },
  {
    key: "pe",
    ar: "م/ر",
    en: "P/E",
    align: "end",
    hidden: "hidden sm:table-cell",
    val: (r) => r.pe,
    cell: (r) => <span className="num text-muted-foreground">{r.pe !== null ? fmtNum(r.pe, 1) : "—"}</span>,
  },
  {
    key: "pb",
    ar: "م/د",
    en: "P/B",
    align: "end",
    hidden: "hidden md:table-cell",
    val: (r) => r.pb ?? null,
    cell: (r) => <span className="num text-muted-foreground">{r.pb != null ? fmtNum(r.pb, 2) : "—"}</span>,
  },
  {
    key: "divYield",
    ar: "توزيعات",
    en: "Yield",
    align: "end",
    hidden: "hidden md:table-cell",
    val: (r) => r.divYield,
    cell: (r) => (
      <span className="num text-muted-foreground">{r.divYield !== null ? `${fmtNum(r.divYield, 1)}%` : "—"}</span>
    ),
  },
  {
    key: "roe",
    ar: "عائد",
    en: "ROE",
    align: "end",
    hidden: "hidden lg:table-cell",
    val: (r) => r.roe ?? null,
    cell: (r) => (
      <span className={`num ${directionClass(r.roe)}`}>{r.roe != null ? `${fmtNum(r.roe, 1)}%` : "—"}</span>
    ),
  },
  {
    key: "perfYTD",
    ar: "من بداية العام",
    en: "YTD",
    align: "end",
    hidden: "hidden lg:table-cell",
    val: (r) => r.perfYTD,
    cell: (r) => <span className={`num ${directionClass(r.perfYTD)}`}>{fmtPct(r.perfYTD)}</span>,
  },
  {
    key: "volume",
    ar: "الحجم",
    en: "Volume",
    align: "end",
    hidden: "hidden xl:table-cell",
    val: (r) => r.volume,
    cell: (r) => <span className="num text-muted-foreground">{fmtInt(r.volume)}</span>,
  },
  {
    key: "valueTraded",
    ar: "القيمة",
    en: "Value",
    align: "end",
    hidden: "hidden xl:table-cell",
    val: (r) => r.valueTraded,
    cell: (r) => <span className="num text-muted-foreground">{fmtValue(r.valueTraded)}</span>,
  },
];

// ── helpers ──

function parseNum(s: string): number | null {
  if (s === "") return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** bound passes only when the metric exists and is inside [min,max] */
function passesBound(v: number | null, b: Bound): boolean {
  const min = parseNum(b.min);
  const max = parseNum(b.max);
  if (min === null && max === null) return true;
  if (v === null || v === undefined || !Number.isFinite(v)) return false;
  if (min !== null && v < min) return false;
  if (max !== null && v > max) return false;
  return true;
}

function passesMin(v: number | null, s: string, scale = 1): boolean {
  const min = parseNum(s);
  if (min === null) return true;
  if (v === null || v === undefined || !Number.isFinite(v)) return false;
  return v >= min * scale;
}

function rangePos(r: CompanyRow): number | null {
  if (r.high52 === null || r.low52 === null || r.close == null) return null;
  const span = r.high52 - r.low52;
  if (!(span > 0)) return null;
  return (r.close - r.low52) / span;
}

function boundChipLabel(label: string, b: Bound): string {
  if (b.min && b.max) return `${label}: ${b.min}–${b.max}`;
  if (b.min) return `${label} ≥ ${b.min}`;
  return `${label} ≤ ${b.max}`;
}

// ── small UI pieces ──

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 min-w-0">
      <p className="text-[11px] font-medium text-muted-foreground leading-tight">{label}</p>
      {children}
    </div>
  );
}

function BoundInput({ value, onChange, lang }: { value: Bound; onChange: (b: Bound) => void; lang: Lang }) {
  return (
    <div className="flex items-center gap-1">
      <Input
        dir="ltr"
        inputMode="decimal"
        aria-label={tt(T.minPlaceholder, lang)}
        placeholder={tt(T.minPlaceholder, lang)}
        value={value.min}
        onChange={(e) => onChange({ ...value, min: e.target.value })}
        className="h-8 text-xs num w-full min-w-0"
      />
      <span className="text-[10px] text-muted-foreground shrink-0">–</span>
      <Input
        dir="ltr"
        inputMode="decimal"
        aria-label={tt(T.maxPlaceholder, lang)}
        placeholder={tt(T.maxPlaceholder, lang)}
        value={value.max}
        onChange={(e) => onChange({ ...value, max: e.target.value })}
        className="h-8 text-xs num w-full min-w-0"
      />
    </div>
  );
}

function MinInput({ value, onChange, lang }: { value: string; onChange: (v: string) => void; lang: Lang }) {
  return (
    <Input
      dir="ltr"
      inputMode="decimal"
      aria-label={tt(T.minPlaceholder, lang)}
      placeholder={tt(T.minPlaceholder, lang)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 text-xs num w-full min-w-0"
    />
  );
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-foreground/80">{children}</p>;
}

// ── main view ──

export function ScreenerView() {
  const { lang, navigate } = useApp();
  const { data } = useLiveData<{ session: SessionMeta; total: number; rows: CompanyRow[] }>("/api/companies");
  const [f, setF] = useState<Filters>(DEFAULT_FILTERS);
  const [panelOpen, setPanelOpen] = useState(true);
  const [sortKey, setSortKey] = useState<ColKey>("marketCap");
  const [desc, setDesc] = useState(true);

  const rows = data?.rows ?? null;
  const total = data?.total ?? rows?.length ?? 0;

  const sectors = useMemo(() => {
    if (!rows) return [];
    const seen = new Map<string, string>();
    rows.forEach((r) => seen.set(r.sectorCode, lang === "ar" ? r.sectorAr : r.sectorEn));
    return Array.from(seen.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name, lang === "ar" ? "ar" : "en"));
  }, [rows, lang]);

  const applyPatch = (patch: Partial<Filters>) => setF((prev) => ({ ...prev, ...patch }));

  const filtered = useMemo(() => {
    if (!rows) return null;
    const needle = f.q.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (needle) {
        const hay = `${r.ticker} ${r.name} ${r.sectorEn} ${r.sectorAr}`.toLowerCase();
        if (!hay.includes(needle) && !rowMatchesArabic(r.ticker, f.q.trim())) return false;
      }
      if (f.sector && r.sectorCode !== f.sector) return false;
      if (!passesBound(r.close, f.price)) return false;
      if (!passesBound(r.changePct, f.change)) return false;
      if (!passesBound(r[f.perfPeriod], f.perf)) return false;
      if (!passesBound(r.marketCap != null ? r.marketCap / 1e6 : null, f.cap)) return false;
      if (!passesBound(r.pe, f.pe)) return false;
      if (!passesBound(r.pb ?? null, f.pb)) return false;
      if (!passesBound(r.divYield, f.yield)) return false;
      if (!passesBound(r.roe ?? null, f.roe)) return false;
      if (!passesBound(r.debtToEquity ?? null, f.de)) return false;
      if (!passesBound(r.eps, f.eps)) return false;
      if (!passesMin(r.volume, f.volumeMin)) return false;
      if (!passesMin(r.valueTraded != null ? r.valueTraded / 1e6 : null, f.valueMin)) return false;
      if (!passesMin(r.volumeRatio, f.volRatioMin)) return false;
      if (f.range52) {
        const pos = rangePos(r);
        if (pos === null) return false;
        if (f.range52 === "high" && pos < 0.95) return false;
        if (f.range52 === "low" && pos > 0.1) return false;
      }
      return true;
    });
    // sort: rows missing the sort metric sink to the bottom either direction
    const col = COLUMNS.find((c) => c.key === sortKey)!;
    const withVal = out.filter((r) => col.val(r) !== null && col.val(r) !== undefined);
    const without = out.filter((r) => col.val(r) === null || col.val(r) === undefined);
    const sorted = [...withVal].sort((a, b) => {
      const va = col.val(a);
      const vb = col.val(b);
      let cmp: number;
      if (typeof va === "string" || typeof vb === "string") {
        cmp = String(va).localeCompare(String(vb));
      } else {
        cmp = (va as number) - (vb as number);
      }
      return desc ? -cmp : cmp;
    });
    return [...sorted, ...without];
  }, [rows, f, sortKey, desc]);

  // active-filter chips
  const chips: { id: string; label: string; clear: () => void }[] = [];
  if (f.q.trim()) chips.push({ id: "q", label: `"${f.q.trim()}"`, clear: () => applyPatch({ q: "" }) });
  if (f.sector) {
    const s = sectors.find((x) => x.code === f.sector);
    if (s) chips.push({ id: "sector", label: s.name, clear: () => applyPatch({ sector: "" }) });
  }
  const boundDefs: [keyof Filters, string][] = [
    ["price", tt(T.filterPrice, lang)],
    ["change", tt(T.filterChange, lang)],
    ["pe", tt(T.filterPe, lang)],
    ["pb", tt(T.filterPb, lang)],
    ["yield", tt(T.filterYield, lang)],
    ["roe", tt(T.filterRoe, lang)],
    ["de", tt(T.filterDe, lang)],
    ["eps", tt(T.filterEps, lang)],
    ["cap", tt(T.filterCap, lang)],
  ];
  boundDefs.forEach(([key, label]) => {
    const b = f[key] as Bound;
    if (b.min || b.max) {
      chips.push({
        id: `b-${key}`,
        label: boundChipLabel(label, b),
        clear: () => applyPatch({ [key]: EMPTY_BOUND } as Partial<Filters>),
      });
    }
  });
  if (f.perf.min || f.perf.max) {
    const periodLabel = tt(PERF_OPTIONS.find(([p]) => p === f.perfPeriod)![1], lang);
    chips.push({
      id: "perf",
      label: boundChipLabel(`${tt(T.filterPerf, lang)} (${periodLabel})`, f.perf),
      clear: () => applyPatch({ perf: EMPTY_BOUND }),
    });
  }
  if (f.volumeMin) chips.push({ id: "vol", label: `${tt(T.filterVolume, lang)} ≥ ${f.volumeMin}`, clear: () => applyPatch({ volumeMin: "" }) });
  if (f.valueMin) chips.push({ id: "val", label: `${tt(T.filterValue, lang)} ≥ ${f.valueMin}`, clear: () => applyPatch({ valueMin: "" }) });
  if (f.volRatioMin) chips.push({ id: "vr", label: `${tt(T.filterVolRatio, lang)} ≥ ${f.volRatioMin}`, clear: () => applyPatch({ volRatioMin: "" }) });
  if (f.range52) {
    chips.push({
      id: "r52",
      label: f.range52 === "high" ? tt(T.nearHigh, lang) : tt(T.nearLow, lang),
      clear: () => applyPatch({ range52: "" }),
    });
  }

  const matchCount = filtered?.length ?? 0;
  const headerSort = (c: ColDef) => {
    if (sortKey === c.key) setDesc(!desc);
    else {
      setSortKey(c.key);
      setDesc(true);
    }
  };

  return (
    <div className="space-y-4">
      {/* title */}
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{tt(T.screenerTitle, lang)}</h1>
        {filtered && (
          <p className="num text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{matchCount}</span> {tt(T.screenerMatch, lang)}{" "}
            {total} · {data?.session.lastSession} · {tt(T.delayed, lang)}
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground -mt-2">{tt(T.screenerNote, lang)}</p>

      {/* presets */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground me-1">
          <Zap className="h-3 w-3" />
        </span>
        {PRESETS.map((p) => {
          const active =
            ("change" in p.patch &&
              p.patch.change?.min === f.change.min &&
              p.patch.change?.max === f.change.max) ||
            ("yield" in p.patch && p.patch.yield?.min === f.yield.min) ||
            ("pe" in p.patch && p.patch.pe?.max === f.pe.max) ||
            ("volRatioMin" in p.patch && p.patch.volRatioMin === f.volRatioMin) ||
            ("cap" in p.patch && p.patch.cap?.min === f.cap.min);
          return (
            <button
              key={p.key}
              onClick={() =>
                active
                  ? setF(DEFAULT_FILTERS)
                  : applyPatch(p.patch)
              }
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                active
                  ? "bg-secondary font-semibold border-ring"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              {tt(p.t, lang)}
            </button>
          );
        })}
      </div>

      {/* filter panel */}
      <div className="rounded-lg border bg-card">
        <button
          onClick={() => setPanelOpen(!panelOpen)}
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-sm"
          aria-expanded={panelOpen}
        >
          <span className="flex items-center gap-2 font-medium">
            <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            {tt(T.screenerFilters, lang)}
            {chips.length > 0 && (
              <span className="num rounded-full bg-secondary px-1.5 text-[10px] font-semibold">{chips.length}</span>
            )}
          </span>
          <span className="flex items-center gap-2">
            {chips.length > 0 && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  setF(DEFAULT_FILTERS);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    setF(DEFAULT_FILTERS);
                  }
                }}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
                {tt(T.screenerClearAll, lang)}
              </span>
            )}
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${panelOpen ? "" : "-rotate-90"}`} />
          </span>
        </button>

        {panelOpen && (
          <div className="space-y-4 border-t px-3 py-3">
            {/* basics */}
            <section className="space-y-2">
              <GroupTitle>{tt(T.grpBasic, lang)}</GroupTitle>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <FilterField label={tt(T.searchCompany, lang)}>
                  <div className="relative">
                    <Search className="absolute start-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={f.q}
                      onChange={(e) => applyPatch({ q: e.target.value })}
                      placeholder={lang === "ar" ? "الرمز أو الاسم…" : "Ticker or name…"}
                      className="ps-8 h-8 text-xs"
                    />
                  </div>
                </FilterField>
                <FilterField label={tt(T.allSectors, lang)}>
                  <select
                    value={f.sector}
                    onChange={(e) => applyPatch({ sector: e.target.value })}
                    className="h-8 w-full rounded-md border bg-card px-2 text-xs text-foreground"
                    aria-label={tt(T.allSectors, lang)}
                  >
                    <option value="">{tt(T.allSectors, lang)}</option>
                    {sectors.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </FilterField>
              </div>
            </section>

            {/* price & performance */}
            <section className="space-y-2">
              <GroupTitle>{tt(T.grpPrice, lang)}</GroupTitle>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <FilterField label={tt(T.filterPrice, lang)}>
                  <BoundInput value={f.price} onChange={(b) => applyPatch({ price: b })} lang={lang} />
                </FilterField>
                <FilterField label={tt(T.filterChange, lang)}>
                  <BoundInput value={f.change} onChange={(b) => applyPatch({ change: b })} lang={lang} />
                </FilterField>
                <FilterField label={`${tt(T.filterPerf, lang)} · ${tt(T.grpPrice, lang)}`}>
                  <div className="flex items-center gap-1">
                    <select
                      value={f.perfPeriod}
                      onChange={(e) => applyPatch({ perfPeriod: e.target.value as PerfPeriod })}
                      className="h-8 rounded-md border bg-card px-1.5 text-xs shrink-0"
                      aria-label={tt(T.filterPerf, lang)}
                    >
                      {PERF_OPTIONS.map(([p, label]) => (
                        <option key={p} value={p}>
                          {tt(label, lang)}
                        </option>
                      ))}
                    </select>
                    <BoundInput value={f.perf} onChange={(b) => applyPatch({ perf: b })} lang={lang} />
                  </div>
                </FilterField>
              </div>
            </section>

            {/* valuation & profitability */}
            <section className="space-y-2">
              <GroupTitle>{tt(T.grpValuation, lang)}</GroupTitle>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <FilterField label={tt(T.filterPe, lang)}>
                  <BoundInput value={f.pe} onChange={(b) => applyPatch({ pe: b })} lang={lang} />
                </FilterField>
                <FilterField label={tt(T.filterPb, lang)}>
                  <BoundInput value={f.pb} onChange={(b) => applyPatch({ pb: b })} lang={lang} />
                </FilterField>
                <FilterField label={tt(T.filterYield, lang)}>
                  <BoundInput value={f.yield} onChange={(b) => applyPatch({ yield: b })} lang={lang} />
                </FilterField>
                <FilterField label={tt(T.filterRoe, lang)}>
                  <BoundInput value={f.roe} onChange={(b) => applyPatch({ roe: b })} lang={lang} />
                </FilterField>
                <FilterField label={tt(T.filterDe, lang)}>
                  <BoundInput value={f.de} onChange={(b) => applyPatch({ de: b })} lang={lang} />
                </FilterField>
                <FilterField label={tt(T.filterEps, lang)}>
                  <BoundInput value={f.eps} onChange={(b) => applyPatch({ eps: b })} lang={lang} />
                </FilterField>
                <FilterField label={tt(T.filterCap, lang)}>
                  <BoundInput value={f.cap} onChange={(b) => applyPatch({ cap: b })} lang={lang} />
                </FilterField>
              </div>
            </section>

            {/* activity + 52w */}
            <section className="space-y-2">
              <GroupTitle>{tt(T.grpActivity, lang)}</GroupTitle>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <FilterField label={tt(T.filterVolume, lang)}>
                  <MinInput value={f.volumeMin} onChange={(v) => applyPatch({ volumeMin: v })} lang={lang} />
                </FilterField>
                <FilterField label={tt(T.filterValue, lang)}>
                  <MinInput value={f.valueMin} onChange={(v) => applyPatch({ valueMin: v })} lang={lang} />
                </FilterField>
                <FilterField label={tt(T.filterVolRatio, lang)}>
                  <MinInput value={f.volRatioMin} onChange={(v) => applyPatch({ volRatioMin: v })} lang={lang} />
                </FilterField>
                <FilterField label={tt(T.filter52, lang)}>
                  <div className="flex items-center gap-1">
                    {(
                      [
                        ["", T.any52],
                        ["high", T.nearHigh],
                        ["low", T.nearLow],
                      ] as const
                    ).map(([v, label]) => (
                      <button
                        key={v}
                        onClick={() => applyPatch({ range52: v })}
                        className={`h-8 flex-1 rounded-md border px-1.5 text-[11px] leading-tight transition-colors ${
                          f.range52 === v
                            ? "bg-secondary font-semibold border-ring"
                            : "text-muted-foreground hover:bg-accent/50"
                        }`}
                      >
                        {tt(label, lang)}
                      </button>
                    ))}
                  </div>
                </FilterField>
              </div>
            </section>

            <p className="text-[10px] text-muted-foreground leading-relaxed">
              {tt(T.screenerExcludeNote, lang)} · {tt(T.screenerSortHint, lang)}
            </p>
          </div>
        )}
      </div>

      {/* active chips */}
      {chips.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {chips.map((c) => (
            <button
              key={c.id}
              onClick={c.clear}
              className="inline-flex items-center gap-1 rounded-full border bg-secondary/60 px-2 py-0.5 text-[11px] hover:bg-accent transition-colors"
              title={lang === "ar" ? "اضغط للإزالة" : "Click to remove"}
            >
              {c.label}
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      {/* results */}
      {!filtered ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="max-h-[70vh] overflow-auto thin-scroll">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="sticky top-0 bg-card z-10 border-b">
                <tr className="text-[11px] text-muted-foreground">
                  <th className="w-10" aria-label="watch" />
                  <th className="text-start font-medium px-3 py-2.5">
                    <button onClick={() => headerSort(COLUMNS[0])} className="hover:text-foreground">
                      {tt(T.colTicker, lang)}
                      {sortKey === "ticker" && <span className="num"> {desc ? "↓" : "↑"}</span>}
                    </button>
                  </th>
                  <th className="text-start font-medium px-3 py-2.5 hidden md:table-cell">{tt(T.colName, lang)}</th>
                  <th className="text-start font-medium px-3 py-2.5 hidden lg:table-cell">{tt(T.colSector, lang)}</th>
                  {COLUMNS.slice(1).map((c) => (
                    <th
                      key={c.key}
                      className={`text-end font-medium px-3 py-2.5 whitespace-nowrap ${c.hidden ?? ""}`}
                    >
                      <button onClick={() => headerSort(c)} className="hover:text-foreground num">
                        {lang === "ar" ? c.ar : c.en}
                        {sortKey === c.key && <span> {desc ? "↓" : "↑"}</span>}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r) => (
                  <tr
                    key={r.ticker}
                    className="hover:bg-accent/30 cursor-pointer transition-colors"
                    onClick={() => navigate("company", { ticker: r.ticker, panel: "overview" })}
                  >
                    <td className="ps-1">
                      <WatchStar ticker={r.ticker} />
                    </td>
                    <td className="num px-3 py-2.5 font-bold">{r.ticker}</td>
                    <td className="px-3 py-2.5 hidden md:table-cell max-w-[240px] truncate text-muted-foreground">
                      {r.name}
                    </td>
                    <td className="px-3 py-2.5 hidden lg:table-cell text-xs text-muted-foreground max-w-[150px] truncate">
                      {lang === "ar" ? r.sectorAr : r.sectorEn}
                    </td>
                    {COLUMNS.slice(1).map((c) => (
                      <td key={c.key} className={`px-3 py-2.5 text-end ${c.hidden ?? ""}`}>
                        {c.cell(r, lang)}
                      </td>
                    ))}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={14} className="px-3 py-10 text-center text-muted-foreground text-sm">
                      {tt(T.screenerNoResults, lang)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
