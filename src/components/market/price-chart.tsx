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
import { Skeleton } from "@/components/ui/skeleton";

/** Real price chart for one stock or index, with range switching and
 *  client-computed technical indicators (SMA/EMA/Bollinger overlays,
 *  RSI and MACD panels, volume MA). Data comes from /api/chart (Yahoo
 *  candles for stocks, persisted EGX session closes for indices).
 *  Chart canvas is LTR; labels are bilingual. Remount per symbol. */

type ChartPoint = { date: string; close: number; volume: number | null };

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

// ── indicator math (standard definitions, computed client-side) ──

function smaSeries(v: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= n) sum -= v[i - n];
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}

function emaFull(v: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(v.length).fill(null);
  if (v.length < n) return out;
  const k = 2 / (n + 1);
  let seed = 0;
  for (let i = 0; i < n; i++) seed += v[i];
  let prev = seed / n;
  out[n - 1] = prev;
  for (let i = n; i < v.length; i++) {
    prev = v[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** EMA over a series that may start with nulls (MACD line). */
function emaSparse(v: (number | null)[], n: number): (number | null)[] {
  const idx: number[] = [];
  const vals: number[] = [];
  v.forEach((x, i) => {
    if (x !== null && x !== undefined && Number.isFinite(x)) {
      idx.push(i);
      vals.push(x);
    }
  });
  const out: (number | null)[] = new Array(v.length).fill(null);
  if (vals.length < n) return out;
  const k = 2 / (n + 1);
  let seed = 0;
  for (let j = 0; j < n; j++) seed += vals[j];
  let prev = seed / n;
  out[idx[n - 1]] = prev;
  for (let j = n; j < vals.length; j++) {
    prev = vals[j] * k + prev * (1 - k);
    out[idx[j]] = prev;
  }
  return out;
}

function bollingerSeries(v: number[], n = 20, k = 2) {
  const mid: (number | null)[] = [];
  const up: (number | null)[] = [];
  const lo: (number | null)[] = [];
  for (let i = 0; i < v.length; i++) {
    if (i < n - 1) {
      mid.push(null);
      up.push(null);
      lo.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - n + 1; j <= i; j++) sum += v[j];
    const m = sum / n;
    let sq = 0;
    for (let j = i - n + 1; j <= i; j++) sq += (v[j] - m) ** 2;
    const sd = Math.sqrt(sq / n);
    mid.push(m);
    up.push(m + k * sd);
    lo.push(m - k * sd);
  }
  return { mid, up, lo };
}

function rsiSeries(v: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = new Array(v.length).fill(null);
  if (v.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const ch = v[i] - v[i - 1];
    gain += Math.max(ch, 0) / n;
    loss += Math.max(-ch, 0) / n;
  }
  const rsi = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  out[n] = rsi(gain, loss);
  for (let i = n + 1; i < v.length; i++) {
    const ch = v[i] - v[i - 1];
    gain = (gain * (n - 1) + Math.max(ch, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-ch, 0)) / n;
    out[i] = rsi(gain, loss);
  }
  return out;
}

function macdSeries(v: number[], fast = 12, slow = 26, sig = 9) {
  const ef = emaFull(v, fast);
  const es = emaFull(v, slow);
  const macd: (number | null)[] = [];
  for (let i = 0; i < v.length; i++) {
    const a = ef[i];
    const b = es[i];
    macd.push(a !== null && b !== null ? a - b : null);
  }
  const signal = emaSparse(macd, sig);
  const hist: (number | null)[] = [];
  for (let i = 0; i < v.length; i++) {
    const m = macd[i];
    const s = signal[i];
    hist.push(m !== null && s !== null ? m - s : null);
  }
  return { macd, signal, hist };
}

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

      {/* range buttons */}
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
        {data.asOf && <span className="num ms-auto text-[10px] text-muted-foreground">{data.asOf}</span>}
      </div>

      {/* indicator toggles */}
      {points.length >= 2 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-medium text-muted-foreground me-1">{tt(T.indicatorsLabel, lang)}:</span>
          {INDICATORS.map((d) => {
            const on = inds[d.key];
            const ok = avail[d.key];
            return (
              <button
                key={d.key}
                onClick={() => ok && setInds((s) => ({ ...s, [d.key]: !s[d.key] }))}
                disabled={!ok}
                title={ok ? undefined : tt(T.indNotEnough, lang)}
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
          {showVolMaToggle && (
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
          {!anyAvail && (
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
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -6 }} syncId={syncId}>
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
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(v: number) => fmtNum(v, 1)}
                />
                {showVolume && (
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
                    if (close === null && vol === null) return null;
                    return (
                      <div className="rounded-md border bg-card px-3 py-1.5 text-xs shadow-md max-w-[220px]">
                        <p className="num font-semibold">{label}</p>
                        {close !== null && (
                          <p className="num text-muted-foreground">
                            {tt(T.close, lang)}: <b className={up ? "text-up" : "text-down"}>{fmtNum(close)}</b>
                            {data.currency === "EGP" && " EGP"}
                          </p>
                        )}
                        {vol !== null && (
                          <p className="num text-muted-foreground">
                            {tt(T.volume, lang)}: {fmtInt(vol)}
                          </p>
                        )}
                        {tipExtras.map((e) => {
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
                {showVolume && (
                  <Bar yAxisId="vol" dataKey="volume" fill="var(--muted-foreground)" opacity={0.25} isAnimationActive={false} />
                )}
                {useVolMa && (
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
                {sBb && (
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
                {sBb && (
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
                {sBb && (
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
                {sSma50 && (
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
                {sEma20 && (
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
          {activeInds.filter((d) => d.kind === "overlay").length > 0 && (
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
