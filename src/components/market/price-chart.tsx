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
import { smaSeries, emaFull, emaSparse, bollingerSeries, rsiSeries, macdSeries } from "@/lib/indicators";
import { Skeleton } from "@/components/ui/skeleton";

/** Real price chart for one stock or index, with range switching and
 *  client-computed technical indicators (SMA/EMA/Bollinger overlays,
 *  RSI and MACD panels, volume MA). Data comes from /api/chart (Yahoo
 *  candles for stocks, persisted EGX session closes for indices).
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
};

const RANGE_LABELS: Record<string, { ar: string; en: string }> = {
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

type IndKey = "sma20" | "sma50" | "ema20" | "bb" | "volma" | "rsi" | "macd";

const INDICATORS: { key: IndKey; t: { ar: string; en: string }; color: string; kind: "overlay" | "sub" }[] = [
  { key: "sma20", t: T.indSma20, color: "var(--c1)", kind: "overlay" },
  { key: "sma50", t: T.indSma50, color: "var(--c2)", kind: "overlay" },
  { key: "ema20", t: T.indEma20, color: "var(--c5)", kind: "overlay" },
  { key: "bb", t: T.indBb, color: "var(--c4)", kind: "overlay" },
  { key: "rsi", t: T.indRsi, color: "var(--c7)", kind: "sub" },
  { key: "macd", t: T.indMacd, color: "var(--c3)", kind: "sub" },
];

/** G8 — comparison overlay options: the three headline indices, rebased to
 *  100 at the window start (stock-vs-stock lives in the Compare view). */
const COMPARE_OPTIONS: { key: string; ar: string; en: string }[] = [
  { key: "EGX30", ar: "إيجي إكس ٣٠", en: "EGX 30" },
  { key: "EGX70", ar: "إيجي إكس ٧٠", en: "EGX 70" },
  { key: "EGX100", ar: "إيجي إكس ١٠٠", en: "EGX 100" },
];

/** G19 — trendline segments persisted per symbol on the device. */
type Seg = { a: { x: string; y: number }; b: { x: string; y: number } };
const LINES_KEY = "egx-trendlines";

function loadLines(symbol: string): Seg[] {
  try {
    const raw = localStorage.getItem(LINES_KEY);
    if (!raw) return [];
    const map = JSON.parse(raw) as Record<string, Seg[] | undefined>;
    const arr = map?.[symbol];
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (s) => s && s.a && s.b && typeof s.a.x === "string" && Number.isFinite(s.a.y) && typeof s.b.x === "string" && Number.isFinite(s.b.y)
    );
  } catch {
    return [];
  }
}

function saveLines(symbol: string, segs: Seg[]): void {
  try {
    const raw = localStorage.getItem(LINES_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, Seg[]>) : {};
    map[symbol] = segs;
    localStorage.setItem(LINES_KEY, JSON.stringify(map));
  } catch {}
}

