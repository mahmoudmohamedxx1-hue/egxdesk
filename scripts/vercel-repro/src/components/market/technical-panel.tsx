"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { useApp } from "./app-context";
import { T, tt } from "@/lib/i18n";
import { fmtNum, fmtPct, directionClass } from "@/lib/format";
import {
  smaSeries,
  emaFull,
  rsiSeries,
  macdSeries,
  stochasticSeries,
  cciSeries,
  momentumSeries,
  williamsRSeries,
  bullBearSeries,
  classicPivots,
  aggregateSignals,
  atrSeries,
  adxSeries,
  obvSeries,
  mfiSeries,
  stochRsiSeries,
  psarSeries,
  superTrendSeries,
  donchianSeries,
  awesomeSeries,
  trixSeries,
  cmoSeries,
  rocSeries,
  ultimateOscSeries,
  aroonSeries,
  ichimokuSeries,
  bollingerSeries,
  type Signal,
} from "@/lib/indicators";
import { Skeleton } from "@/components/ui/skeleton";

/** Investing.com-style technical analysis for one stock, computed entirely
 *  client-side from the last year of daily candles (/api/chart). Shows a
 *  summary rating gauge (Strong Sell → Strong Buy) over 30+ rated indicators
 *  (moving averages + oscillators, including the T26 advanced set: Ichimoku
 *  lines, ADX, Stoch RSI, CMO, ROC, MFI, OBV, Awesome, TRIX, Ultimate
 *  Oscillator), a volatility & trend-strength strip (ATR, ADX, SuperTrend,
 *  PSAR, Donchian/Keltner position), classic pivot levels from the last
 *  session's real H/L/C, and a rebased stock-vs-EGX30 comparison chart. */

type ChartPoint = { date: string; close: number; volume: number | null; high?: number | null; low?: number | null };

type ChartResponse = {
  symbol: string;
  kind: "stock" | "index";
  range: string;
  currency: string;
  points: ChartPoint[];
  error?: string;
};

type IndicatorRow = {
  name: { ar: string; en: string };
  value: number | null;
  fmt: (v: number) => string;
  signal: Signal;
};

const SIGNAL_CLS: Record<Signal, string> = {
  buy: "text-up bg-up-soft",
  sell: "text-down bg-down-soft",
  neutral: "text-muted-foreground bg-secondary",
};

function lastOf(series: (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) return v;
  }
  return null;
}

// ── rating gauge (SVG semicircle, LTR canvas) ──

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

function RatingGauge({ score, label }: { score: number; label: string }) {
  const cx = 110;
  const cy = 104;
  const r = 86;
  // segments from 180° (strong sell, left) to 0° (strong buy, right)
  const SEGMENTS: { from: number; to: number; fill: string; opacity: number }[] = [
    { from: 144, to: 180, fill: "var(--down)", opacity: 1 }, // strong sell
    { from: 108, to: 144, fill: "var(--down)", opacity: 0.55 }, // sell
    { from: 72, to: 108, fill: "var(--muted-foreground)", opacity: 0.4 }, // neutral
    { from: 36, to: 72, fill: "var(--up)", opacity: 0.55 }, // buy
    { from: 0, to: 36, fill: "var(--up)", opacity: 1 }, // strong buy
  ];
  const needleDeg = 90 + score * 90; // score -1 → 0°, +1 → 180°
  const needle = polar(cx, cy, r - 14, needleDeg);
  const needleBase = polar(cx, cy, 12, needleDeg + 180);
  const rating =
    score > 0.5 ? "text-up" : score > 0.1 ? "text-up" : score < -0.5 ? "text-down" : score < -0.1 ? "text-down" : "text-muted-foreground";

  return (
    <div className="flex flex-col items-center" dir="ltr">
      <svg viewBox="0 0 220 118" className="w-56 sm:w-64" role="img" aria-label={label}>
        {SEGMENTS.map((s, i) => {
          const a = polar(cx, cy, r, s.from);
          const b = polar(cx, cy, r, s.to);
          return (
            <path
              key={i}
              d={`M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`}
              fill="none"
              stroke={s.fill}
              strokeOpacity={s.opacity}
              strokeWidth={13}
              strokeLinecap={i === 0 || i === SEGMENTS.length - 1 ? "butt" : "butt"}
            />
          );
        })}
        {/* needle */}
        <line
          x1={needleBase.x}
          y1={needleBase.y}
          x2={needle.x}
          y2={needle.y}
          stroke="var(--foreground)"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={6} fill="var(--card)" stroke="var(--foreground)" strokeWidth={2} />
        {/* min/max ticks */}
        <text x={16} y={116} fontSize={9} fill="var(--muted-foreground)" textAnchor="start">
          -1
        </text>
        <text x={204} y={116} fontSize={9} fill="var(--muted-foreground)" textAnchor="end">
          +1
        </text>
      </svg>
      <p className={`-mt-1 text-lg font-bold ${rating}`} dir="auto">
        {label}
      </p>
    </div>
  );
}

