"use client";

import { directionClass, fmtPct } from "@/lib/format";

/** Horizontal bar chart of real cumulative performance across horizons. */
export function PerfChart({ perf, lang }: {
  perf: { label: string; value: number | null }[];
  lang: "ar" | "en";
}) {
  const vals = perf.map((p) => p.value).filter((v): v is number => v !== null);
  const max = Math.max(1, ...vals.map((v) => Math.abs(v)));
  return (
    <div dir="ltr" className="space-y-2">
      {perf.map((p) => {
        const v = p.value;
        const pct = v === null ? 0 : (Math.abs(v) / max) * 50; // half-width bars around center
        return (
          <div key={p.label} className="flex items-center gap-3 text-xs">
            <span className="num w-12 shrink-0 text-end font-medium text-muted-foreground">{p.label}</span>
            <div className="relative h-5 flex-1 rounded-sm bg-secondary/60 overflow-hidden">
              {/* center line */}
              <span className="absolute inset-y-0 start-1/2 w-px bg-border" aria-hidden />
              {v !== null && v !== 0 && (
                <span
                  className={`absolute inset-y-1 rounded-sm ${v > 0 ? "bg-up/80" : "bg-down/80"}`}
                  style={v > 0 ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${pct}%` }}
                />
              )}
            </div>
            <span className={`num w-16 shrink-0 font-semibold ${directionClass(v)}`}>
              {v === null ? "—" : fmtPct(v)}
            </span>
          </div>
        );
      })}
      <p className="sr-only">
        {lang === "ar" ? "التغير الفعلي المركّم على مدى كل فترة" : "Actual cumulative change over each horizon"}
      </p>
    </div>
  );
}

/** Marker showing where the last price sits inside its 52-week range. */
export function RangeBar({ low, high, close, labelLow, labelHigh }: {
  low: number | null; high: number | null; close: number;
  labelLow: string; labelHigh: string;
}) {
  if (low === null || high === null || high <= low) return null;
  const pos = Math.min(Math.max((close - low) / (high - low), 0), 1) * 100;
  return (
    <div dir="ltr">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
        <span className="num">{low.toFixed(2)}</span>
        <span className="num">{high.toFixed(2)}</span>
      </div>
      <div className="relative h-3 rounded-full bg-secondary overflow-hidden">
        {/* gradient track from down to up */}
        <div className="absolute inset-0 bg-gradient-to-r from-down/25 via-secondary to-up/25" aria-hidden />
        <span
          className="absolute top-1/2 h-5 w-1.5 -translate-y-1/2 rounded-full bg-foreground shadow"
          style={{ left: `calc(${pos}% - 3px)` }}
          aria-hidden
        />
      </div>
      <div className="flex items-center justify-between text-[10px] mt-1">
        <span className="text-muted-foreground">{labelLow}</span>
        <span className="num font-semibold">{close.toFixed(2)}</span>
        <span className="text-muted-foreground">{labelHigh}</span>
      </div>
    </div>
  );
}
