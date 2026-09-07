"use client";

import { useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { useLiveData } from "../market/use-live-data";
import type { CompanyRow, SessionMeta } from "../market/types";
import { T, tt, dn, type Lang } from "@/lib/i18n";
import { fmtNum, fmtValue, fmtPct, fmtInt, directionClass } from "@/lib/format";
import { WatchStar } from "../market/watch-star";
import { ChangeCell } from "../market/change-cell";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, X, Plus, ChevronDown, Zap, Trash2 } from "lucide-react";
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

// ── Investing.com Pro-style filter registry ──

type FilterKind = "bound" | "perf" | "min" | "range52";
type FilterKey =
  | "price" | "change" | "perf" | "cap" | "pe" | "pb" | "yield" | "roe" | "de" | "eps"
  | "volumeMin" | "valueMin" | "volRatioMin" | "range52";
type BoundKey = "price" | "change" | "cap" | "pe" | "pb" | "yield" | "roe" | "de" | "eps";
type MinKey = "volumeMin" | "valueMin" | "volRatioMin";

/** Presets also activate the pill(s) they write to. */
const PRESET_PILLS: Record<string, FilterKey[]> = {
  gainers: ["change"],
  losers: ["change"],
  payers: ["yield"],
  lowPe: ["pe"],
  unusual: ["volRatioMin"],
  largeCaps: ["cap"],
};

type FilterDef = {
  key: FilterKey;
  t: { ar: string; en: string };
  group: "price" | "valuation" | "activity" | "range";
  kind: FilterKind;
};

const FILTER_DEFS: FilterDef[] = [
  { key: "price", t: T.filterPrice, group: "price", kind: "bound" },
  { key: "change", t: T.filterChange, group: "price", kind: "bound" },
  { key: "perf", t: T.filterPerf, group: "price", kind: "perf" },
  { key: "cap", t: T.filterCap, group: "valuation", kind: "bound" },
  { key: "pe", t: T.filterPe, group: "valuation", kind: "bound" },
  { key: "pb", t: T.filterPb, group: "valuation", kind: "bound" },
  { key: "yield", t: T.filterYield, group: "valuation", kind: "bound" },
  { key: "roe", t: T.filterRoe, group: "valuation", kind: "bound" },
  { key: "de", t: T.filterDe, group: "valuation", kind: "bound" },
  { key: "eps", t: T.filterEps, group: "valuation", kind: "bound" },
  { key: "volumeMin", t: T.filterVolume, group: "activity", kind: "min" },
  { key: "valueMin", t: T.filterValue, group: "activity", kind: "min" },
  { key: "volRatioMin", t: T.filterVolRatio, group: "activity", kind: "min" },
  { key: "range52", t: T.filter52, group: "range", kind: "range52" },
];

const GROUP_LABELS: Record<FilterDef["group"], { ar: string; en: string }> = {
  price: T.grpPrice,
  valuation: T.grpValuation,
  activity: T.grpActivity,
  range: { ar: "مدى ٥٢ أسبوعاً", en: "52-week range" },
};

/** Pills shown by default when the screener opens — the quick pro workflow. */
const DEFAULT_ACTIVE: FilterKey[] = ["price", "change", "perf", "pe", "cap"];

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

/** One active filter as a pill: click opens a popover to edit its values,
 *  the × removes it. Mirrors Investing.com Pro's filter-chip interaction. */