export function PriceChart({ symbol, defaultRange = "6M" }: { symbol: string; defaultRange?: string }) {
  const { lang } = useApp();
  const [range, setRange] = useState(defaultRange);
  const [data, setData] = useState<ChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [inds, setInds] = useState<Record<IndKey, boolean>>({
    sma20: true,
    sma50: false,
    ema20: false,
    bb: false,
    volma: false,
    rsi: false,
    macd: false,
  });
  // G8: chart modes
  const [logScale, setLogScale] = useState(false);
  const [compare, setCompare] = useState<string>("none");
  const [cmpData, setCmpData] = useState<ChartResponse | null>(null);
  const [cmpNote, setCmpNote] = useState<string | null>(null);
  // G19: trendline drawing
  const [drawMode, setDrawMode] = useState(false);
  const [pending, setPending] = useState<{ x: string; y: number } | null>(null);
  const [segments, setSegments] = useState<Seg[]>([]);
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

  // G19 — restore this symbol's trendlines after mount (SSR-safe)
  useEffect(() => {
    setSegments(loadLines(symbol));
    setPending(null);
    setDrawMode(false);
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
  const canRsi = n >= 15;
  const canMacd = n >= 36;
  const canVolMa = showVolume && n >= 21;
  const avail: Record<IndKey, boolean> = {
    sma20: canOverlay,
    sma50: canOverlay,
    ema20: canOverlay,
    bb: canOverlay,
    volma: canVolMa,
    rsi: canRsi,
    macd: canMacd,
  };
  const anyAvail = Object.values(avail).some(Boolean);
  const activeInds = INDICATORS.filter((d) => inds[d.key] && avail[d.key]);
  const useVolMa = inds.volma && canVolMa;
  const showVolMaToggle = showVolume && n >= 21; // toggle visible whenever volume + length allow

  // compute series
  const closes = points.map((p) => p.close);
  const sSma20 = inds.sma20 && canOverlay ? smaSeries(closes, 20) : null;
  const sSma50 = inds.sma50 && canOverlay ? smaSeries(closes, 50) : null;
  const sEma20 = inds.ema20 && canOverlay ? emaFull(closes, 20) : null;
  const sBb = inds.bb && canOverlay ? bollingerSeries(closes, 20, 2) : null;
  const sRsi = inds.rsi && canRsi ? rsiSeries(closes, 14) : null;
  const sMacd = inds.macd && canMacd ? macdSeries(closes) : null;
  const sVolMa = useVolMa
    ? smaSeries(
        points.map((p) => (typeof p.volume === "number" ? p.volume : 0)),
        20,
      )
    : null;

  const chartData = points.map((p, i) => ({
    date: p.date.slice(2), // YY-MM-DD compact tick label
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
  }));

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

  // trendline click capture (G19): snaps to the session under the cursor
  const handleChartClick = (state: { activeLabel?: string; activeTooltipIndex?: number }) => {
    if (!drawMode || compareOn) return;
    const idx = state.activeTooltipIndex;
    if (idx == null || idx < 0 || idx >= chartData.length) return;
    const row = chartData[idx];
    const y = row.close;
    if (typeof y !== "number" || !Number.isFinite(y)) return;
    const point = { x: row.date, y };
    if (!pending) {
      setPending(point);
    } else {
      const next = [...segments, { a: pending, b: point }];
      setSegments(next);
      saveLines(symbol, next);
      setPending(null);
      setDrawMode(false);
    }
  };

  const syncId = `pc-${data.symbol}-${data.range}`;
  const lastIdx = n - 1;
  const lastRsi = sRsi ? sRsi[lastIdx] : null;
  const lastMacd = sMacd ? sMacd.macd[lastIdx] : null;

  // tooltip overlay rows for enabled indicators
  const tipExtras: { key: string; label: string; color: string; fmt: (v: number) => string }[] = [];
  if (sSma20) tipExtras.push({ key: "sma20", label: tt(T.indSma20, lang), color: "var(--c1)", fmt: (v) => fmtNum(v) });
  if (sSma50) tipExtras.push({ key: "sma50", label: tt(T.indSma50, lang), color: "var(--c2)", fmt: (v) => fmtNum(v) });
  if (sEma20) tipExtras.push({ key: "ema20", label: tt(T.indEma20, lang), color: "var(--c5)", fmt: (v) => fmtNum(v) });
  if (sBb) {
    tipExtras.push({ key: "bbUp", label: `BB ↑`, color: "var(--c4)", fmt: (v) => fmtNum(v) });
    tipExtras.push({ key: "bbLo", label: `BB ↓`, color: "var(--c4)", fmt: (v) => fmtNum(v) });
  }
  if (sVolMa)
    tipExtras.push({ key: "volMa", label: tt(T.volMaLine, lang), color: "var(--c1)", fmt: (v) => fmtInt(v) });

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
              onClick={() => setRange(r)}
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
          aria-label={tt(T.compareChartLabel, lang)}
          title={tt(T.compareChartNote, lang)}
          className="h-7 rounded-md border bg-card px-1.5 text-[11px] text-foreground"
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

      {/* indicator toggles + trendline tools (G19) */}
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
          <button
            onClick={() => {
              setDrawMode((v) => !v);
              setPending(null);
            }}
            aria-pressed={drawMode}
            disabled={compareOn}
            title={compareOn ? tt(T.compareChartNote, lang) : tt(T.drawModeHint, lang)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
              drawMode
                ? "bg-primary/15 font-semibold border-primary/40 text-primary"
                : "text-muted-foreground hover:bg-accent/50"
            } ${compareOn ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            {tt(T.drawTrendline, lang)}
            {pending && <span className="num text-[9px] text-primary">·١</span>}
          </button>
          {segments.length > 0 && (
            <button
              onClick={() => {
                setSegments([]);
                saveLines(symbol, []);
              }}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/50"
              title={tt(T.clearDrawings, lang)}
            >
              {tt(T.clearDrawings, lang)} ({segments.length})
            </button>
          )}
          {drawMode && <span className="text-[10px] text-primary">{tt(T.drawModeHint, lang)}</span>}
          {!anyAvail && !compareOn && (
            <span className="text-[10px] text-muted-foreground">{tt(T.indNotEnough, lang)}</span>
          )}
        </div>
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
                data={(compareData as unknown as object[] | null) ?? chartData}
                margin={{ top: 8, right: 8, bottom: 0, left: -6 }}
                syncId={syncId}
                onClick={(state) => handleChartClick(state as { activeLabel?: string; activeTooltipIndex?: number })}
                style={drawMode ? { cursor: "crosshair" } : undefined}
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

                {/* G19 — persistent trendlines (price mode only) */}
                {!compareData &&
                  segments.map((s, i) => (
                    <ReferenceLine
                      key={`seg-${i}`}
                      yAxisId="price"
                      segment={[{ x: s.a.x, y: s.a.y }, { x: s.b.x, y: s.b.y }]}
                      stroke="var(--c5)"
                      strokeWidth={1.5}
                      ifOverflow="extendDomain"
                    />
                  ))}
                {!compareData && pending && (
                  <ReferenceLine
                    yAxisId="price"
                    x={pending.x}
                    stroke="var(--c5)"
                    strokeWidth={1}
                    strokeDasharray="2 2"
                  />
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
                        <Cell key={i} fill={(d.macdHist ?? 0) >= 0 ? "var(--up)" : "var(--down)"} />
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
