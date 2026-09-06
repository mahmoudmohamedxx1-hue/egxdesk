"use client";

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { fmtNum } from "@/lib/format";

/** ─────────────────────────────────────────────────────────────────────
 *  Shared, bilingual chart primitives (real data only).
 *  Charts are wrapped dir="ltr" so axes and bars stay numerically stable
 *  while surrounding labels stay fully translated.
 *  ───────────────────────────────────────────────────────────────────── */

export type BarItem = { label: string; value: number | null };

/** Horizontal diverging bar chart around a zero center line. */
export function DivergingBars({
  items,
  unit,
  lang,
  maxRows,
  compact = false,
}: {
  items: BarItem[];
  unit: "pct" | "egpMn";
  lang: "ar" | "en";
  maxRows?: number;
  compact?: boolean;
}) {
  const rows = [...items]
    .filter((i) => i.value !== null)
    .sort((a, b) => (b.value as number) - (a.value as number))
    .slice(0, maxRows ?? items.length);
  const vals = rows.map((r) => Math.abs(r.value as number));
  const max = Math.max(1, ...vals);
  const fmt = unit === "pct" ? (v: number) => `${v > 0 ? "+" : ""}${fmtNum(v, 2)}%` : (v: number) => `${v > 0 ? "+" : ""}${fmtNum(v, 0)}`;
  return (
    <div dir="ltr" className="space-y-1.5" role="img" aria-label={lang === "ar" ? "رسم بياني بالأعمدة" : "bar chart"}>
      {rows.map((r) => {
        const v = r.value as number;
        const w = (Math.abs(v) / max) * 50;
        return (
          <div key={r.label} className={`flex items-center gap-2 ${compact ? "text-[11px]" : "text-xs"}`}>
            <span
              className={`shrink-0 text-end text-muted-foreground truncate ${compact ? "w-24" : "w-32"}`}
              title={r.label}
            >
              {r.label}
            </span>
            <div className="relative h-4 flex-1 rounded-sm bg-secondary/50 overflow-hidden">
              <span className="absolute inset-y-0 start-1/2 w-px bg-border" aria-hidden />
              {v !== 0 && (
                <span
                  className={`absolute inset-y-0.5 rounded-sm ${v > 0 ? "bg-up/80" : "bg-down/80"}`}
                  style={v > 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
                />
              )}
            </div>
            <span
              className={`shrink-0 text-end font-semibold num ${compact ? "w-16" : "w-20"} ${
                v > 0 ? "text-up" : v < 0 ? "text-down" : "text-muted-foreground"
              }`}
            >
              {fmt(v)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export type DonutItem = { label: string; value: number; colorVar: string };

/** Donut chart with a readable side legend (RTL-safe: chart LTR, legend follows page dir). */
export function DonutChart({
  items,
  centerTop,
  centerBottom,
  legendValueFmt,
}: {
  items: DonutItem[];
  centerTop: string;
  centerBottom: string;
  legendValueFmt?: (v: number) => string;
}) {
  const total = items.reduce((a, i) => a + i.value, 0) || 1;
  const data = items.map((i) => ({ name: i.label, value: i.value, colorVar: i.colorVar }));
  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <div dir="ltr" className="relative w-44 h-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="94%"
              paddingAngle={2}
              strokeWidth={0}
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={`var(${d.colorVar})`} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0];
                const raw = p.value as number;
                const pct = total > 0 ? (raw / total) * 100 : 0;
                return (
                  <div className="rounded-md border bg-card px-3 py-1.5 text-xs shadow-md">
                    <p className="font-semibold">{p.name}</p>
                    <p className="num text-muted-foreground">
                      {legendValueFmt ? legendValueFmt(raw) : fmtNum(raw, 1)} · {fmtNum(pct, 1)}%
                    </p>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
          <span className="num text-sm font-bold">{centerTop}</span>
          <span className="text-[10px] text-muted-foreground max-w-24 leading-tight">{centerBottom}</span>
        </div>
      </div>
      <ul className="flex-1 min-w-0 w-full space-y-1.5">
        {items.map((i) => {
          const pct = total > 0 ? (i.value / total) * 100 : 0;
          return (
            <li key={i.label} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: `var(${i.colorVar})` }} aria-hidden />
              <span className="truncate flex-1 min-w-0" title={i.label}>{i.label}</span>
              <span className="num text-muted-foreground shrink-0">{fmtNum(pct, 1)}%</span>
              <span className="num font-semibold shrink-0 w-16 text-end">
                {legendValueFmt ? legendValueFmt(i.value) : fmtNum(i.value, 1)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export type TrendSeries = { key: string; label: string; colorVar: string };

/** Multi-series line chart (RTL-safe). Dates on X, values on Y, connects gaps. */
export function TrendLines({
  points,
  series,
  height = 220,
  yFmt,
}: {
  points: { x: string; values: Record<string, number | null> }[];
  series: TrendSeries[];
  height?: number;
  yFmt?: (v: number) => string;
}) {
  if (points.length < 2) return null;
  const data = points.map((p) => ({ x: p.x.slice(5), ...p.values }));
  return (
    <div dir="ltr" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="x"
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(v: number) => (yFmt ? yFmt(v) : fmtNum(v, 0))}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
                  <p className="num font-semibold mb-1">{label}</p>
                  {series.map((s) => {
                    const v = payload.find((p) => p.dataKey === s.key)?.value as number | undefined;
                    if (v === undefined || v === null) return null;
                    return (
                      <p key={s.key} className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: `var(${s.colorVar})` }} aria-hidden />
                        <span className="text-muted-foreground">{s.label}</span>
                        <span className="num font-semibold ms-auto">{yFmt ? yFmt(v) : fmtNum(v, 1)}</span>
                      </p>
                    );
                  })}
                </div>
              );
            }}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={`var(${s.colorVar})`}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3.5, strokeWidth: 0 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
