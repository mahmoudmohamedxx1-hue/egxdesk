"use client";

import { useEffect, useRef, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  Cell,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { useApp } from "./app-context";
import { T, tt } from "@/lib/i18n";
import { fmtNum, fmtPct, fmtInt, fmtValue, directionClass } from "@/lib/format";
import {
  smaSeries,
  emaFull,
  emaSparse,
  bollingerSeries,
  rsiSeries,
  macdSeries,
  stochasticSeries,
  vwapSeries,
  psarSeries,
  ichimokuSeries,
  donchianSeries,
  keltnerSeries,
  superTrendSeries,
  obvSeries,
  mfiSeries,
  atrSeries,
  adxSeries,
  cciSeries,
  williamsRSeries,
} from "@/lib/indicators";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Settings2, TrendingUp, Minus, ListPlus, X } from "lucide-react";

/** Real price chart for one stock or index, with range switching and
 *  client-computed technical indicators (SMA/EMA/Bollinger overlays,
 *  RSI, MACD and Stochastic panels, volume MA, plus the T26 advanced set:
 *  Ichimoku cloud with forward projection, VWAP and Parabolic SAR).
 *  Data comes from /api/chart (Yahoo daily/weekly candles for stocks,
 *  self-collected intraday ticks for 1D/1W, persisted EGX session closes
 *  for indices).
 *  G8: log-scale toggle + rebased index comparison overlay. G19: persistent
 *  click-to-draw trendlines. Chart canvas is LTR; labels are bilingual.
 *  Remount per symbol. */

type ChartPoint = { date: string; close: number; volume: number | null; high?: number | null; low?: number | null };

type ChartResponse = {
  symbol: string;
  kind: "stock" | "index";
  range: string;
  currency: string;
  points: ChartPoint[];
  first: number | null;
  last: number | null;
  high: number | null;
  low: number | null;
  changePct: number | null;
  asOf: string | null;
  source: string;
  warming?: boolean;
  availableRanges: string[];
  error?: string;
  /** T27 — milestone reconstruction (no free daily history for the name). */
  milestones?: boolean;
  refHigh?: number | null;
  refLow?: number | null;
};

const RANGE_LABELS: Record<string, { ar: string; en: string }> = {
  "1D": { ar: "اليوم", en: "1D" },
  "1W": { ar: "أسبوع", en: "1W" },
  "1M": { ar: "شهر", en: "1M" },
  "3M": { ar: "٣ أشهر", en: "3M" },
  "6M": { ar: "٦ أشهر", en: "6M" },
  "1Y": { ar: "سنة", en: "1Y" },
  "5Y": { ar: "٥ سنوات", en: "5Y" },
  ALL: { ar: "الكل", en: "All" },
};

// ── indicator math lives in @/lib/indicators (shared with the technical
//    analysis panel) — imported above. ──

// ── indicator toggle config ──

type IndKey =
  | "sma20" | "sma50" | "ema20" | "bb" | "ichimoku" | "vwap" | "psar" | "volma"
  | "donchian" | "keltner" | "supertrend" | "fib"
  | "rsi" | "macd" | "stoch" | "obv" | "mfi" | "atr" | "adx" | "wpr" | "cci";

const INDICATORS: { key: IndKey; t: { ar: string; en: string }; color: string; kind: "overlay" | "sub" }[] = [
  { key: "sma20", t: T.indSma20, color: "var(--c1)", kind: "overlay" },
  { key: "sma50", t: T.indSma50, color: "var(--c2)", kind: "overlay" },
  { key: "ema20", t: T.indEma20, color: "var(--c5)", kind: "overlay" },
  { key: "bb", t: T.indBb, color: "var(--c4)", kind: "overlay" },
  { key: "ichimoku", t: T.indIchimoku, color: "var(--c8)", kind: "overlay" },
  { key: "vwap", t: T.indVwap, color: "var(--c6)", kind: "overlay" },
  { key: "psar", t: T.indPsar, color: "var(--c5)", kind: "overlay" },
  { key: "donchian", t: { ar: "دونتشيان", en: "Donchian" }, color: "var(--c2)", kind: "overlay" },
  { key: "keltner", t: { ar: "كيلتنر", en: "Keltner" }, color: "var(--c6)", kind: "overlay" },
  { key: "supertrend", t: { ar: "سوبرترند", en: "SuperTrend" }, color: "var(--c8)", kind: "overlay" },
  { key: "fib", t: { ar: "فيبوناتشي", en: "Fibonacci" }, color: "var(--c4)", kind: "overlay" },
  { key: "rsi", t: T.indRsi, color: "var(--c7)", kind: "sub" },
  { key: "macd", t: T.indMacd, color: "var(--c3)", kind: "sub" },
  { key: "stoch", t: T.indStoch, color: "var(--c3)", kind: "sub" },
  { key: "obv", t: { ar: "أو بي في", en: "OBV" }, color: "var(--c1)", kind: "sub" },
  { key: "mfi", t: { ar: "إم إف آي", en: "MFI" }, color: "var(--c6)", kind: "sub" },
  { key: "atr", t: { ar: "إيه تي آر", en: "ATR" }, color: "var(--c5)", kind: "sub" },
  { key: "adx", t: { ar: "إيه دي إكس", en: "ADX" }, color: "var(--c3)", kind: "sub" },
  { key: "wpr", t: { ar: "وليامز ٪R", en: "Williams %R" }, color: "var(--c4)", kind: "sub" },
  { key: "cci", t: { ar: "سي سي آي", en: "CCI" }, color: "var(--c2)", kind: "sub" },
];

/** T27 — per-user indicator parameters (TradingView-style settings),
 *  persisted on the device. */
type IndSettings = {
  ma1N: number;
  ma2N: number;
  rsiN: number;
  macdF: number;
  macdS: number;
  macdSig: number;
  stochK: number;
  stochD: number;
  bbN: number;
  bbK: number;
};
const DEFAULT_SETTINGS: IndSettings = { ma1N: 20, ma2N: 50, rsiN: 14, macdF: 12, macdS: 26, macdSig: 9, stochK: 14, stochD: 3, bbN: 20, bbK: 2 };
const SETTINGS_KEY = "egx-ind-settings";

function loadSettings(): IndSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const p = JSON.parse(raw) as Partial<IndSettings>;
    const clamp = (v: unknown, lo: number, hi: number, d: number) =>
      typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d;
    return {
      ma1N: clamp(p.ma1N, 2, 400, 20),
      ma2N: clamp(p.ma2N, 2, 400, 50),
      rsiN: clamp(p.rsiN, 2, 100, 14),
      macdF: clamp(p.macdF, 2, 100, 12),
      macdS: clamp(p.macdS, 3, 200, 26),
      macdSig: clamp(p.macdSig, 2, 100, 9),
      stochK: clamp(p.stochK, 2, 100, 14),
      stochD: clamp(p.stochD, 1, 30, 3),
      bbN: clamp(p.bbN, 5, 200, 20),
      bbK: typeof p.bbK === "number" && Number.isFinite(p.bbK) ? Math.min(5, Math.max(0.5, p.bbK)) : 2,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: IndSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {}
}

/** G8 — comparison overlay options: the three headline indices, rebased to
 *  100 at the window start (stock-vs-stock lives in the Compare view). */
const COMPARE_OPTIONS: { key: string; ar: string; en: string }[] = [
  { key: "EGX30", ar: "إيجي إكس ٣٠", en: "EGX 30" },
  { key: "EGX70", ar: "إيجي إكس ٧٠", en: "EGX 70" },
  { key: "EGX100", ar: "إيجي إكس ١٠٠", en: "EGX 100" },
];

/** G19 — persisted drawings per symbol on the device. T27 upgrades the
 *  model from trendline-only to { type: "trend" | "hlevel" } with
 *  backward-compatible loading (old segments are trendlines). */
type Drawing =
  | { id: string; type: "trend"; a: { x: string; y: number }; b: { x: string; y: number } }
  | { id: string; type: "hlevel"; y: number; x: string };
const LINES_KEY = "egx-trendlines";

type LegacySeg = { a: { x: string; y: number }; b: { x: string; y: number } };

function loadLines(symbol: string): Drawing[] {
  try {
    const raw = localStorage.getItem(LINES_KEY);
    if (!raw) return [];
    const map = JSON.parse(raw) as Record<string, Drawing[] | LegacySeg[] | undefined>;
    const arr = map?.[symbol];
    if (!Array.isArray(arr)) return [];
    return arr
      .map((s, i): Drawing | null => {
        if (!s) return null;
        if ((s as Drawing).type === "hlevel") {
          const h = s as Drawing & { y: number };
          return Number.isFinite(h.y) ? { id: (s as Drawing).id ?? `h-${i}`, type: "hlevel", y: h.y, x: "" } : null;
        }
        const seg = s as LegacySeg;
        if (
          seg &&
          seg.a &&
          seg.b &&
          typeof seg.a.x === "string" &&
          Number.isFinite(seg.a.y) &&
          typeof seg.b.x === "string" &&
          Number.isFinite(seg.b.y)
        ) {
          return { id: (s as Drawing).id ?? `t-${i}`, type: "trend", a: seg.a, b: seg.b };
        }
        return null;
      })
      .filter((d): d is Drawing => d !== null);
  } catch {
    return [];
  }
}

function saveLines(symbol: string, drawings: Drawing[]): void {
  try {
    const raw = localStorage.getItem(LINES_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, Drawing[]>) : {};
    map[symbol] = drawings;
    localStorage.setItem(LINES_KEY, JSON.stringify(map));
  } catch {}
}

