"use client";

import { useMemo, useState } from "react";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ChartPoint = { date: string; close: number };

/** Lightweight SVG area chart for price history. */
export function PriceChart({ data, height = 200 }: { data: ChartPoint[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = height;
  const pad = { t: 14, r: 8, b: 22, l: 8 };

  const { path, area, min, max, pts } = useMemo(() => {
    if (!data.length) return { path: "", area: "", min: 0, max: 0, pts: [] as { x: number; y: number; p: ChartPoint }[] };
    const values = data.map((d) => d.close);
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (hi === lo) { hi += 1; lo -= 1; }
    const span = hi - lo;
    lo -= span * 0.06;
    hi += span * 0.06;
    const innerW = W - pad.l - pad.r;
    const innerH = H - pad.t - pad.b;
    const pts = data.map((p, i) => ({
      x: pad.l + (i / Math.max(data.length - 1, 1)) * innerW,
      y: pad.t + (1 - (p.close - lo) / (hi - lo)) * innerH,
      p,
    }));
    const d = pts.map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");
    const a = `${d} L${pts[pts.length - 1].x.toFixed(1)},${H - pad.b} L${pts[0].x.toFixed(1)},${H - pad.b} Z`;
    return { path: d, area: a, min: lo, max: hi, pts };
  }, [data, H]);

  if (!data.length) {
    return <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">—</div>;
  }

  const up = data[data.length - 1].close >= data[0].close;
  const color = up ? "var(--up)" : "var(--down)";
  const hovered = hover !== null ? pts[hover] : null;

  return (
    <div className="relative w-full" dir="ltr">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        role="img"
        aria-label="price history chart"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.target as SVGElement).closest("svg")!.getBoundingClientRect();
          const rel = ((e.clientX - rect.left) / rect.width) * W;
          let idx = 0;
          let best = Infinity;
          pts.forEach((pt, i) => {
            const d = Math.abs(pt.x - rel);
            if (d < best) { best = d; idx = i; }
          });
          setHover(idx);
        }}
      >
        <defs>
          <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* gridlines */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={pad.l}
            x2={W - pad.r}
            y1={pad.t + f * (H - pad.t - pad.b)}
            y2={pad.t + f * (H - pad.t - pad.b)}
            stroke="var(--border)"
            strokeDasharray="3 5"
            strokeWidth="1"
          />
        ))}
        <path d={area} fill="url(#pg)" />
        <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
        {hovered && (
          <>
            <line x1={hovered.x} x2={hovered.x} y1={pad.t} y2={H - pad.b} stroke="var(--muted-foreground)" strokeDasharray="2 4" />
            <circle cx={hovered.x} cy={hovered.y} r="4" fill={color} />
          </>
        )}
        {/* min/max labels */}
        <text x={pad.l + 2} y={pad.t + 10} className="num" fontSize="10" fill="var(--muted-foreground)">
          {fmtNum(max, 2)}
        </text>
        <text x={pad.l + 2} y={H - pad.b - 4} className="num" fontSize="10" fill="var(--muted-foreground)">
          {fmtNum(min, 2)}
        </text>
        <text x={W - pad.r - 2} y={H - 6} textAnchor="end" className="num" fontSize="10" fill="var(--muted-foreground)">
          {data[0].date}
        </text>
        <text x={pad.l + 2} y={H - 6} className="num" fontSize="10" fill="var(--muted-foreground)">
          {data[data.length - 1].date}
        </text>
      </svg>
      {hovered && (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-md border bg-card px-2.5 py-1 text-xs shadow-sm">
          <span className="num font-semibold">{fmtNum(hovered.p.close)}</span>
          <span className="ms-2 text-muted-foreground num">{hovered.p.date}</span>
        </div>
      )}
    </div>
  );
}