// ── indicator tables ──

function IndicatorTable({
  title,
  rows,
  lang,
}: {
  title: string;
  rows: IndicatorRow[];
  lang: "ar" | "en";
}) {
  return (
    <div className="rounded-md border overflow-hidden">
      <p className="bg-secondary/60 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">{title}</p>
      <table className="w-full text-xs">
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.name.en} className="hover:bg-accent/30 transition-colors">
              <td className="px-3 py-1.5 text-start">{tt(row.name, lang)}</td>
              <td className="num px-3 py-1.5 text-end font-medium">{row.value !== null ? row.fmt(row.value) : "—"}</td>
              <td className="px-2.5 py-1.5 text-end">
                <span
                  className={`inline-block min-w-[3.2rem] rounded-sm px-1.5 py-0.5 text-[10px] font-semibold text-center ${SIGNAL_CLS[row.signal]}`}
                >
                  {tt(row.signal === "buy" ? T.techBuy : row.signal === "sell" ? T.techSell : T.techNeutral, lang)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── main panel ──

export function TechnicalPanel({ ticker }: { ticker: string }) {
  const { lang } = useApp();
  const [stock, setStock] = useState<ChartResponse | null>(null);
  const [index, setIndex] = useState<ChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const load = async () => {
      try {
        const [a, b] = await Promise.all([
          fetch(`/api/chart?symbol=${encodeURIComponent(ticker)}&range=1Y`, { cache: "no-store" }).then((r) => r.json() as Promise<ChartResponse>),
          fetch(`/api/chart?symbol=EGX30&range=1Y`, { cache: "no-store" })
            .then((r) => r.json() as Promise<ChartResponse>)
            .catch(() => null),
        ]);
        if (cancelled) return;
        if (a.error || !a.points || a.points.length < 30) {
          setError(a.error ?? "not enough data");
          setStock(null);
        } else {
          setStock(a);
          setError(null);
        }
        setIndex(b && !b.error && b.points ? b : null);
      } catch {
        if (!cancelled) setError("chart unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [ticker]);

  // ── indicator computation (memoized) ──
  const analysis = useMemo(() => {
    if (!stock) return null;
    const pts = stock.points;
    const closes = pts.map((p) => p.close);
    const highs = pts.map((p) => p.high ?? null);
    const lows = pts.map((p) => p.low ?? null);
    const vols = pts.map((p) => (typeof p.volume === "number" ? p.volume : null));
    const price = closes[closes.length - 1];
    const hasVolume = vols.some((v) => v !== null && v !== undefined && Number.isFinite(v));

    const sma20 = lastOf(smaSeries(closes, 20));
    const sma50 = lastOf(smaSeries(closes, 50));
    const sma100 = lastOf(smaSeries(closes, 100));
    const sma200 = lastOf(smaSeries(closes, 200));
    const ema20 = lastOf(emaFull(closes, 20));
    const ema50 = lastOf(emaFull(closes, 50));
    const ema100 = lastOf(emaFull(closes, 100));
    const ema200 = lastOf(emaFull(closes, 200));
    const rsi = lastOf(rsiSeries(closes, 14));
    const stoch = stochasticSeries(highs, lows, closes, 14, 3, 3);
    const stochK = lastOf(stoch.k);
    const stochD = lastOf(stoch.d);
    const macd = macdSeries(closes);
    const macdHist = lastOf(macd.hist);
    const macdLine = lastOf(macd.macd);
    const cci = lastOf(cciSeries(highs, lows, closes, 20));
    const mom = lastOf(momentumSeries(closes, 10));
    const wr = lastOf(williamsRSeries(highs, lows, closes, 14));
    const bbp = lastOf(bullBearSeries(closes, 13));

    // T26 advanced set
    const ich = ichimokuSeries(highs, lows, closes, 9, 26, 52, 26);
    const tenkan = lastOf(ich.tenkan);
    const kijun = lastOf(ich.kijun);
    const stochRsi = stochRsiSeries(closes, 14, 14, 3, 3);
    const stochRsiK = lastOf(stochRsi.k);
    const adx = adxSeries(highs, lows, closes, 14);
    const adxLast = lastOf(adx.adx);
    const pdi = lastOf(adx.pdi);
    const mdi = lastOf(adx.mdi);
    const cmo = lastOf(cmoSeries(closes, 14));
    const roc = lastOf(rocSeries(closes, 12));
    const uo = lastOf(ultimateOscSeries(highs, lows, closes));
    const ao = lastOf(awesomeSeries(highs, lows, closes));
    const trix = trixSeries(closes, 15, 9);
    const trixLast = lastOf(trix.trix);
    const trixSig = lastOf(trix.signal);
    const mfi = hasVolume ? lastOf(mfiSeries(highs, lows, closes, vols, 14)) : null;
    const obv = hasVolume ? obvSeries(closes, vols) : null;
    // OBV signal = direction vs 10 bars ago
    let obvSlope: number | null = null;
    if (obv) {
      const o = obv[obv.length - 1];
      const p10 = obv[Math.max(0, obv.length - 11)];
      if (o !== null && p10 !== null) obvSlope = o - p10;
    }

    // volatility & trend-strength strip (informational, not rated)
    const atr = lastOf(atrSeries(highs, lows, closes, 14));
    const atrPct = atr !== null && price > 0 ? (atr / price) * 100 : null;
    const bb = bollingerSeries(closes, 20, 2);
    const bbUp = lastOf(bb.up);
    const bbLo = lastOf(bb.lo);
    const bbWidthPct =
      bbUp !== null && bbLo !== null && bbUp + bbLo > 0 ? ((bbUp - bbLo) / ((bbUp + bbLo) / 2)) * 100 : null;
    const dc = donchianSeries(highs, lows, closes, 20);
    const dcPos =
      dc.up.length && dc.up[dc.up.length - 1] !== null && dc.lo[dc.lo.length - 1] !== null && price > 0
        ? (price - (dc.lo[dc.lo.length - 1] as number)) /
          Math.max(1e-9, (dc.up[dc.up.length - 1] as number) - (dc.lo[dc.lo.length - 1] as number))
        : null;
    const psar = lastOf(psarSeries(highs, lows, closes));
    const st = superTrendSeries(highs, lows, closes, 10, 3);
    const stTrend = lastOf(st.trend);
    const ar = aroonSeries(highs, lows, closes, 14);
    const aroonUp = lastOf(ar.up);
    const aroonDn = lastOf(ar.down);

    // last session's real H/L/C for pivots
    const lastCandle = pts[pts.length - 1];
    const hasHL = lastCandle.high != null && lastCandle.low != null;

    const maSignal = (v: number | null): Signal =>
      v === null ? "neutral" : price > v ? "buy" : price < v ? "sell" : "neutral";

    const maRows: IndicatorRow[] = [
      { name: { ar: "متوسط ٢٠ جلسة SMA", en: "SMA 20" }, value: sma20, fmt: (v) => fmtNum(v), signal: maSignal(sma20) },
      { name: { ar: "متوسط ٥٠ جلسة SMA", en: "SMA 50" }, value: sma50, fmt: (v) => fmtNum(v), signal: maSignal(sma50) },
      { name: { ar: "متوسط ١٠٠ جلسة SMA", en: "SMA 100" }, value: sma100, fmt: (v) => fmtNum(v), signal: maSignal(sma100) },
      { name: { ar: "متوسط ٢٠٠ جلسة SMA", en: "SMA 200" }, value: sma200, fmt: (v) => fmtNum(v), signal: maSignal(sma200) },
      { name: { ar: "متوسط ٢٠ جلسة EMA", en: "EMA 20" }, value: ema20, fmt: (v) => fmtNum(v), signal: maSignal(ema20) },
      { name: { ar: "متوسط ٥٠ جلسة EMA", en: "EMA 50" }, value: ema50, fmt: (v) => fmtNum(v), signal: maSignal(ema50) },
      { name: { ar: "متوسط ١٠٠ جلسة EMA", en: "EMA 100" }, value: ema100, fmt: (v) => fmtNum(v), signal: maSignal(ema100) },
      { name: { ar: "متوسط ٢٠٠ جلسة EMA", en: "EMA 200" }, value: ema200, fmt: (v) => fmtNum(v), signal: maSignal(ema200) },
      { name: T.ichTenkan, value: tenkan, fmt: (v) => fmtNum(v), signal: maSignal(tenkan) },
      { name: T.ichKijun, value: kijun, fmt: (v) => fmtNum(v), signal: maSignal(kijun) },
    ];

    const oscRows: IndicatorRow[] = [
      {
        name: { ar: "القوة النسبية RSI (١٤)", en: "RSI (14)" },
        value: rsi,
        fmt: (v) => fmtNum(v, 1),
        signal: rsi === null ? "neutral" : rsi < 30 ? "buy" : rsi > 70 ? "sell" : "neutral",
      },
      {
        name: T.stochK,
        value: stochK,
        fmt: (v) => fmtNum(v, 1),
        signal: stochK === null ? "neutral" : stochK < 20 ? "buy" : stochK > 80 ? "sell" : "neutral",
      },
      {
        name: T.stochD,
        value: stochD,
        fmt: (v) => fmtNum(v, 1),
        signal: stochD === null ? "neutral" : stochD < 20 ? "buy" : stochD > 80 ? "sell" : "neutral",
      },
      {
        name: T.stochRsiName,
        value: stochRsiK,
        fmt: (v) => fmtNum(v, 1),
        signal: stochRsiK === null ? "neutral" : stochRsiK < 20 ? "buy" : stochRsiK > 80 ? "sell" : "neutral",
      },
      {
        name: { ar: "ماكد MACD (١٢، ٢٦، ٩)", en: "MACD (12, 26, 9)" },
        value: macdLine,
        fmt: (v) => fmtNum(v, 2),
        signal: macdHist === null ? "neutral" : macdHist > 0 ? "buy" : "sell",
      },
      {
        name: T.cciName,
        value: cci,
        fmt: (v) => fmtNum(v, 0),
        signal: cci === null ? "neutral" : cci < -100 ? "buy" : cci > 100 ? "sell" : "neutral",
      },
      {
        name: T.adxName,
        value: adxLast,
        fmt: (v) => fmtNum(v, 1),
        signal:
          adxLast === null || pdi === null || mdi === null
            ? "neutral"
            : adxLast >= 20
              ? pdi > mdi
                ? "buy"
                : "sell"
              : "neutral",
      },
      {
        name: T.cmoName,
        value: cmo,
        fmt: (v) => fmtNum(v, 1),
        signal: cmo === null ? "neutral" : cmo < -50 ? "buy" : cmo > 50 ? "sell" : "neutral",
      },
      {
        name: T.rocName,
        value: roc,
        fmt: (v) => fmtNum(v, 1),
        signal: roc === null ? "neutral" : roc > 0 ? "buy" : roc < 0 ? "sell" : "neutral",
      },
      {
        name: T.momentumName,
        value: mom,
        fmt: (v) => fmtNum(v),
        signal: mom === null ? "neutral" : mom > 0 ? "buy" : mom < 0 ? "sell" : "neutral",
      },
      {
        name: T.uoName,
        value: uo,
        fmt: (v) => fmtNum(v, 1),
        signal: uo === null ? "neutral" : uo < 30 ? "buy" : uo > 70 ? "sell" : "neutral",
      },
      {
        name: T.williamsR,
        value: wr,
        fmt: (v) => fmtNum(v, 1),
        signal: wr === null ? "neutral" : wr < -80 ? "buy" : wr > -20 ? "sell" : "neutral",
      },
      {
        name: T.aoName,
        value: ao,
        fmt: (v) => fmtNum(v, 2),
        signal: ao === null ? "neutral" : ao > 0 ? "buy" : ao < 0 ? "sell" : "neutral",
      },
      {
        name: T.trixName,
        value: trixLast,
        fmt: (v) => fmtNum(v, 3),
        signal:
          trixLast === null || trixSig === null ? "neutral" : trixLast > trixSig ? "buy" : trixLast < trixSig ? "sell" : "neutral",
      },
      {
        name: { ar: "قوة الثيران/الدببة (١٣)", en: "Bull Bear Power (13)" },
        value: bbp,
        fmt: (v) => fmtNum(v, 2),
        signal: bbp === null ? "neutral" : bbp > 0 ? "buy" : "sell",
      },
      {
        name: T.mfiName,
        value: mfi,
        fmt: (v) => fmtNum(v, 1),
        signal: mfi === null ? "neutral" : mfi < 20 ? "buy" : mfi > 80 ? "sell" : "neutral",
      },
      {
        name: T.obvName,
        value: obvSlope,
        fmt: (v) => fmtNum(v, 0),
        signal: obvSlope === null ? "neutral" : obvSlope > 0 ? "buy" : obvSlope < 0 ? "sell" : "neutral",
      },
    ];

    // only indicators with a real value count toward the summary
    const signals = [...maRows, ...oscRows]
      .filter((r) => r.value !== null)
      .map((r) => r.signal);
    const summary = aggregateSignals(signals);

    const pivots = hasHL
      ? classicPivots(lastCandle.high as number, lastCandle.low as number, lastCandle.close)
      : null;

    return {
      price,
      maRows,
      oscRows,
      summary,
      pivots,
      lastCandle,
      count: signals.length,
      vol: {
        atr,
        atrPct,
        adx: adxLast,
        pdi,
        mdi,
        bbWidthPct,
        dcPos,
        psar,
        psarSide: psar !== null ? (price > psar ? ("above" as const) : ("below" as const)) : null,
        stTrend,
        aroonUp,
        aroonDn,
      },
    };
  }, [stock]);

  // ── stock vs EGX30 rebased series ──
  const vsData = useMemo(() => {
    if (!stock || !index) return null;
    const indexMap = new Map<string, number>();
    index.points.forEach((p) => indexMap.set(p.date, p.close));
    const common = stock.points.filter((p) => indexMap.has(p.date));
    if (common.length < 30) return null;
    const s0 = common[0].close;
    const i0 = indexMap.get(common[0].date) as number;
    const rows = common.map((p) => ({
      date: p.date,
      stock: (p.close / s0) * 100,
      egx30: ((indexMap.get(p.date) as number) / i0) * 100,
    }));
    const last = rows[rows.length - 1];
    return {
      rows,
      stockPerf: last.stock - 100,
      indexPerf: last.egx30 - 100,
      from: rows[0].date,
      to: rows[rows.length - 1].date,
    };
  }, [stock, index]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full" />
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <section className="rounded-lg border bg-card p-6 text-center space-y-2">
        <p className="text-sm font-medium">{tt(T.techNoData, lang)}</p>
        <p className="num text-xs text-muted-foreground">{error ?? ""}</p>
      </section>
    );
  }

  const ratingKey =
    analysis.summary.rating === "strongBuy"
      ? T.techStrongBuy
      : analysis.summary.rating === "buy"
        ? T.techBuy
        : analysis.summary.rating === "neutral"
          ? T.techNeutral
          : analysis.summary.rating === "sell"
            ? T.techSell
            : T.techStrongSell;

  const pivotLevels = analysis.pivots
    ? ([
        ["R3", analysis.pivots.r3],
        ["R2", analysis.pivots.r2],
        ["R1", analysis.pivots.r1],
        ["P", analysis.pivots.p],
        ["S1", analysis.pivots.s1],
        ["S2", analysis.pivots.s2],
        ["S3", analysis.pivots.s3],
      ] as [string, number][])
    : null;

  return (
    <div className="space-y-5">
      {/* summary: gauge + indicator tables */}
      <section aria-label="technical summary" className="rounded-lg border bg-card p-4">
        <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
          <h2 className="text-lg font-bold">{tt(T.techSummaryTitle, lang)}</h2>
          <span className="num text-[11px] text-muted-foreground">
            {ticker} · {analysis.count} {tt(T.techCountsNote, lang)} · 1Y
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-4 max-w-3xl leading-relaxed">{tt(T.techNote, lang)}</p>

        <div className="grid gap-5 lg:grid-cols-[16rem_1fr] items-start">
          {/* gauge + counts */}
          <div className="flex flex-col items-center gap-3 lg:border-e lg:pe-5">
            <RatingGauge score={analysis.summary.score} label={tt(ratingKey, lang)} />
            <div className="flex items-center gap-1.5" dir="ltr">
              <span className="rounded-sm bg-up-soft px-2 py-0.5 text-[11px] font-semibold text-up">
                {tt(T.techBuy, lang)} <span className="num">{analysis.summary.buy}</span>
              </span>
              <span className="rounded-sm bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {tt(T.techNeutral, lang)} <span className="num">{analysis.summary.neutral}</span>
              </span>
              <span className="rounded-sm bg-down-soft px-2 py-0.5 text-[11px] font-semibold text-down">
                {tt(T.techSell, lang)} <span className="num">{analysis.summary.sell}</span>
              </span>
            </div>
            <p className="num text-xs text-muted-foreground">
              {tt(T.techColValue, lang)}: {fmtNum(analysis.price)}
            </p>
          </div>

          {/* indicator tables */}
          <div className="grid gap-3 sm:grid-cols-2">
            <IndicatorTable title={tt(T.techMaGroup, lang)} rows={analysis.maRows} lang={lang} />
            <IndicatorTable title={tt(T.techOscGroup, lang)} rows={analysis.oscRows} lang={lang} />
          </div>
        </div>
      </section>

      {/* T26 — volatility & trend-strength strip (informational, not rated) */}
      <section aria-label="volatility and trend strength" className="rounded-lg border bg-card p-4">
        <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
          <h2 className="text-lg font-bold">{tt(T.volStripTitle, lang)}</h2>
          <span className="num text-[11px] text-muted-foreground">{ticker} · 1Y</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl leading-relaxed">{tt(T.volStripNote, lang)}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-md bg-secondary/40 p-2.5">
            <p className="text-[10px] text-muted-foreground leading-tight">{tt(T.atrName, lang)}</p>
            <p className="num text-base font-bold">{analysis.vol.atr !== null ? fmtNum(analysis.vol.atr) : "—"}</p>
            <p className="num text-[10px] text-muted-foreground">
              {analysis.vol.atrPct !== null ? `${fmtNum(analysis.vol.atrPct, 1)}% ${tt(T.ofPrice, lang)}` : ""}
            </p>
          </div>
          <div className="rounded-md bg-secondary/40 p-2.5">
            <p className="text-[10px] text-muted-foreground leading-tight">{tt(T.adxName, lang)}</p>
            <p className="num text-base font-bold">{analysis.vol.adx !== null ? fmtNum(analysis.vol.adx, 1) : "—"}</p>
            <p className="num text-[10px] text-muted-foreground">
              {analysis.vol.pdi !== null && analysis.vol.mdi !== null
                ? `+DI ${fmtNum(analysis.vol.pdi, 0)} / −DI ${fmtNum(analysis.vol.mdi, 0)}`
                : ""}
            </p>
          </div>
          <div className="rounded-md bg-secondary/40 p-2.5">
            <p className="text-[10px] text-muted-foreground leading-tight">{tt(T.superTrendName, lang)}</p>
            <p
              className={`num text-base font-bold ${
                analysis.vol.stTrend === 1 ? "text-up" : analysis.vol.stTrend === -1 ? "text-down" : ""
              }`}
            >
              {analysis.vol.stTrend === 1 ? tt(T.trendUp, lang) : analysis.vol.stTrend === -1 ? tt(T.trendDown, lang) : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">{tt(T.superTrendNote, lang)}</p>
          </div>
          <div className="rounded-md bg-secondary/40 p-2.5">
            <p className="text-[10px] text-muted-foreground leading-tight">PSAR</p>
            <p className="num text-base font-bold">{analysis.vol.psar !== null ? fmtNum(analysis.vol.psar) : "—"}</p>
            <p className="num text-[10px] text-muted-foreground">
              {analysis.vol.psarSide === "above"
                ? tt(T.priceAboveSar, lang)
                : analysis.vol.psarSide === "below"
                  ? tt(T.priceBelowSar, lang)
                  : ""}
            </p>
          </div>
          <div className="rounded-md bg-secondary/40 p-2.5">
            <p className="text-[10px] text-muted-foreground leading-tight">{tt(T.bbWidthName, lang)}</p>
            <p className="num text-base font-bold">{analysis.vol.bbWidthPct !== null ? `${fmtNum(analysis.vol.bbWidthPct, 1)}%` : "—"}</p>
            <p className="text-[10px] text-muted-foreground">{tt(T.bbWidthNote, lang)}</p>
          </div>
          <div className="rounded-md bg-secondary/40 p-2.5">
            <p className="text-[10px] text-muted-foreground leading-tight">{tt(T.donchianPosName, lang)}</p>
            <p className="num text-base font-bold">
              {analysis.vol.dcPos !== null ? `${fmtNum(analysis.vol.dcPos * 100, 0)}%` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">{tt(T.donchianPosNote, lang)}</p>
          </div>
        </div>
      </section>

      {/* pivot points */}
      {pivotLevels && (
        <section aria-label="pivot points" className="rounded-lg border bg-card p-4">
          <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
            <h2 className="text-lg font-bold">{tt(T.techPivotGroup, lang)}</h2>
            <span className="num text-[11px] text-muted-foreground">{analysis.lastCandle.date}</span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{tt(T.techPivotNote, lang)}</p>
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-sm min-w-[480px]">
              <thead className="border-b">
                <tr className="text-[11px] text-muted-foreground">
                  <th className="text-start font-medium px-3 py-2">{tt(T.techColIndicator, lang)}</th>
                  <th className="text-end font-medium px-3 py-2">{tt(T.techColValue, lang)}</th>
                  <th className="text-end font-medium px-3 py-2">{tt(T.techPrevClose, lang)}</th>
                  <th className="text-end font-medium px-3 py-2 hidden sm:table-cell">{tt(T.techColSignal, lang)}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pivotLevels.map(([name, v]) => {
                  const isPivot = name === "P";
                  const above = analysis.price > v;
                  return (
                    <tr key={name} className="hover:bg-accent/30 transition-colors">
                      <td className="num px-3 py-2 font-semibold">
                        {name === "P" ? "P" : name}
                        <span className="ms-2 text-[10px] font-normal text-muted-foreground">
                          {name === "P"
                            ? tt(T.pivotP, lang)
                            : name.startsWith("R")
                              ? `${tt(T.pivotR, lang)} ${name.slice(1)}`
                              : `${tt(T.pivotS, lang)} ${name.slice(1)}`}
                        </span>
                      </td>
                      <td className="num px-3 py-2 text-end font-medium">{fmtNum(v)}</td>
                      <td className="num px-3 py-2 text-end text-muted-foreground">
                        {isPivot ? "—" : `${above ? "+" : ""}${fmtNum(analysis.price - v)}`}
                      </td>
                      <td className="px-3 py-2 text-end hidden sm:table-cell">
                        <span
                          className={`inline-block min-w-[3.2rem] rounded-sm px-1.5 py-0.5 text-[10px] font-semibold text-center ${
                            above ? SIGNAL_CLS.buy : SIGNAL_CLS.sell
                          }`}
                        >
                          {above ? tt(T.techBuy, lang) : tt(T.techSell, lang)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* stock vs EGX30 */}
      {vsData && (
        <section aria-label="stock vs index" className="rounded-lg border bg-card p-4">
          <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
            <h2 className="text-lg font-bold">{tt(T.techVsEgx30, lang)}</h2>
            <span className="num text-[11px] text-muted-foreground">
              {vsData.from} → {vsData.to}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{tt(T.techVsEgx30Note, lang)}</p>
          <div className="h-64" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={vsData.rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                  minTickGap={48}
                  tickFormatter={(d: string) => d.slice(2)}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  domain={["auto", "auto"]}
                  tickFormatter={(v: number) => fmtNum(v, 0)}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "var(--popover-foreground)",
                  }}
                  labelStyle={{ color: "var(--muted-foreground)" }}
                  formatter={(value: number, key: string) => [
                    fmtNum(value, 1),
                    key === "stock" ? `${tt(T.techCompany, lang)} (${ticker})` : "EGX 30",
                  ]}
                />
                <Legend
                  formatter={(key: string) => (
                    <span style={{ color: "var(--muted-foreground)", fontSize: 11 }}>
                      {key === "stock" ? `${tt(T.techCompany, lang)} (${ticker})` : "EGX 30"}
                    </span>
                  )}
                />
                <ReferenceLine y={100} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="egx30" stroke="var(--c2)" strokeWidth={1.8} dot={false} />
                <Line type="monotone" dataKey="stock" stroke="var(--c3)" strokeWidth={2.2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 max-w-md">
            <div className="rounded-md bg-secondary/50 p-2.5">
              <p className="text-[10px] text-muted-foreground">
                {ticker} — {tt(T.performance, lang)}
              </p>
              <p className={`num text-lg font-bold ${directionClass(vsData.stockPerf)}`}>{fmtPct(vsData.stockPerf)}</p>
            </div>
            <div className="rounded-md bg-secondary/50 p-2.5">
              <p className="text-[10px] text-muted-foreground">EGX 30 — {tt(T.performance, lang)}</p>
              <p className={`num text-lg font-bold ${directionClass(vsData.indexPerf)}`}>{fmtPct(vsData.indexPerf)}</p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