export function PriceChart({ symbol, defaultRange = "6M" }: { symbol: string; defaultRange?: string }) {
  const { lang } = useApp();
  const [range, setRange] = useState(defaultRange);
  const [data, setData] = useState<ChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // T27 — indicator parameters (restored after mount; SSR-safe)
  const [settings, setSettings] = useState<IndSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    setSettings(loadSettings());
  }, []);
  const applySettings = (next: IndSettings) => {
    setSettings(next);
    saveSettings(next);
  };
  const [inds, setInds] = useState<Record<IndKey, boolean>>({
    sma20: true,
    sma50: false,
    ema20: false,
    bb: false,
    ichimoku: false,
    vwap: false,
    psar: false,
    donchian: false,
    keltner: false,
    supertrend: false,
    fib: false,
    volma: false,
    rsi: false,
    macd: false,
    stoch: false,
    obv: false,
    mfi: false,
    atr: false,
    adx: false,
    wpr: false,
    cci: false,
  });
  // G8: chart modes
  const [logScale, setLogScale] = useState(false);
  const [compare, setCompare] = useState<string>("none");
  const [cmpData, setCmpData] = useState<ChartResponse | null>(null);
  const [cmpNote, setCmpNote] = useState<string | null>(null);
  // G19 + T27 — drawing tools: mode (off / trendline / horizontal level),
  // pending first click, persisted drawings, settings popover open state
  const [drawMode, setDrawMode] = useState<"off" | "trend" | "hlevel">("off");
  const [pending, setPending] = useState<{ x: string; y: number } | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as ChartResponse;
        if (!res.ok || json.error) throw new Error(json.error ?? `chart ${res.status}`);
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "chart unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [symbol, range]);

  // T26 — intraday ranges move with the tape: quietly refetch every minute
  // while an intraday timeframe is selected and the tab is visible (the
  // server sampler runs on every chart request, so a watching user keeps
  // the tick store fresh too).
  useEffect(() => {
    if (range !== "1D" && range !== "1W") return;
    const t = setInterval(async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as ChartResponse;
        if (json.error || !json.points || json.points.length < 2) return;
        if (mounted.current && json.points.length >= (data?.points.length ?? 0)) {
          setData(json);
          setError(null);
        }
      } catch {
        /* keep the last good frame */
      }
    }, 60_000);
    return () => clearInterval(t);
  }, [symbol, range, data?.points.length]);

  // while the index archive warms up, keep polling until real rows appear
  useEffect(() => {
    if (!data?.warming) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as ChartResponse;
        if (json.error || json.points.length < 2) return;
        if (mounted.current) {
          setData(json);
          setError(null);
        }
      } catch {
        /* keep polling */
      }
    }, 8_000);
    return () => clearInterval(t);
  }, [data?.warming, symbol, range]);

  // G19 — restore this symbol's drawings after mount (SSR-safe)
  useEffect(() => {
    setDrawings(loadLines(symbol));
    setPending(null);
    setDrawMode("off");
  }, [symbol]);

  // G8 — fetch the comparison series for the same range (indices only)
  useEffect(() => {
    if (compare === "none") {
      setCmpData(null);
      setCmpNote(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setCmpNote(null);
      try {
        const res = await fetch(`/api/chart?symbol=${compare}&range=${range}`, { cache: "no-store" });
        const json = (await res.json()) as ChartResponse;
        if (!res.ok || json.error || json.points.length < 2) throw new Error("unavailable");
        if (!cancelled) {
          setCmpData(json);
          setCmpNote(null);
        }
      } catch {
        if (!cancelled) {
          setCmpData(null);
          setCmpNote(lang === "ar" ? "سلسلة المقارنة غير متاحة لهذا النطاق" : "Comparison series unavailable for this range");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [compare, range, lang]);

  if (loading && !data) {
    return (
      <div className="space-y-2">
        <div className="flex gap-1.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-7 w-14" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error && !data) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{tt(T.chartUnavailable, lang)}</p>;
  }
  if (!data) return null;

  const points = data.points;
  const up = (data.changePct ?? 0) >= 0;
  const stroke = up ? "var(--up)" : "var(--down)";
  const showVolume = points.some((p) => typeof p.volume === "number");
  const n = points.length;

  // indicator availability per range length
  const canOverlay = n >= 21;
  const canRsi = n >= Math.max(15, settings.rsiN + 1);
  const canMacd = n >= settings.macdS + settings.macdSig + 8;
  const canVolMa = showVolume && n >= 21;
  // Ichimoku needs spanB(52) + displacement(26) ≈ 78 bars before the cloud
  // is more than a fragment; VWAP needs volume; PSAR needs 3 bars.
  const canIchimoku = n >= 80;
  const canVwap = showVolume && n >= 2;
  const canPsar = n >= 3;
  const canStoch = n >= Math.max(16, settings.stochK + settings.stochD + 2);
  const canDonchian = n >= 21;
  const canKeltner = n >= 30;
  const canSuperTrend = n >= 25;
  const canFib = n >= 10;
  const canObv = showVolume && n >= 2;
  const canMfi = showVolume && n >= 15;
  const canAtr = n >= 16;
  const canAdx = n >= 30;
  const canWpr = n >= 15;
  const canCci = n >= 15;
  const avail: Record<IndKey, boolean> = {
    sma20: canOverlay,
    sma50: canOverlay,
    ema20: canOverlay,
    bb: canOverlay,
    ichimoku: canIchimoku,
    vwap: canVwap,
    psar: canPsar,
    donchian: canDonchian,
    keltner: canKeltner,
    supertrend: canSuperTrend,
    fib: canFib,
    volma: canVolMa,
    rsi: canRsi,
    macd: canMacd,
    stoch: canStoch,
    obv: canObv,
    mfi: canMfi,
    atr: canAtr,
    adx: canAdx,
    wpr: canWpr,
    cci: canCci,
  };
  const anyAvail = Object.values(avail).some(Boolean);
  const activeInds = INDICATORS.filter((d) => inds[d.key] && avail[d.key]);
  const useVolMa = inds.volma && canVolMa;
  const showVolMaToggle = showVolume && n >= 21; // toggle visible whenever volume + length allow
  const isMilestones = !!data.milestones;

  // compute series — T27: parameters come from the persisted settings
  const closes = points.map((p) => p.close);
  const highsArr = points.map((p) => p.high ?? null);
  const lowsArr = points.map((p) => p.low ?? null);
  const volsArr = points.map((p) => (typeof p.volume === "number" ? p.volume : null));
  const sSma20 = inds.sma20 && canOverlay ? smaSeries(closes, settings.ma1N) : null;
  const sSma50 = inds.sma50 && canOverlay ? smaSeries(closes, settings.ma2N) : null;
  const sEma20 = inds.ema20 && canOverlay ? emaFull(closes, 20) : null;
  const sBb = inds.bb && canOverlay ? bollingerSeries(closes, settings.bbN, settings.bbK) : null;
  const sRsi = inds.rsi && canRsi ? rsiSeries(closes, settings.rsiN) : null;
  const sMacd = inds.macd && canMacd ? macdSeries(closes, settings.macdF, settings.macdS, settings.macdSig) : null;
  const sStoch = inds.stoch && canStoch ? stochasticSeries(highsArr, lowsArr, closes, settings.stochK, settings.stochD, 3) : null;
  const sVwap = inds.vwap && canVwap ? vwapSeries(highsArr, lowsArr, closes, volsArr) : null;
  const sPsar = inds.psar && canPsar ? psarSeries(highsArr, lowsArr, closes) : null;
  const useIch = inds.ichimoku && canIchimoku && compare === "none";
  const sIch = useIch ? ichimokuSeries(highsArr, lowsArr, closes, 9, 26, 52, 26) : null;
  const sDon = inds.donchian && canDonchian ? donchianSeries(highsArr, lowsArr, closes, 20) : null;
  const sKelt = inds.keltner && canKeltner ? keltnerSeries(highsArr, lowsArr, closes, 20, 10, 2) : null;
  const sSt = inds.supertrend && canSuperTrend ? superTrendSeries(highsArr, lowsArr, closes, 10, 3) : null;
  const sObv = inds.obv && canObv ? obvSeries(closes, volsArr) : null;
  const sMfi = inds.mfi && canMfi ? mfiSeries(highsArr, lowsArr, closes, volsArr, 14) : null;
  const sAtr = inds.atr && canAtr ? atrSeries(highsArr, lowsArr, closes, 14) : null;
  const sAdx = inds.adx && canAdx ? adxSeries(highsArr, lowsArr, closes, 14) : null;
  const sWpr = inds.wpr && canWpr ? williamsRSeries(highsArr, lowsArr, closes, 14) : null;
  const sCci = inds.cci && canCci ? cciSeries(highsArr, lowsArr, closes, 20) : null;

  // T27 — auto Fibonacci retracement: from the visible window's extreme
  // swing (lowest low → highest high when the window trends up, the reverse
  // when it trends down), classic ratios projected as dashed levels.
  const fibLevels = (() => {
    if (!inds.fib || !canFib || compare !== "none") return null;
    let loIdx = 0;
    let hiIdx = 0;
    for (let i = 1; i < n; i++) {
      if (points[i].close < points[loIdx].close) loIdx = i;
      if (points[i].close > points[hiIdx].close) hiIdx = i;
    }
    const trendingUp = hiIdx > loIdx;
    const lo = points[loIdx].close;
    const hi = points[hiIdx].close;
    if (!(hi > lo)) return null;
    const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    return {
      lo,
      hi,
      trendingUp,
      levels: ratios.map((r) => ({ r, price: trendingUp ? hi - r * (hi - lo) : lo + r * (hi - lo) })),
    };
  })();

  const sVolMa = useVolMa
    ? smaSeries(
        points.map((p) => (typeof p.volume === "number" ? p.volume : 0)),
        20,
      )
    : null;

  // T26 — label formats: intraday tick rows carry "YYYY-MM-DD HH:mm";
  // 1D shows the time, 1W shows day+time, daily keeps the compact date.
  const isIntradayData = points.length > 0 && points[0].date.length > 10;
  const tickLabel = (d: string) =>
    isIntradayData ? (range === "1D" ? d.slice(11, 16) : d.slice(5, 16)) : d.slice(2);

  const chartData = points.map((p, i) => {
    const row: Record<string, string | number | undefined> = {
      date: tickLabel(p.date),
      close: p.close,
      volume: p.volume ?? undefined,
      sma20: sSma20?.[i] ?? undefined,
      sma50: sSma50?.[i] ?? undefined,
      ema20: sEma20?.[i] ?? undefined,
      bbUp: sBb?.up[i] ?? undefined,
      bbMid: sBb?.mid[i] ?? undefined,
      bbLo: sBb?.lo[i] ?? undefined,
      volMa: sVolMa?.[i] ?? undefined,
      rsi: sRsi?.[i] ?? undefined,
      macd: sMacd?.macd[i] ?? undefined,
      macdSignal: sMacd?.signal[i] ?? undefined,
      macdHist: sMacd?.hist[i] ?? undefined,
      stochK: sStoch?.k[i] ?? undefined,
      stochD: sStoch?.d[i] ?? undefined,
      vwap: sVwap?.[i] ?? undefined,
      psar: sPsar?.[i] ?? undefined,
      donUp: sDon?.up[i] ?? undefined,
      donMid: sDon?.mid[i] ?? undefined,
      donLo: sDon?.lo[i] ?? undefined,
      keltUp: sKelt?.up[i] ?? undefined,
      keltMid: sKelt?.mid[i] ?? undefined,
      keltLo: sKelt?.lo[i] ?? undefined,
      stLine: sSt?.line[i] ?? undefined,
      obv: sObv?.[i] ?? undefined,
      mfi: sMfi?.[i] ?? undefined,
      atr: sAtr?.[i] ?? undefined,
      adx: sAdx?.adx[i] ?? undefined,
      adxPdi: sAdx?.pdi[i] ?? undefined,
      adxMdi: sAdx?.mdi[i] ?? undefined,
      wpr: sWpr?.[i] ?? undefined,
      cci: sCci?.[i] ?? undefined,
    };
    if (sIch) {
      const a = sIch.spanA[i] ?? undefined;
      const b = sIch.spanB[i] ?? undefined;
      row.spanA = a;
      row.spanB = b;
      row.cloudUp = a !== undefined && b !== undefined && (a as number) >= (b as number) ? (a as number) - (b as number) : undefined;
      row.cloudDn = a !== undefined && b !== undefined && (a as number) < (b as number) ? (a as number) - (b as number) : undefined;
      row.tenkan = sIch.tenkan[i] ?? undefined;
      row.kijun = sIch.kijun[i] ?? undefined;
      row.chikou = sIch.chikou[i] ?? undefined;
    }
    return row;
  });

  // T26 — Ichimoku forward projection: append the next 26 trading days
  // (Sun–Thu sessions; Fri/Sat are the EGX weekend) so the cloud leads the
  // price exactly like TradingView's classic Ichimoku rendering.
  const ichData = (() => {
    if (!sIch || !useIch) return chartData;
    const lastDate = points[points.length - 1].date.slice(0, 10);
    const future: string[] = [];
    const d = new Date(`${lastDate}T00:00:00Z`);
    while (future.length < 26) {
      d.setUTCDate(d.getUTCDate() + 1);
      const day = d.getUTCDay(); // 5=Fri, 6=Sat — EGX weekend
      if (day === 5 || day === 6) continue;
      future.push(d.toISOString().slice(0, 10));
    }
    const rows = future.map((fd, j) => {
      const a = sIch.projA[j] ?? undefined;
      const b = sIch.projB[j] ?? undefined;
      const row: Record<string, string | number | undefined> = {
        date: fd.slice(2), // daily-style label on projected slots
        spanA: a,
        spanB: b,
        cloudUp: a !== undefined && b !== undefined && (a as number) >= (b as number) ? (a as number) - (b as number) : undefined,
        cloudDn: a !== undefined && b !== undefined && (a as number) < (b as number) ? (a as number) - (b as number) : undefined,
      };
      return row;
    });
    return [...chartData, ...rows];
  })();

  // G8 compare mode: rebase both series to 100 at the window start and merge
  // onto the main date axis (union of dates, forward-filled). Plain function
  // (not a hook): this sits after the early returns above.
  const compareOn = compare !== "none" && !!cmpData && cmpData!.points.length >= 2;
  const cmpLabel = compareOn
    ? tt(COMPARE_OPTIONS.find((o) => o.key === compare) ?? { ar: compare, en: compare }, lang)
    : "";
  const compareData = (() => {
    if (!compareOn || !cmpData) return null;
    const cmpMap = new Map(cmpData.points.map((p) => [p.date, p.close]));
    const mainMap = new Map(points.map((p) => [p.date, p.close]));
    const dates = Array.from(new Set([...mainMap.keys(), ...cmpMap.keys()])).sort();
    let m0: number | null = null;
    let c0: number | null = null;
    let mLast = 100;
    let cLast = 100;
    const rows: { date: string; main100: number; cmp100: number; close?: number }[] = [];
    for (const d of dates) {
      const m = mainMap.get(d);
      const c = cmpMap.get(d);
      if (m != null && m0 === null) m0 = m;
      if (c != null && c0 === null) c0 = c;
      if (m != null && m0) mLast = (m / m0) * 100;
      if (c != null && c0) cLast = (c / c0) * 100;
      rows.push({ date: d.slice(2), main100: mLast, cmp100: cLast, close: m });
    }
    return rows;
  })();

  // drawing click capture (G19 + T27): trendlines take two clicks
  // (start → end); a horizontal level takes one. Snaps to the session under
  // the cursor; the y comes from the clicked close (levels snap to price).
  const handleChartClick = (state: { activeLabel?: string; activeTooltipIndex?: number }) => {
    if (drawMode === "off" || compareOn) return;
    const idx = state.activeTooltipIndex;
    if (idx == null || idx < 0 || idx >= chartData.length) return;
    const row = chartData[idx];
    const y = row.close;
    if (typeof y !== "number" || !Number.isFinite(y)) return;
    const point = { x: String(row.date), y };
    if (drawMode === "hlevel") {
      const next = [...drawings, { id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type: "hlevel" as const, y, x: point.x }];
      setDrawings(next);
      saveLines(symbol, next);
      setDrawMode("off");
      return;
    }
    if (!pending) {
      setPending(point);
    } else {
      const next = [...drawings, { id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type: "trend" as const, a: pending, b: point }];
      setDrawings(next);
      saveLines(symbol, next);
      setPending(null);
      setDrawMode("off");
    }
  };

  const removeDrawing = (id: string) => {
    const next = drawings.filter((d) => d.id !== id);
    setDrawings(next);
    saveLines(symbol, next);
  };

  const syncId = `pc-${data.symbol}-${data.range}`;
  const lastIdx = n - 1;
  const lastRsi = sRsi ? sRsi[lastIdx] : null;
  const lastMacd = sMacd ? sMacd.macd[lastIdx] : null;
  const lastStochK = sStoch ? sStoch.k[lastIdx] : null;
  const lastStochD = sStoch ? sStoch.d[lastIdx] : null;
  const lastObv = sObv ? sObv[lastIdx] : null;
  const lastMfi = sMfi ? sMfi[lastIdx] : null;
  const lastAtr = sAtr ? sAtr[lastIdx] : null;
  const lastAdx = sAdx ? sAdx.adx[lastIdx] : null;
  const lastWpr = sWpr ? sWpr[lastIdx] : null;
  const lastCci = sCci ? sCci[lastIdx] : null;

  // tooltip overlay rows for enabled indicators
  const tipExtras: { key: string; label: string; color: string; fmt: (v: number) => string }[] = [];
  if (sSma20) tipExtras.push({ key: "sma20", label: tt(T.indSma20, lang), color: "var(--c1)", fmt: (v) => fmtNum(v) });
  if (sSma50) tipExtras.push({ key: "sma50", label: tt(T.indSma50, lang), color: "var(--c2)", fmt: (v) => fmtNum(v) });
  if (sEma20) tipExtras.push({ key: "ema20", label: tt(T.indEma20, lang), color: "var(--c5)", fmt: (v) => fmtNum(v) });
  if (sBb) {
    tipExtras.push({ key: "bbUp", label: `BB ↑`, color: "var(--c4)", fmt: (v) => fmtNum(v) });
    tipExtras.push({ key: "bbLo", label: `BB ↓`, color: "var(--c4)", fmt: (v) => fmtNum(v) });
  }
  if (sVwap) tipExtras.push({ key: "vwap", label: tt(T.indVwap, lang), color: "var(--c6)", fmt: (v) => fmtNum(v) });
  if (sPsar) tipExtras.push({ key: "psar", label: "PSAR", color: "var(--c5)", fmt: (v) => fmtNum(v) });
  if (sIch) {
    tipExtras.push({ key: "tenkan", label: tt(T.ichTenkan, lang), color: "var(--c8)", fmt: (v) => fmtNum(v) });
    tipExtras.push({ key: "kijun", label: tt(T.ichKijun, lang), color: "var(--c4)", fmt: (v) => fmtNum(v) });
    tipExtras.push({ key: "spanA", label: tt(T.ichSpanA, lang), color: "var(--up)", fmt: (v) => fmtNum(v) });
    tipExtras.push({ key: "spanB", label: tt(T.ichSpanB, lang), color: "var(--down)", fmt: (v) => fmtNum(v) });
  }
  if (sVolMa)
    tipExtras.push({ key: "volMa", label: tt(T.volMaLine, lang), color: "var(--c1)", fmt: (v) => fmtInt(v) });
  if (sDon) {
    tipExtras.push({ key: "donUp", label: "Donchian ↑", color: "var(--c2)", fmt: (v) => fmtNum(v) });
    tipExtras.push({ key: "donLo", label: "Donchian ↓", color: "var(--c2)", fmt: (v) => fmtNum(v) });
  }
  if (sKelt) {
    tipExtras.push({ key: "keltUp", label: "Keltner ↑", color: "var(--c6)", fmt: (v) => fmtNum(v) });
    tipExtras.push({ key: "keltLo", label: "Keltner ↓", color: "var(--c6)", fmt: (v) => fmtNum(v) });
  }
  if (sSt) tipExtras.push({ key: "stLine", label: "SuperTrend", color: "var(--c8)", fmt: (v) => fmtNum(v) });

  const rsiState =
    lastRsi === null ? null : lastRsi >= 70 ? "overbought" : lastRsi <= 30 ? "oversold" : "neutral";

  return (
    <div dir="ltr" className="space-y-3">
      {/* header stats */}
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          {data.last !== null && <span className="num text-2xl font-bold tracking-tight">{fmtNum(data.last)}</span>}
          {data.changePct !== null && (
            <span className={`num text-sm font-semibold ${directionClass(data.changePct)}`}>
              {fmtPct(data.changePct)} <span className="text-muted-foreground font-normal">({tt(T.rangeChange, lang)})</span>
            </span>
          )}
          {data.currency === "EGP" && <span className="text-[10px] text-muted-foreground">EGP</span>}
          {data.kind === "index" && <span className="text-[10px] text-muted-foreground">{tt(T.indexPoints, lang)}</span>}
        </div>
        <div className="num text-[11px] text-muted-foreground">
          {tt(T.chartHigh, lang)} {fmtNum(data.high, 1)} · {tt(T.chartLow, lang)} {fmtNum(data.low, 1)}
        </div>
      </div>

      {/* range buttons + chart modes (G8) */}
      <div className="flex items-center gap-1.5 flex-wrap" role="tablist" aria-label={tt(T.chartRange, lang)}>
        {data.availableRanges.map((r) => {
          const active = r === data.range;
          return (
            <button
              key={r}
              role="tab"
              aria-selected={active}
              onClick={() => {
                setRange(r);
                if ((r === "1D" || r === "1W") && compare !== "none") setCompare("none");
              }}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                active ? "bg-secondary font-semibold border-ring" : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              {tt(RANGE_LABELS[r] ?? { ar: r, en: r }, lang)}
            </button>
          );
        })}
        <button
          onClick={() => setLogScale((v) => !v)}
          aria-pressed={logScale}
          title={tt(T.logScaleLabel, lang)}
          className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
            logScale ? "bg-secondary font-semibold border-ring" : "text-muted-foreground hover:bg-accent/50"
          }`}
        >
          {tt(T.logScaleLabel, lang)}
        </button>
        <select
          value={compare}
          onChange={(e) => setCompare(e.target.value)}
          disabled={range === "1D" || range === "1W"}
          aria-label={tt(T.compareChartLabel, lang)}
          title={range === "1D" || range === "1W" ? tt(T.intradayCompareOff, lang) : tt(T.compareChartNote, lang)}
          className={`h-7 rounded-md border bg-card px-1.5 text-[11px] text-foreground ${
            range === "1D" || range === "1W" ? "opacity-40" : ""
          }`}
        >
          <option value="none">{tt(T.compareAddIndex, lang)}</option>
          {COMPARE_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {lang === "ar" ? o.ar : o.en}
            </option>
          ))}
        </select>
        {cmpNote && <span className="text-[10px] text-muted-foreground">{cmpNote}</span>}
        {data.asOf && <span className="num ms-auto text-[10px] text-muted-foreground">{data.asOf}</span>}
      </div>

      {/* indicator toggles + drawing tools (G19 + T27) */}
      {points.length >= 2 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-medium text-muted-foreground me-1">{tt(T.indicatorsLabel, lang)}:</span>
          {INDICATORS.map((d) => {
            const on = inds[d.key];
            const ok = avail[d.key] && !compareOn; // overlays are absolute-price — hidden in compare mode
            return (
              <button
                key={d.key}
                onClick={() => ok && setInds((s) => ({ ...s, [d.key]: !s[d.key] }))}
                disabled={!ok}
                title={ok ? undefined : compareOn ? tt(T.compareChartNote, lang) : tt(T.indNotEnough, lang)}
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                  !ok
                    ? "opacity-40 cursor-not-allowed text-muted-foreground"
                    : on
                      ? "bg-secondary font-semibold border-ring"
                      : "text-muted-foreground hover:bg-accent/50"
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: d.color }} aria-hidden />
                {tt(d.t, lang)}
              </button>
            );
          })}
          {showVolMaToggle && !compareOn && (
            <button
              onClick={() => setInds((s) => ({ ...s, volma: !s.volma }))}
              aria-pressed={inds.volma}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                inds.volma
                  ? "bg-secondary font-semibold border-ring"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: "var(--c1)" }} aria-hidden />
              {tt(T.indVolMa, lang)}
            </button>
          )}

          {/* T27 — indicator settings (TradingView-style parameters) */}
          <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverTrigger asChild>
              <button
                aria-label={tt({ ar: "إعدادات المؤشرات", en: "Indicator settings" }, lang)}
                title={tt({ ar: "إعدادات المؤشرات (فترات ومعاملات)", en: "Indicator settings (periods and parameters)" }, lang)}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/50 transition-colors"
              >
                <Settings2 className="h-3 w-3" />
                {tt({ ar: "إعدادات", en: "Settings" }, lang)}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-3" dir={lang === "ar" ? "rtl" : "ltr"}>
              <p className="text-xs font-semibold mb-2">{tt({ ar: "معاملات المؤشرات", en: "Indicator parameters" }, lang)}</p>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["ma1N", { ar: "فترة المتوسط ١", en: "MA 1 period" }, 2, 400],
                    ["ma2N", { ar: "فترة المتوسط ٢", en: "MA 2 period" }, 2, 400],
                    ["rsiN", { ar: "فترة RSI", en: "RSI period" }, 2, 100],
                    ["bbN", { ar: "فترة بولنجر", en: "BB period" }, 5, 200],
                    ["macdF", { ar: "MACD سريع", en: "MACD fast" }, 2, 100],
                    ["macdS", { ar: "MACD بطيء", en: "MACD slow" }, 3, 200],
                    ["macdSig", { ar: "MACD إشارة", en: "MACD signal" }, 2, 100],
                    ["stochK", { ar: "فترة ستوكاستك %K", en: "Stoch %K" }, 2, 100],
                    ["stochD", { ar: "فترة ستوكاستك %D", en: "Stoch %D" }, 1, 30],
                  ] as [keyof IndSettings, { ar: string; en: string }, number, number][]
                ).map(([k, label, lo, hi]) => (
                  <label key={k} className="flex flex-col gap-1">
                    <span className="text-[10px] text-muted-foreground">{tt(label, lang)}</span>
                    <input
                      dir="ltr"
                      type="number"
                      min={lo}
                      max={hi}
                      value={settings[k]}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        applySettings({ ...settings, [k]: Number.isFinite(v) ? v : settings[k] });
                      }}
                      className="h-7 rounded-md border bg-card px-2 text-xs num"
                    />
                  </label>
                ))}
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted-foreground">{tt({ ar: "مضاعف بولنجر", en: "BB multiplier" }, lang)}</span>
                  <input
                    dir="ltr"
                    type="number"
                    min={0.5}
                    max={5}
                    step={0.1}
                    value={settings.bbK}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      applySettings({ ...settings, bbK: Number.isFinite(v) ? v : settings.bbK });
                    }}
                    className="h-7 rounded-md border bg-card px-2 text-xs num"
                  />
                </label>
              </div>
              <div className="flex items-center justify-between mt-3">
                <button
                  onClick={() => applySettings(DEFAULT_SETTINGS)}
                  className="text-[10px] text-muted-foreground hover:text-primary underline"
                >
                  {tt({ ar: "استعادة الافتراضي", en: "Reset defaults" }, lang)}
                </button>
                <span className="text-[10px] text-muted-foreground">{tt({ ar: "تُحفظ على جهازك", en: "Saved on your device" }, lang)}</span>
              </div>
            </PopoverContent>
          </Popover>

          {/* T27 — drawing tools: trendline / horizontal level / list */}
          <button
            onClick={() => {
              setDrawMode(drawMode === "trend" ? "off" : "trend");
              setPending(null);
            }}
            aria-pressed={drawMode === "trend"}
            disabled={compareOn}
            title={compareOn ? tt(T.compareChartNote, lang) : tt(T.drawModeHint, lang)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
              drawMode === "trend"
                ? "bg-primary/15 font-semibold border-primary/40 text-primary"
                : "text-muted-foreground hover:bg-accent/50"
            } ${compareOn ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            <TrendingUp className="h-3 w-3" />
            {tt(T.drawTrendline, lang)}
            {pending && drawMode === "trend" && <span className="num text-[9px] text-primary">·١</span>}
          </button>
          <button
            onClick={() => setDrawMode(drawMode === "hlevel" ? "off" : "hlevel")}
            aria-pressed={drawMode === "hlevel"}
            disabled={compareOn}
            title={compareOn ? tt(T.compareChartNote, lang) : tt({ ar: "اضغط على الرسم لرسم خط أفقي عند هذا السعر", en: "Click the chart to drop a horizontal level at that price" }, lang)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
              drawMode === "hlevel"
                ? "bg-primary/15 font-semibold border-primary/40 text-primary"
                : "text-muted-foreground hover:bg-accent/50"
            } ${compareOn ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            <Minus className="h-3 w-3" />
            {tt({ ar: "مستوى أفقي", en: "Level" }, lang)}
          </button>
          {drawings.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/50"
                  title={tt({ ar: "إدارة الرسمات", en: "Manage drawings" }, lang)}
                >
                  <ListPlus className="h-3 w-3" />
                  {tt({ ar: "رسمات", en: "Drawings" }, lang)} ({drawings.length})
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-2" dir={lang === "ar" ? "rtl" : "ltr"}>
                <div className="max-h-48 overflow-auto thin-scroll space-y-1">
                  {drawings.map((d) => (
                    <div key={d.id} className="flex items-center gap-2 text-[11px] py-1 border-b last:border-0">
                      {d.type === "trend" ? (
                        <span className="num text-muted-foreground flex-1 min-w-0 truncate">
                          <TrendingUp className="h-3 w-3 inline me-1" aria-hidden />
                          {fmtNum(d.a.y)} → {fmtNum(d.b.y)}
                        </span>
                      ) : (
                        <span className="num text-muted-foreground flex-1 min-w-0 truncate">
                          <Minus className="h-3 w-3 inline me-1" aria-hidden />
                          {tt({ ar: "مستوى", en: "Level" }, lang)} {fmtNum(d.y)}
                        </span>
                      )}
                      <button
                        onClick={() => removeDrawing(d.id)}
                        aria-label={tt(T.alertRemove, lang)}
                        className="text-muted-foreground hover:text-down shrink-0"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => {
                    setDrawings([]);
                    saveLines(symbol, []);
                  }}
                  className="mt-1 w-full text-[10px] text-muted-foreground hover:text-down border rounded-md py-1"
                >
                  {tt(T.clearDrawings, lang)}
                </button>
              </PopoverContent>
            </Popover>
          )}
          {drawMode !== "off" && (
            <span className="text-[10px] text-primary">
              {drawMode === "hlevel"
                ? tt({ ar: "اضغط على الشارت لرسم المستوى", en: "Click the chart to drop the level" }, lang)
                : tt(T.drawModeHint, lang)}
            </span>
          )}
          {!anyAvail && !compareOn && (
            <span className="text-[10px] text-muted-foreground">{tt(T.indNotEnough, lang)}</span>
          )}
        </div>
      )}

      {/* T27 — milestone notice: this name has no free daily history */}
      {isMilestones && (
        <p className="rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-[10px] text-muted-foreground leading-relaxed">
          {tt(
            {
              ar: "لا يوجد تاريخ يومي مجاني متاح لهذه الورقة (غير مغطى على المصادر المجانية أو سلسلة موقوفة من المزوّد) — تُعرض محطات سعرية موثّقة (أسبوع/شهر/٣ أشهر/٦ أشهر/بداية السنة/سنة) محسوبة من بيانات الأداء الحية، مع نطاق ٥٢ أسبوعًا كخطوط مرجعية.",
              en: "No free daily history we can serve for this name (uncovered by free sources, or a vendor-discontinued series) — showing verified horizon prices (1W/1M/3M/6M/YTD/1Y) computed from live performance data, with the 52-week range as reference lines.",
            },
            lang,
          )}
        </p>
      )}

      {/* chart canvas */}
      {points.length < 2 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {data.warming ? tt(T.chartWarming, lang) : tt(T.chartUnavailable, lang)}
        </p>
      ) : (
        <>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={(compareData as unknown as object[] | null) ?? (useIch ? (ichData as unknown as object[]) : (chartData as unknown as object[]))}
                margin={{ top: 8, right: 8, bottom: 0, left: -6 }}
                syncId={syncId}
                onClick={(state) => handleChartClick(state as { activeLabel?: string; activeTooltipIndex?: number })}
                style={drawMode !== "off" ? { cursor: "crosshair" } : undefined}
              >
                <defs>
                  <linearGradient id={`pcg-${data.symbol}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                  interval="preserveStartEnd"
                  minTickGap={28}
                />
                <YAxis
                  yAxisId="price"
                  domain={["auto", "auto"]}
                  scale={logScale && !compareOn ? "log" : "auto"}
                  allowDataOverflow={false}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(v: number) => fmtNum(v, 1)}
                />
                {showVolume && !compareOn && (
                  <YAxis
                    yAxisId="vol"
                    orientation="right"
                    tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    tickFormatter={(v: number) => fmtValue(v)}
                  />
                )}
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const get = (k: string) => {
                      const v = payload.find((p) => p.dataKey === k)?.value as number | undefined;
                      return v !== undefined && Number.isFinite(v) ? v : null;
                    };
                    const close = get("close");
                    const vol = get("volume");
                    const main100 = get("main100");
                    const cmp100 = get("cmp100");
                    if (close === null && vol === null && main100 === null) return null;
                    return (
                      <div className="rounded-md border bg-card px-3 py-1.5 text-xs shadow-md max-w-[220px]">
                        <p className="num font-semibold">{label}</p>
                        {compareData && main100 !== null && (
                          <>
                            <p className="num text-muted-foreground">
                              {symbol}: <b className={main100 >= 100 ? "text-up" : "text-down"}>{fmtNum(main100, 1)}</b>
                            </p>
                            <p className="num text-muted-foreground">
                              {cmpLabel}: <b className={cmp100 !== null && cmp100 >= 100 ? "text-up" : "text-down"}>{cmp100 !== null ? fmtNum(cmp100, 1) : "—"}</b>
                            </p>
                            {close !== null && (
                              <p className="num text-muted-foreground">
                                {tt(T.close, lang)}: <b>{fmtNum(close)}</b>
                              </p>
                            )}
                          </>
                        )}
                        {!compareData && close !== null && (
                          <p className="num text-muted-foreground">
                            {tt(T.close, lang)}: <b className={up ? "text-up" : "text-down"}>{fmtNum(close)}</b>
                            {data.currency === "EGP" && " EGP"}
                          </p>
                        )}
                        {!compareData && vol !== null && (
                          <p className="num text-muted-foreground">
                            {tt(T.volume, lang)}: {fmtInt(vol)}
                          </p>
                        )}
                        {!compareData &&
                          tipExtras.map((e) => {
                            const v = get(e.key);
                            return v === null ? null : (
                              <p key={e.key} className="num text-muted-foreground flex items-center gap-1.5">
                                <span className="h-1.5 w-1.5 rounded-full inline-block" style={{ background: e.color }} />
                                {e.label}: {e.fmt(v)}
                              </p>
                            );
                          })}
                      </div>
                    );
                  }}
                />
                {showVolume && !compareOn && (
                  <Bar yAxisId="vol" dataKey="volume" fill="var(--muted-foreground)" opacity={0.25} isAnimationActive={false} />
                )}
                {useVolMa && !compareOn && (
                  <Line
                    yAxisId="vol"
                    dataKey="volMa"
                    stroke="var(--c1)"
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
                {sBb && !compareOn && (
                  <Line
                    yAxisId="price"
                    dataKey="bbUp"
                    stroke="var(--c4)"
                    strokeWidth={1}
                    strokeDasharray="4 2"
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
                {sBb && !compareOn && (
                  <Line
                    yAxisId="price"
                    dataKey="bbMid"
                    stroke="var(--c4)"
                    strokeWidth={1}
                    strokeDasharray="2 3"
                    opacity={0.7}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
                {sBb && !compareOn && (
                  <Line
                    yAxisId="price"
                    dataKey="bbLo"
                    stroke="var(--c4)"
                    strokeWidth={1}
                    strokeDasharray="4 2"
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}

                {/* T26 — Ichimoku Kinko Hyo: the cloud is drawn with the
                    stacked-area band trick (base = Senkou B, transparent;
                    cloudUp/cloudDn = signed A−B deltas stacked on top, tinted
                    green when Span A leads and red when it lags), then the
                    Span A / Tenkan / Kijun / Chikou lines over it. The data
                    array carries 26 forward-projected slots so the cloud
                    leads price like TradingView's classic rendering. */}
                {sIch && !compareOn && (
                  <Area
                    yAxisId="price"
                    type="monotone"
                    dataKey="spanB"
                    stackId="ichCloud"
                    stroke="var(--down)"
                    strokeWidth={1}
                    fill="transparent"
                    fillOpacity={0}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
                {sIch && !compareOn && (
                  <Area
                    yAxisId="price"
                    type="monotone"
                    dataKey="cloudUp"
                    stackId="ichCloud"
                    stroke="none"
                    fill="var(--up)"
                    fillOpacity={0.14}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
                {sIch && !compareOn && (
                  <Area
                    yAxisId="price"
                    type="monotone"
                    dataKey="cloudDn"
                    stackId="ichCloud"
                    stroke="none"
                    fill="var(--down)"
                    fillOpacity={0.14}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
                {sIch && !compareOn && (
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="spanA"
                    stroke="var(--up)"
                    strokeWidth={1.2}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
                {sIch && !compareOn && (
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="tenkan"
                    stroke="var(--c8)"
                    strokeWidth={1.4}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
                {sIch && !compareOn && (
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="kijun"
                    stroke="var(--c4)"
                    strokeWidth={1.4}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
                {sIch && !compareOn && (
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="chikou"
                    stroke="var(--c7)"
                    strokeWidth={1.2}
                    strokeDasharray="5 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                )}

                {/* T26 — VWAP (window-anchored, needs volume) */}
                {sVwap && !compareOn && (
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="vwap"
                    stroke="var(--c6)"
                    strokeWidth={1.5}
                    strokeDasharray="6 3"
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}

                {/* T26 — Parabolic SAR: dot trail under/over price */}
                {sPsar && !compareOn && (
                  <Line
                    yAxisId="price"
                    dataKey="psar"
                    stroke="none"
                    dot={{ r: 1.6, fill: "var(--c5)", strokeWidth: 0 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}

                {/* T27 — Donchian channel (20) — direct children (recharts
                    *  does not traverse Fragments) */}
                {sDon && !compareOn && (
                  <Line yAxisId="price" type="monotone" dataKey="donUp" stroke="var(--c2)" strokeWidth={1} strokeDasharray="5 2" dot={false} connectNulls isAnimationActive={false} />
                )}
                {sDon && !compareOn && (
                  <Line yAxisId="price" type="monotone" dataKey="donMid" stroke="var(--c2)" strokeWidth={0.8} opacity={0.5} dot={false} connectNulls isAnimationActive={false} />
                )}
                {sDon && !compareOn && (
                  <Line yAxisId="price" type="monotone" dataKey="donLo" stroke="var(--c2)" strokeWidth={1} strokeDasharray="5 2" dot={false} connectNulls isAnimationActive={false} />
                )}

                {/* T27 — Keltner channel (EMA20 ± 2×ATR10) */}
                {sKelt && !compareOn && (
                  <Line yAxisId="price" type="monotone" dataKey="keltUp" stroke="var(--c6)" strokeWidth={1} strokeDasharray="2 4" dot={false} connectNulls isAnimationActive={false} />
                )}
                {sKelt && !compareOn && (
                  <Line yAxisId="price" type="monotone" dataKey="keltMid" stroke="var(--c6)" strokeWidth={0.8} opacity={0.5} dot={false} connectNulls isAnimationActive={false} />
                )}
                {sKelt && !compareOn && (
                  <Line yAxisId="price" type="monotone" dataKey="keltLo" stroke="var(--c6)" strokeWidth={1} strokeDasharray="2 4" dot={false} connectNulls isAnimationActive={false} />
                )}

                {/* T27 — SuperTrend (10, 3): green while long, red while short */}
                {sSt && !compareOn && (
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="stLine"
                    stroke="var(--c8)"
                    strokeWidth={1.6}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}

                {/* G8 — compare mode: rebased performance lines (rendered as
                    direct children — recharts does not traverse Fragments) */}
                {compareData && (
                  <ReferenceLine yAxisId="price" y={100} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                )}
                {compareData && (
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="cmp100"
                    name={cmpLabel}
                    stroke="var(--c4)"
                    strokeWidth={1.8}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
                {compareData && (
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="main100"
                    name={`${symbol} (100)`}
                    stroke={stroke}
                    strokeWidth={2.2}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}

                {/* G19 + T27 — persisted drawings: trendlines + horizontal
                    *  levels (price mode only) */}
                {!compareData &&
                  drawings.map((d) =>
                    d.type === "trend" ? (
                      <ReferenceLine
                        key={d.id}
                        yAxisId="price"
                        segment={[{ x: d.a.x, y: d.a.y }, { x: d.b.x, y: d.b.y }]}
                        stroke="var(--c5)"
                        strokeWidth={1.5}
                        ifOverflow="extendDomain"
                      />
                    ) : (
                      <ReferenceLine
                        key={d.id}
                        yAxisId="price"
                        y={d.y}
                        stroke="var(--c6)"
                        strokeWidth={1.2}
                        strokeDasharray="6 3"
                        ifOverflow="extendDomain"
                        label={{ value: fmtNum(d.y), position: "insideTopRight", fontSize: 9, fill: "var(--c6)" }}
                      />
                    )
                  )}
                {!compareData && pending && (
                  <ReferenceLine
                    yAxisId="price"
                    x={pending.x}
                    stroke="var(--c5)"
                    strokeWidth={1}
                    strokeDasharray="2 2"
                  />
                )}

                {/* T27 — auto Fibonacci retracement levels from the visible
                    *  window's swing (0 / 23.6 / 38.2 / 50 / 61.8 / 78.6 / 100%) */}
                {fibLevels && !compareOn &&
                  fibLevels.levels.map((l, i) => (
                    <ReferenceLine
                      key={`fib-${l.r}`}
                      yAxisId="price"
                      y={l.price}
                      stroke={l.r === 0.5 || l.r === 0.618 ? "var(--c4)" : "var(--border)"}
                      strokeWidth={l.r === 0.5 || l.r === 0.618 ? 1.1 : 0.8}
                      strokeDasharray={i % 2 ? "3 4" : "1 0"}
                      opacity={0.75}
                      ifOverflow="extendDomain"
                      label={{ value: `${(l.r * 100).toFixed(1)}% ${fmtNum(l.price, 1)}`, position: "insideTopLeft", fontSize: 8, fill: "var(--muted-foreground)" }}
                    />
                  ))}

                {/* T27 — milestone mode: 52-week high/low reference levels */}
                {isMilestones && !compareOn && data.refHigh != null && (
                  <ReferenceLine yAxisId="price" y={data.refHigh} stroke="var(--up)" strokeDasharray="4 4" opacity={0.55} label={{ value: `52w ↑ ${fmtNum(data.refHigh, 1)}`, position: "insideTopRight", fontSize: 9, fill: "var(--up)" }} />
                )}
                {isMilestones && !compareOn && data.refLow != null && (
                  <ReferenceLine yAxisId="price" y={data.refLow} stroke="var(--down)" strokeDasharray="4 4" opacity={0.55} label={{ value: `52w ↓ ${fmtNum(data.refLow, 1)}`, position: "insideBottomRight", fontSize: 9, fill: "var(--down)" }} />
                )}

                {!compareData && (
                <Area
                  yAxisId="price"
                  type="monotone"
                  dataKey="close"
                  stroke={stroke}
                  strokeWidth={2}
                  fill={`url(#pcg-${data.symbol})`}
                  isAnimationActive={false}
                  activeDot={{ r: 3.5, strokeWidth: 0 }}
                />
                )}
                {sSma50 && !compareOn && (
                  <Line
                    yAxisId="price"
                    dataKey="sma50"
                    stroke="var(--c2)"
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
                {sSma20 && (
                  <Line
                    yAxisId="price"
                    dataKey="sma20"
                    stroke="var(--c1)"
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
                {sEma20 && !compareOn && (
                  <Line
                    yAxisId="price"
                    dataKey="ema20"
                    stroke="var(--c5)"
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* overlay legend */}
          {compareData && (
            <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-3 rounded-full" style={{ background: stroke }} aria-hidden />
                <span className="num font-semibold">{symbol}</span> (100)
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-3 rounded-full" style={{ background: "var(--c4)" }} aria-hidden />
                {cmpLabel} (100)
              </span>
              <span>{tt(T.compareChartNote, lang)}</span>
            </div>
          )}
          {!compareData && activeInds.filter((d) => d.kind === "overlay").length > 0 && (
            <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
              {activeInds
                .filter((d) => d.kind === "overlay")
                .map((d) => (
                  <span key={d.key} className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-3 rounded-full" style={{ background: d.color }} aria-hidden />
                    {tt(d.t, lang)}
                  </span>
                ))}
              {sIch && (
                <>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-3 rounded-sm" style={{ background: "var(--up)", opacity: 0.25 }} aria-hidden />
                    {tt(T.ichCloud, lang)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-3 rounded-full" style={{ background: "var(--down)" }} aria-hidden />
                    {tt(T.ichSpanB, lang)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-3 rounded-full border-t border-dashed" style={{ borderColor: "var(--c7)" }} aria-hidden />
                    {tt(T.ichChikou, lang)}
                  </span>
                </>
              )}
              {useVolMa && (
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-3 rounded-full" style={{ background: "var(--c1)" }} aria-hidden />
                  {tt(T.volMaLine, lang)}
                </span>
              )}
            </div>
          )}

          {/* RSI panel */}
          {sRsi && (
            <div className="rounded-md border bg-card/50 p-2">
              <div className="flex items-center justify-between gap-2 px-1 pb-1">
                <p className="text-[11px] font-medium text-foreground/80">{tt(T.rsiTitle, lang)}</p>
                <p className="num text-[11px] text-muted-foreground">
                  {lastRsi !== null ? fmtNum(lastRsi, 1) : "—"}
                  {rsiState && (
                    <span
                      className={`ms-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        rsiState === "overbought"
                          ? "bg-down-soft text-down"
                          : rsiState === "oversold"
                            ? "bg-up-soft text-up"
                            : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {tt(
                        rsiState === "overbought"
                          ? T.rsiOverbought
                          : rsiState === "oversold"
                            ? T.rsiOversold
                            : T.rsiNeutral,
                        lang,
                      )}
                    </span>
                  )}
                </p>
              </div>
              <div style={{ height: 110 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -6 }} syncId={syncId}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" hide />
                    <YAxis
                      yAxisId="rsi"
                      domain={[0, 100]}
                      ticks={[30, 50, 70]}
                      tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      width={30}
                    />
                    <ReferenceLine yAxisId="rsi" y={70} stroke="var(--down)" strokeDasharray="3 3" opacity={0.6} />
                    <ReferenceLine yAxisId="rsi" y={50} stroke="var(--border)" opacity={0.5} />
                    <ReferenceLine yAxisId="rsi" y={30} stroke="var(--up)" strokeDasharray="3 3" opacity={0.6} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const v = payload.find((p) => p.dataKey === "rsi")?.value as number | undefined;
                        if (v === undefined || !Number.isFinite(v)) return null;
                        return (
                          <div className="rounded-md border bg-card px-3 py-1.5 text-xs shadow-md">
                            <p className="num font-semibold">{label}</p>
                            <p className="num text-muted-foreground">
                              {tt(T.rsiTitle, lang)}: <b>{fmtNum(v, 1)}</b>
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Line
                      yAxisId="rsi"
                      dataKey="rsi"
                      stroke="var(--c7)"
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* MACD panel */}
          {sMacd && (
            <div className="rounded-md border bg-card/50 p-2">
              <div className="flex items-center justify-between gap-2 px-1 pb-1 flex-wrap">
                <p className="text-[11px] font-medium text-foreground/80">{tt(T.macdTitle, lang)}</p>
                <p className="num text-[11px] text-muted-foreground">
                  {tt(T.macdLine, lang)} {lastMacd !== null ? fmtNum(lastMacd, 3) : "—"} · {tt(T.macdSignal, lang)}{" "}
                  {sMacd.signal[lastIdx] !== null && sMacd.signal[lastIdx] !== undefined
                    ? fmtNum(sMacd.signal[lastIdx], 3)
                    : "—"}
                  {sMacd.hist[lastIdx] !== null && sMacd.hist[lastIdx] !== undefined && (
                    <span className={directionClass(sMacd.hist[lastIdx]!)}> · {fmtNum(sMacd.hist[lastIdx]!, 3)}</span>
                  )}
                </p>
              </div>
              <div style={{ height: 110 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -6 }} syncId={syncId}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" hide />
                    <YAxis
                      yAxisId="macd"
                      domain={["auto", "auto"]}
                      tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      tickFormatter={(v: number) => fmtNum(v, 1)}
                    />
                    <ReferenceLine yAxisId="macd" y={0} stroke="var(--border)" />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const get = (k: string) => {
                          const v = payload.find((p) => p.dataKey === k)?.value as number | undefined;
                          return v !== undefined && Number.isFinite(v) ? v : null;
                        };
                        const m = get("macd");
                        const s = get("macdSignal");
                        const h = get("macdHist");
                        if (m === null && s === null && h === null) return null;
                        return (
                          <div className="rounded-md border bg-card px-3 py-1.5 text-xs shadow-md">
                            <p className="num font-semibold">{label}</p>
                            {m !== null && (
                              <p className="num text-muted-foreground">
                                {tt(T.macdLine, lang)}: <b style={{ color: "var(--c3)" }}>{fmtNum(m, 3)}</b>
                              </p>
                            )}
                            {s !== null && (
                              <p className="num text-muted-foreground">
                                {tt(T.macdSignal, lang)}: <b style={{ color: "var(--c6)" }}>{fmtNum(s, 3)}</b>
                              </p>
                            )}
                            {h !== null && (
                              <p className={`num ${directionClass(h)}`}>
                                {tt(T.macdHist, lang)}: {fmtNum(h, 3)}
                              </p>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Bar yAxisId="macd" dataKey="macdHist" isAnimationActive={false} opacity={0.45}>
                      {chartData.map((d, i) => (
                        <Cell key={i} fill={Number(d.macdHist ?? 0) >= 0 ? "var(--up)" : "var(--down)"} />
                      ))}
                    </Bar>
                    <Line
                      yAxisId="macd"
                      dataKey="macd"
                      stroke="var(--c3)"
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                    <Line
                      yAxisId="macd"
                      dataKey="macdSignal"
                      stroke="var(--c6)"
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* T26 — Stochastic %K/%D panel */}
          {sStoch && (
            <div className="rounded-md border bg-card/50 p-2">
              <div className="flex items-center justify-between gap-2 px-1 pb-1 flex-wrap">
                <p className="text-[11px] font-medium text-foreground/80">{tt(T.stochTitle, lang)}</p>
                <p className="num text-[11px] text-muted-foreground">
                  %K {lastStochK !== null && lastStochK !== undefined ? fmtNum(lastStochK, 1) : "—"} · %D{" "}
                  {lastStochD !== null && lastStochD !== undefined ? fmtNum(lastStochD, 1) : "—"}
                  {lastStochK != null && (
                    <span
                      className={`ms-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        lastStochK > 80 ? "bg-down-soft text-down" : lastStochK < 20 ? "bg-up-soft text-up" : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {lastStochK > 80 ? tt(T.rsiOverbought, lang) : lastStochK < 20 ? tt(T.rsiOversold, lang) : tt(T.rsiNeutral, lang)}
                    </span>
                  )}
                </p>
              </div>
              <div style={{ height: 110 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData as unknown as object[]} margin={{ top: 4, right: 8, bottom: 0, left: -6 }} syncId={syncId}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" hide />
                    <YAxis
                      yAxisId="stoch"
                      domain={[0, 100]}
                      ticks={[20, 50, 80]}
                      tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      width={30}
                    />
                    <ReferenceLine yAxisId="stoch" y={80} stroke="var(--down)" strokeDasharray="3 3" opacity={0.6} />
                    <ReferenceLine yAxisId="stoch" y={50} stroke="var(--border)" opacity={0.5} />
                    <ReferenceLine yAxisId="stoch" y={20} stroke="var(--up)" strokeDasharray="3 3" opacity={0.6} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const get = (k: string) => {
                          const v = payload.find((p) => p.dataKey === k)?.value as number | undefined;
                          return v !== undefined && Number.isFinite(v) ? v : null;
                        };
                        const k = get("stochK");
                        const d = get("stochD");
                        if (k === null && d === null) return null;
                        return (
                          <div className="rounded-md border bg-card px-3 py-1.5 text-xs shadow-md">
                            <p className="num font-semibold">{label}</p>
                            {k !== null && (
                              <p className="num text-muted-foreground">
                                %K: <b style={{ color: "var(--c3)" }}>{fmtNum(k, 1)}</b>
                              </p>
                            )}
                            {d !== null && (
                              <p className="num text-muted-foreground">
                                %D: <b style={{ color: "var(--c6)" }}>{fmtNum(d, 1)}</b>
                              </p>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Line
                      yAxisId="stoch"
                      dataKey="stochK"
                      stroke="var(--c3)"
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                    <Line
                      yAxisId="stoch"
                      dataKey="stochD"
                      stroke="var(--c6)"
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* T27 — generic oscillator/volume sub-panels. Each shares the same
              shell: header (title + last values + state chip) and a compact
              96px synced chart. Bounded ones draw their own reference lines. */}
          {sObv && (
            <div className="rounded-md border bg-card/50 p-2">
              <div className="flex items-center justify-between gap-2 px-1 pb-1">
                <p className="text-[11px] font-medium text-foreground/80">OBV {tt({ ar: "(التدفق التراكمي)", en: "(cumulative flow)" }, lang)}</p>
                <p className="num text-[11px] text-muted-foreground">{lastObv !== null && lastObv !== undefined ? fmtInt(lastObv) : "—"}</p>
              </div>
              <div style={{ height: 96 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData as unknown as object[]} margin={{ top: 4, right: 8, bottom: 0, left: -6 }} syncId={syncId}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" hide />
                    <YAxis yAxisId="obv" domain={["auto", "auto"]} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => fmtValue(v)} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        const v = payload?.find((p) => p.dataKey === "obv")?.value as number | undefined;
                        if (!active || v === undefined || !Number.isFinite(v)) return null;
                        return (
                          <div className="rounded-md border bg-card px-3 py-1.5 text-xs shadow-md">
                            <p className="num font-semibold">{label}</p>
                            <p className="num text-muted-foreground">OBV: <b>{fmtInt(v)}</b></p>
                          </div>
                        );
                      }}
                    />
                    <Line yAxisId="obv" dataKey="obv" stroke="var(--c1)" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {sMfi && (
            <div className="rounded-md border bg-card/50 p-2">
              <div className="flex items-center justify-between gap-2 px-1 pb-1 flex-wrap">
                <p className="text-[11px] font-medium text-foreground/80">MFI (14)</p>
                <p className="num text-[11px] text-muted-foreground">
                  {lastMfi !== null && lastMfi !== undefined ? fmtNum(lastMfi, 1) : "—"}
                  {lastMfi != null && (
                    <span className={`ms-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${lastMfi > 80 ? "bg-down-soft text-down" : lastMfi < 20 ? "bg-up-soft text-up" : "bg-secondary text-muted-foreground"}`}>
                      {lastMfi > 80 ? tt(T.rsiOverbought, lang) : lastMfi < 20 ? tt(T.rsiOversold, lang) : tt(T.rsiNeutral, lang)}
                    </span>
                  )}
                </p>
              </div>
              <div style={{ height: 96 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData as unknown as object[]} margin={{ top: 4, right: 8, bottom: 0, left: -6 }} syncId={syncId}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" hide />
                    <YAxis yAxisId="mfi" domain={[0, 100]} ticks={[20, 50, 80]} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={30} />
                    <ReferenceLine yAxisId="mfi" y={80} stroke="var(--down)" strokeDasharray="3 3" opacity={0.6} />
                    <ReferenceLine yAxisId="mfi" y={20} stroke="var(--up)" strokeDasharray="3 3" opacity={0.6} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        const v = payload?.find((p) => p.dataKey === "mfi")?.value as number | undefined;
                        if (!active || v === undefined || !Number.isFinite(v)) return null;
                        return (
                          <div className="rounded-md border bg-card px-3 py-1.5 text-xs shadow-md">
                            <p className="num font-semibold">{label}</p>
                            <p className="num text-muted-foreground">MFI: <b>{fmtNum(v, 1)}</b></p>
                          </div>
                        );
                      }}
                    />
                    <Line yAxisId="mfi" dataKey="mfi" stroke="var(--c6)" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {sAtr && (
            <div className="rounded-md border bg-card/50 p-2">
              <div className="flex items-center justify-between gap-2 px-1 pb-1">
                <p className="text-[11px] font-medium text-foreground/80">ATR (14) — {tt({ ar: "التقلب بالجنيه", en: "volatility in EGP" }, lang)}</p>
                <p className="num text-[11px] text-muted-foreground">
                  {lastAtr !== null && lastAtr !== undefined ? fmtNum(lastAtr, 2) : "—"}
                  {lastAtr != null && data.last != null && data.last > 0 && (
                    <span className="ms-1 text-muted-foreground">({fmtNum((lastAtr / data.last) * 100, 1)}%)</span>
                  )}
                </p>
              </div>
              <div style={{ height: 96 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData as unknown as object[]} margin={{ top: 4, right: 8, bottom: 0, left: -6 }} syncId={syncId}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" hide />
                    <YAxis yAxisId="atr" domain={["auto", "auto"]} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => fmtNum(v, 1)} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        const v = payload?.find((p) => p.dataKey === "atr")?.value as number | undefined;
                        if (!active || v === undefined || !Number.isFinite(v)) return null;
                        return (
                          <div className="rounded-md border bg-card px-3 py-1.5 text-xs shadow-md">
                            <p className="num font-semibold">{label}</p>
                            <p className="num text-muted-foreground">ATR: <b>{fmtNum(v, 2)}</b></p>
                          </div>
                        );
                      }}
                    />
                    <Line yAxisId="atr" dataKey="atr" stroke="var(--c5)" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {sAdx && (
            <div className="rounded-md border bg-card/50 p-2">
              <div className="flex items-center justify-between gap-2 px-1 pb-1 flex-wrap">
                <p className="text-[11px] font-medium text-foreground/80">ADX (14) {tt({ ar: "— قوة الاتجاه", en: "— trend strength" }, lang)}</p>
                <p className="num text-[11px] text-muted-foreground">
                  {lastAdx !== null && lastAdx !== undefined ? fmtNum(lastAdx, 1) : "—"}
                  {lastAdx != null && (
                    <span className={`ms-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${lastAdx >= 25 ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"}`}>
                      {lastAdx >= 25 ? tt({ ar: "اتجاه قوي", en: "strong trend" }, lang) : tt({ ar: "ضعيف/عرضي", en: "weak/ranging" }, lang)}
                    </span>
                  )}
                </p>
              </div>
              <div style={{ height: 96 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData as unknown as object[]} margin={{ top: 4, right: 8, bottom: 0, left: -6 }} syncId={syncId}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" hide />
                    <YAxis yAxisId="adx" domain={[0, "auto"]} ticks={[20, 40]} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={30} />
                    <ReferenceLine yAxisId="adx" y={25} stroke="var(--primary)" strokeDasharray="3 3" opacity={0.5} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        const get = (k: string) => {
                          const v = payload?.find((p) => p.dataKey === k)?.value as number | undefined;
                          return v !== undefined && Number.isFinite(v) ? v : null;
                        };
                        const a = get("adx");
                        const p = get("adxPdi");
                        const m = get("adxMdi");
                        if (!active || (a === null && p === null && m === null)) return null;
                        return (
                          <div className="rounded-md border bg-card px-3 py-1.5 text-xs shadow-md">
                            <p className="num font-semibold">{label}</p>
                            {a !== null && <p className="num text-muted-foreground">ADX: <b style={{ color: "var(--c3)" }}>{fmtNum(a, 1)}</b></p>}
                            {p !== null && <p className="num text-muted-foreground">+DI: <b className="text-up">{fmtNum(p, 1)}</b></p>}
                            {m !== null && <p className="num text-muted-foreground">−DI: <b className="text-down">{fmtNum(m, 1)}</b></p>}
                          </div>
                        );
                      }}
                    />
                    <Line yAxisId="adx" dataKey="adx" stroke="var(--c3)" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                    <Line yAxisId="adx" dataKey="adxPdi" stroke="var(--up)" strokeWidth={1} dot={false} connectNulls isAnimationActive={false} />
                    <Line yAxisId="adx" dataKey="adxMdi" stroke="var(--down)" strokeWidth={1} dot={false} connectNulls isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {sWpr && (
            <div className="rounded-md border bg-card/50 p-2">
              <div className="flex items-center justify-between gap-2 px-1 pb-1">
                <p className="text-[11px] font-medium text-foreground/80">Williams %R (14)</p>
                <p className="num text-[11px] text-muted-foreground">{lastWpr !== null && lastWpr !== undefined ? fmtNum(lastWpr, 1) : "—"}</p>
              </div>
              <div style={{ height: 96 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData as unknown as object[]} margin={{ top: 4, right: 8, bottom: 0, left: -6 }} syncId={syncId}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" hide />
                    <YAxis yAxisId="wpr" domain={[-100, 0]} ticks={[-80, -50, -20]} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={30} />
                    <ReferenceLine yAxisId="wpr" y={-80} stroke="var(--up)" strokeDasharray="3 3" opacity={0.6} />
                    <ReferenceLine yAxisId="wpr" y={-20} stroke="var(--down)" strokeDasharray="3 3" opacity={0.6} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        const v = payload?.find((p) => p.dataKey === "wpr")?.value as number | undefined;
                        if (!active || v === undefined || !Number.isFinite(v)) return null;
                        return (
                          <div className="rounded-md border bg-card px-3 py-1.5 text-xs shadow-md">
                            <p className="num font-semibold">{label}</p>
                            <p className="num text-muted-foreground">%R: <b>{fmtNum(v, 1)}</b></p>
                          </div>
                        );
                      }}
                    />
                    <Line yAxisId="wpr" dataKey="wpr" stroke="var(--c4)" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {sCci && (
            <div className="rounded-md border bg-card/50 p-2">
              <div className="flex items-center justify-between gap-2 px-1 pb-1">
                <p className="text-[11px] font-medium text-foreground/80">CCI (20)</p>
                <p className="num text-[11px] text-muted-foreground">
                  {lastCci !== null && lastCci !== undefined ? fmtNum(lastCci, 1) : "—"}
                  {lastCci != null && (
                    <span className={`ms-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${lastCci > 100 ? "bg-down-soft text-down" : lastCci < -100 ? "bg-up-soft text-up" : "bg-secondary text-muted-foreground"}`}>
                      {lastCci > 100 ? tt({ ar: "تشبع شرائي", en: "overbought" }, lang) : lastCci < -100 ? tt({ ar: "تشبع بيعي", en: "oversold" }, lang) : tt(T.rsiNeutral, lang)}
                    </span>
                  )}
                </p>
              </div>
              <div style={{ height: 96 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData as unknown as object[]} margin={{ top: 4, right: 8, bottom: 0, left: -6 }} syncId={syncId}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" hide />
                    <YAxis yAxisId="cci" domain={["auto", "auto"]} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => fmtNum(v, 0)} />
                    <ReferenceLine yAxisId="cci" y={0} stroke="var(--border)" />
                    <ReferenceLine yAxisId="cci" y={100} stroke="var(--down)" strokeDasharray="3 3" opacity={0.5} />
                    <ReferenceLine yAxisId="cci" y={-100} stroke="var(--up)" strokeDasharray="3 3" opacity={0.5} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        const v = payload?.find((p) => p.dataKey === "cci")?.value as number | undefined;
                        if (!active || v === undefined || !Number.isFinite(v)) return null;
                        return (
                          <div className="rounded-md border bg-card px-3 py-1.5 text-xs shadow-md">
                            <p className="num font-semibold">{label}</p>
                            <p className="num text-muted-foreground">CCI: <b>{fmtNum(v, 1)}</b></p>
                          </div>
                        );
                      }}
                    />
                    <Line yAxisId="cci" dataKey="cci" stroke="var(--c2)" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}

      {/* provenance */}
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        {data.warming ? `${tt(T.chartWarming, lang)} ` : ""}
        {tt(T.priceChartNote, lang)} — {data.source}
        {(activeInds.length > 0 || useVolMa) && ` · ${tt(T.indNote, lang)}`}
      </p>
    </div>
  );
}