function FilterPill({
  label,
  hasValue,
  open,
  onOpenChange,
  onRemove,
  removeLabel,
  editLabel,
  children,
}: {
  label: string;
  hasValue: boolean;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onRemove: () => void;
  removeLabel: string;
  editLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-full border ps-2.5 ${
        hasValue ? "bg-secondary font-semibold border-ring" : "bg-secondary/40 border-transparent"
      }`}
    >
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            className="max-w-[13rem] truncate px-1.5 py-1 text-[11px] transition-colors hover:text-primary text-start"
            title={editLabel}
          >
            <span className="num">{label}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-60 p-3 space-y-2" align="start">
          {children}
        </PopoverContent>
      </Popover>
      <button
        onClick={onRemove}
        aria-label={removeLabel}
        title={removeLabel}
        className="rounded-e-full p-1 text-muted-foreground transition-colors hover:text-down"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ── main view ──

export function ScreenerView() {
  const { lang, navigate } = useApp();
  const { data } = useLiveData<{ session: SessionMeta; total: number; rows: CompanyRow[] }>("/api/companies");
  const [f, setF] = useState<Filters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<ColKey>("marketCap");
  const [desc, setDesc] = useState(true);
  // pro filter UX: which filters currently have pills + which pill's popover is open
  const [active, setActive] = useState<FilterKey[]>(DEFAULT_ACTIVE);
  const [openPill, setOpenPill] = useState<FilterKey | null>(null);

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

  /** Add a filter pill (and open its value editor). */
  const addFilter = (key: FilterKey) => {
    setActive((a) => (a.includes(key) ? a : [...a, key]));
    setOpenPill(key);
  };

  /** Remove a filter pill and clear its stored values. */
  const removeFilter = (key: FilterKey) => {
    setActive((a) => a.filter((k) => k !== key));
    if (openPill === key) setOpenPill(null);
    const patch: Partial<Filters> = {};
    if (key === "volumeMin" || key === "valueMin" || key === "volRatioMin") patch[key] = "";
    else if (key === "range52") patch.range52 = "";
    else if (key === "perf") patch.perf = EMPTY_BOUND;
    else patch[key] = EMPTY_BOUND;
    applyPatch(patch);
  };

  const filtered = useMemo(() => {
    if (!rows) return null;
    const needle = f.q.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (needle) {
        const hay = `${r.ticker} ${r.name} ${r.nameAr ?? ""} ${r.sectorEn} ${r.sectorAr}`.toLowerCase();
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

  // ── pro filter pills: label + has-value per active filter ──

  /** Pill label summarises the active values (name only until values are set). */
  const pillLabel = (key: FilterKey): { label: string; hasValue: boolean } => {
    const def = FILTER_DEFS.find((d) => d.key === key)!;
    const name = tt(def.t, lang);
    if (def.kind === "perf") {
      const periodLabel = tt(PERF_OPTIONS.find(([p]) => p === f.perfPeriod)![1], lang);
      const has = !!(f.perf.min || f.perf.max);
      return { label: has ? boundChipLabel(`${name} (${periodLabel})`, f.perf) : `${name} (${periodLabel})`, hasValue: has };
    }
    if (def.kind === "min") {
      const v = f[key as MinKey];
      return { label: v ? `${name} ≥ ${v}` : name, hasValue: !!v };
    }
    if (def.kind === "range52") {
      const has = !!f.range52;
      return { label: has ? tt(f.range52 === "high" ? T.nearHigh : T.nearLow, lang) : name, hasValue: has };
    }
    const b = f[key as BoundKey] as Bound;
    const has = !!(b.min || b.max);
    return { label: has ? boundChipLabel(name, b) : name, hasValue: has };
  };

  /** How many filters actually constrain the results (for clear-all affordance). */
  const valueCount =
    (f.q.trim() ? 1 : 0) +
    (f.sector ? 1 : 0) +
    FILTER_DEFS.filter((d) => {
      if (d.kind === "perf") return !!(f.perf.min || f.perf.max);
      if (d.kind === "min") return !!f[d.key as MinKey];
      if (d.kind === "range52") return !!f.range52;
      const b = f[d.key as BoundKey] as Bound;
      return !!(b.min || b.max);
    }).length;

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

      {/* pro search row: text search + sector + presets + clear all */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[13rem]">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={f.q}
            onChange={(e) => applyPatch({ q: e.target.value })}
            placeholder={lang === "ar" ? "ابحث بالرمز أو الاسم — بالعربية أو الإنجليزية…" : "Search by ticker or name — Arabic or English…"}
            className="ps-9 h-9 text-sm"
            aria-label={tt(T.searchCompany, lang)}
          />
        </div>
        <select
          value={f.sector}
          onChange={(e) => applyPatch({ sector: e.target.value })}
          className="h-9 rounded-md border bg-card px-2 text-xs text-foreground max-w-[13rem]"
          aria-label={tt(T.allSectors, lang)}
        >
          <option value="">{tt(T.allSectors, lang)}</option>
          {sectors.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs whitespace-nowrap">
              <Zap className="h-3.5 w-3.5 text-primary" />
              {tt(T.presetLabel, lang)}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {PRESETS.map((p) => {
              const isActive =
                ("change" in p.patch &&
                  p.patch.change?.min === f.change.min &&
                  p.patch.change?.max === f.change.max) ||
                ("yield" in p.patch && p.patch.yield?.min === f.yield.min) ||
                ("pe" in p.patch && p.patch.pe?.max === f.pe.max) ||
                ("volRatioMin" in p.patch && p.patch.volRatioMin === f.volRatioMin) ||
                ("cap" in p.patch && p.patch.cap?.min === f.cap.min);
              return (
                <DropdownMenuItem
                  key={p.key}
                  className="text-xs"
                  onClick={() => {
                    if (isActive) {
                      setF(DEFAULT_FILTERS);
                      setActive(DEFAULT_ACTIVE);
                    } else {
                      applyPatch(p.patch);
                      setActive((a) => [...new Set([...a, ...(PRESET_PILLS[p.key] ?? [])])]);
                      setOpenPill(null);
                    }
                  }}
                >
                  <span className="flex-1">{tt(p.t, lang)}</span>
                  {isActive && <span className="num text-[10px] text-muted-foreground">✓</span>}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        {(valueCount > 0 || active.length !== DEFAULT_ACTIVE.length) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1 text-xs text-muted-foreground whitespace-nowrap"
            onClick={() => {
              setF(DEFAULT_FILTERS);
              setActive(DEFAULT_ACTIVE);
              setOpenPill(null);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {tt(T.screenerClearAll, lang)}
          </Button>
        )}
      </div>

      {/* pro filter bar: add-filter dropdown + editable filter pills */}
      <div className="rounded-lg border bg-card p-2.5 flex items-center gap-1.5 flex-wrap">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-7 gap-1 rounded-full px-2.5 text-[11px]">
              <Plus className="h-3 w-3" />
              {tt(T.addFilter, lang)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 max-h-80 overflow-y-auto thin-scroll">
            {(["price", "valuation", "activity", "range"] as const).map((group) => (
              <DropdownMenuGroup key={group}>
                <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                  {tt(GROUP_LABELS[group], lang)}
                </DropdownMenuLabel>
                {FILTER_DEFS.filter((d) => d.group === group).map((d) => (
                  <DropdownMenuCheckboxItem
                    key={d.key}
                    checked={active.includes(d.key)}
                    onCheckedChange={(v) => (v ? addFilter(d.key) : removeFilter(d.key))}
                    className="text-xs"
                    onSelect={(e) => e.preventDefault()}
                  >
                    {tt(d.t, lang)}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
              </DropdownMenuGroup>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {active.length === 0 && valueCount === 0 && (
          <span className="text-[11px] text-muted-foreground">{tt(T.noActiveFilters, lang)}</span>
        )}

        {active.map((key) => {
          const def = FILTER_DEFS.find((d) => d.key === key)!;
          const { label, hasValue } = pillLabel(key);
          return (
            <FilterPill
              key={key}
              label={label}
              hasValue={hasValue}
              open={openPill === key}
              onOpenChange={(v) => setOpenPill(v ? key : null)}
              onRemove={() => removeFilter(key)}
              removeLabel={tt(T.removeFilter, lang)}
              editLabel={tt(T.editFilterHint, lang)}
            >
              <p className="text-[11px] font-semibold text-foreground/80">{tt(def.t, lang)}</p>
              {def.kind === "perf" && (
                <>
                  <select
                    value={f.perfPeriod}
                    onChange={(e) => applyPatch({ perfPeriod: e.target.value as PerfPeriod })}
                    className="h-8 w-full rounded-md border bg-card px-2 text-xs"
                    aria-label={tt(T.filterPerf, lang)}
                  >
                    {PERF_OPTIONS.map(([p, l]) => (
                      <option key={p} value={p}>
                        {tt(l, lang)}
                      </option>
                    ))}
                  </select>
                  <BoundInput value={f.perf} onChange={(b) => applyPatch({ perf: b })} lang={lang} />
                </>
              )}
              {def.kind === "min" && (
                <MinInput
                  value={f[key as MinKey]}
                  onChange={(v) => applyPatch({ [key]: v } as Partial<Filters>)}
                  lang={lang}
                />
              )}
              {def.kind === "range52" && (
                <div className="flex items-center gap-1">
                  {(
                    [
                      ["", T.any52],
                      ["high", T.nearHigh],
                      ["low", T.nearLow],
                    ] as const
                  ).map(([v, t]) => (
                    <button
                      key={v}
                      onClick={() => applyPatch({ range52: v })}
                      className={`h-8 flex-1 rounded-md border px-1.5 text-[11px] leading-tight transition-colors ${
                        f.range52 === v
                          ? "bg-secondary font-semibold border-ring"
                          : "text-muted-foreground hover:bg-accent/50"
                      }`}
                    >
                      {tt(t, lang)}
                    </button>
                  ))}
                </div>
              )}
              {def.kind === "bound" && (
                <BoundInput
                  value={f[key as BoundKey]}
                  onChange={(b) => applyPatch({ [key]: b } as Partial<Filters>)}
                  lang={lang}
                />
              )}
            </FilterPill>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        {tt(T.screenerExcludeNote, lang)} · {tt(T.screenerSortHint, lang)}
      </p>

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
                      {dn(r, lang)}
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
