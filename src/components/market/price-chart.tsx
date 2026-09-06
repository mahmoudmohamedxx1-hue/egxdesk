"use client";

import { useEffect, useRef, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { useApp } from "./app-context";
import { T, tt } from "@/lib/i18n";
import { fmtNum, fmtPct, fmtInt, fmtValue, directionClass } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

/** Real price chart for one stock or index, with range switching.
 *  Data comes from /api/chart (Yahoo candles for stocks, persisted EGX
 *  session closes for indices). Chart canvas is LTR; labels are bilingual.
 *  Remount per symbol (parent uses key={symbol}). */

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

export function PriceChart({ symbol, defaultRange = "6M" }: { symbol: string; defaultRange?: string }) {
  const { lang } = useApp();
  const [range, setRange] = useState(defaultRange);
  const [data, setData] = useState<ChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
  const chartData = points.map((p) => ({
    date: p.date.slice(2), // YY-MM-DD compact tick label
    close: p.close,
    volume: p.volume ?? undefined,
  }));

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

      {/* chart canvas */}
      {points.length < 2 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {data.warming ? tt(T.chartWarming, lang) : tt(T.chartUnavailable, lang)}
        </p>
      ) : (
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -6 }}>
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
                  const close = payload.find((p) => p.dataKey === "close")?.value as number | undefined;
                  const vol = payload.find((p) => p.dataKey === "volume")?.value as number | undefined;
                  if (close === undefined) return null;
                  return (
                    <div className="rounded-md border bg-card px-3 py-1.5 text-xs shadow-md">
                      <p className="num font-semibold">{label}</p>
                      <p className="num text-muted-foreground">
                        {tt(T.close, lang)}: <b className={up ? "text-up" : "text-down"}>{fmtNum(close)}</b>
                        {data.currency === "EGP" && " EGP"}
                      </p>
                      {vol !== undefined && <p className="num text-muted-foreground">{tt(T.volume, lang)}: {fmtInt(vol)}</p>}
                    </div>
                  );
                }}
              />
              {showVolume && (
                <Bar yAxisId="vol" dataKey="volume" fill="var(--muted-foreground)" opacity={0.25} isAnimationActive={false} />
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
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* provenance */}
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        {data.warming ? `${tt(T.chartWarming, lang)} ` : ""}
        {tt(T.priceChartNote, lang)} — {data.source}
      </p>
    </div>
  );
}
