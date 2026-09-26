"use client";

/** T64 → T66 — the valuation MAP tab: every company with a published P/E and
 *  D/E on one 2D map — x = what you pay for earnings, y = how leveraged the
 *  balance sheet is, bubble = market cap. Two color modes: the four reading
 *  quadrants (median lines printed) or the FAIR VALUE lens — each bubble
 *  painted by its upside vs the five-model blended fair value (deep green
 *  = far below fair value, deep red = far above).
 *
 *  T66 — THE PROFESSIONAL CHART ARCHITECTURE (the user's persistence was
 *  right: at 2×+ zoom the bubbles scaled past the fixed axis frame and
 *  floated OVER the tick labels, which reads exactly as "the graph is fixed
 *  while the companies move"). Rebuilt the way real charting libraries do
 *  it: (1) the whole data layer is CLIPPED to the plot rectangle — nothing
 *  ever spills over the axis chrome; (2) full GRID LINES are drawn in screen
 *  space at the re-computed nice ticks, so the grid visibly re-flows and
 *  re-values with every zoom — the synchronization is now impossible to
 *  miss; (3) quadrant regions + median guides live in the camera transform,
 *  with screen-space region labels that track them; (4) NAMES: a
 *  collision-aware, zoom-adaptive label layer — biggest companies first,
 *  label inside the bubble when it fits, above it when there's room, and
 *  MORE names appear as you zoom in (space grows with k), so no more
 *  nameless crowded bubbles at 1×; (5) touch PINCH zoom (two pointers)
 *  beside ctrl/⌘+wheel, buttons and drag-pan. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../market/app-context";
import { ZoomIn, ZoomOut, MousePointer2, FlaskConical } from "lucide-react";
import { upsideColor } from "@/lib/fair-value";
import { fmt1, fmt2, fmtCap, fmtPct, type ValData, type ValRow } from "./valuation-shared";

const W = 960;
const H = 560;

/** the plot rectangle in SVG units (chart chrome lives outside it) */
const PX0 = 70;
const PX1 = W - 40;
const PY0 = 30;
const PY1 = H - 60;

const QUADRANT_COLORS: Record<string, string> = {
  value: "#10b981",
  leveraged: "#f59e0b",
  quality: "#3b82f6",
  expensive: "#ef4444",
};

type ColorMode = "quadrant" | "fair";
type Cam = { k: number; x: number; y: number };

/** "nice" tick values for a visible LINEAR domain (D/E) — 1/2/2.5/5×10^n. */
function niceTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return [];
  const raw = (max - min) / target;
  if (!(raw > 0)) return [];
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-6; v += step) out.push(+v.toFixed(6));
  return out;
}

/** "nice" ticks for a visible LOG domain (P/E): 1-2-5 per decade, densifying
 *  automatically as the zoom narrows (3, 4, 5… at deep zoom) — the standard
 *  axis a professional chart draws under a heavy-tailed multiple. */
function logTicks(min: number, max: number): number[] {
  if (!(max > min) || !(min > 0)) return [];
  const out: number[] = [];
  const lo = Math.log10(min);
  const hi = Math.log10(max);
  // how many decades are visible → pick the mantissa set that fits ~6-9 ticks
  const decades = hi - lo;
  const mantissas = decades > 1.6 ? [1, 2, 5] : decades > 0.75 ? [1, 2, 3, 5] : [1, 1.5, 2, 3, 4, 5, 7];
  const decadeStart = Math.floor(lo);
  for (let d = decadeStart; d <= Math.ceil(hi); d++) {
    for (const m of mantissas) {
      const v = +(m * Math.pow(10, d)).toPrecision(4);
      if (v >= min * 0.999 && v <= max * 1.001 && !out.includes(v)) out.push(v);
    }
  }
  return out.sort((a, b) => a - b);
}

/** axis-aligned box [x0, y0, x1, y1] with padding, for label collision */
type Box = [number, number, number, number];
const boxesOverlap = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

export function ValuationMapTab({ data, rows }: { data: ValData; rows: ValRow[] }) {
  const { lang, navigate } = useApp();
  const [mode, setMode] = useState<ColorMode>("quadrant");
  const [cam, setCam] = useState<Cam>({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<ValRow | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number; scale: number } | null>(null);
  const movedRef = useRef(0);
  // T66 — touch pinch: two live pointers with their last positions/distances
  const pinchRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  // axis caps at the 96th percentile so one outlier doesn't flatten the map
  // (primitive consts — React-Compiler-friendly memo dependencies)
  const peSort = rows.map((r) => r.pe).filter((v): v is number => v != null).sort((a, b) => a - b);
  const deSort = rows.map((r) => r.de).filter((v): v is number => v != null).sort((a, b) => a - b);
  const p96 = (xs: number[]) => xs[Math.floor(xs.length * 0.96)];
  const xMax = Math.max(20, Math.ceil(p96(peSort) ?? 40));
  const yMax = Math.max(2, Math.ceil((p96(deSort) ?? 4) * 10) / 10);
  const medianPe = data.medianPe ?? 15;
  const medianDe = data.medianDe ?? 1;
  // T66 — LOG-scaled P/E axis: a linear axis under a heavy-tailed multiple
  // crams 90% of the market (P/E 3-25) into the left ~10% of the plot — THE
  // crowding the user reported. On log10 the market mass spreads across the
  // full width, exactly the way professional scatter maps render multiples.
  const peMin = Math.max(2, peSort[0] ?? 2);
  const logX0 = Math.log10(peMin);
  const logX1 = Math.log10(xMax);
  const fr = (pe: number) => (Math.min(pe, xMax) <= peMin ? 0 : (Math.log10(Math.min(pe, xMax)) - logX0) / (logX1 - logX0));
  const peAt = (f: number) => Math.pow(10, logX0 + f * (logX1 - logX0));

  // data-space → SVG-plot mapping: x LOG (P/E), y LINEAR (D/E)
  const x = (pe: number) => PX0 + fr(pe) * (PX1 - PX0);
  const y = (de: number) => PY1 - (Math.min(de, yMax) / yMax) * (PY1 - PY0);
  const maxCap = Math.max(...rows.map((r) => r.marketCap ?? 0), 1);
  // T66 — slightly compressed radius range: less mutual crowding at 1×,
  // same area-∝-cap semantics
  const r = (cap: number | null) => 4.5 + Math.sqrt((cap ?? 1e8) / maxCap) * 21;

  const bubbleColor = (row: ValRow): string =>
    mode === "fair" ? upsideColor(row.upside) : QUADRANT_COLORS[row.quadrant ?? "expensive"];

  // ── the camera ──
  const clampCam = (c: Cam): Cam => {
    const k = Math.min(3, Math.max(0.8, c.k));
    const padX = 48;
    const padY = 36;
    // k ≥ 1: the scaled content must cover the viewport (soft edges only)
    // k < 1: the content is smaller than the viewport — center it, no pan
    const cx = k >= 1 ? Math.min(padX, Math.max(W - W * k - padX, c.x)) : (W - W * k) / 2;
    const cy = k >= 1 ? Math.min(padY, Math.max(H - H * k - padY, c.y)) : (H - H * k) / 2;
    return { k, x: cx, y: cy };
  };

  /** zoom by `factor` anchored at a point in SVG coordinates */
  const zoomAt = (px: number, py: number, factor: number) => {
    setCam((c) => {
      const k = Math.min(3, Math.max(0.8, c.k * factor));
      const s = k / c.k;
      return clampCam({ k, x: px - (px - c.x) * s, y: py - (py - c.y) * s });
    });
  };

  /** a client-space event → SVG viewBox coordinates */
  const svgPoint = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
  };

  // ctrl/⌘ + wheel = CURSOR-ANCHORED zoom (non-passive so the pinch gesture
  // can be stopped); a plain wheel keeps scrolling the page — never hijacked.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const p = svgPoint(e);
      if (!p) return;
      const factor = Math.exp(-e.deltaY * 0.0024);
      zoomAt(p.x, p.y, Math.min(1.6, Math.max(0.6, factor)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── pointer handling: one pointer = pan, two pointers = pinch zoom ──
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    movedRef.current = 0;
    pinchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchRef.current.size === 2) {
      dragRef.current = null; // pinch cancels any in-flight pan
    } else if (pinchRef.current.size === 1) {
      dragRef.current = { sx: e.clientX, sy: e.clientY, px: cam.x, py: cam.y, scale: W / rect.width };
    }
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    // pinch: zoom anchored at the fingers' midpoint, factor = distance ratio
    if (pinchRef.current.has(e.pointerId)) pinchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchRef.current.size === 2) {
      const [a, b] = [...pinchRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      // previous distance rides on the map itself (cheap, no extra state)
      const store = pinchRef.current as unknown as { lastD?: number };
      const prevDist = store.lastD;
      store.lastD = dist;
      if (prevDist && prevDist > 0 && dist > 0) {
        const p = svgPoint({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
        if (p) zoomAt(p.x, p.y, Math.min(1.15, Math.max(0.87, dist / prevDist)));
        movedRef.current += 8;
      }
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    movedRef.current = Math.abs(dx) + Math.abs(dy);
    setCam((c) => clampCam({ k: c.k, x: d.px + dx * d.scale, y: d.py + dy * d.scale }));
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pinchRef.current.delete(e.pointerId);
    if (pinchRef.current.size < 2) (pinchRef.current as unknown as { lastD?: number }).lastD = undefined;
    if (pinchRef.current.size === 0) dragRef.current = null;
  };

  const reset = () => setCam({ k: 1, x: 0, y: 0 });

  // ── screen-space values derived from the camera (the synchronized axes) ──
  const sxOfPe = (pe: number) => cam.x + x(pe) * cam.k;
  const syOfDe = (de: number) => cam.y + y(de) * cam.k;
  // the VISIBLE domain at the current camera — log-space inverse for x
  const peVisible: [number, number] = [
    Math.max(peMin, peAt(Math.max(0, ((PX0 - cam.x) / cam.k - PX0) / (PX1 - PX0)))),
    Math.max(peMin, peAt(Math.min(1, ((PX1 - cam.x) / cam.k - PX0) / (PX1 - PX0)))),
  ];
  const deVisible: [number, number] = [
    Math.max(0, ((PY1 - (PY1 - cam.y) / cam.k) - PY0) / (PY1 - PY0) * yMax),
    Math.max(0, ((PY1 - (PY0 - cam.y) / cam.k) - PY0) / (PY1 - PY0) * yMax),
  ];
  const xTicks = logTicks(peVisible[0], peVisible[1]);
  const yTicks = niceTicks(deVisible[0], deVisible[1]);

  // median label positions in SCREEN space (constant font, tracks the line)
  const medX = sxOfPe(medianPe);
  const medY = syOfDe(medianDe);
  const medXVisible = medX > PX0 + 8 && medX < PX1 - 8;
  const medYVisible = medY > PY0 + 8 && medY < PY1 - 8;

  // ── T66 — the zoom-adaptive, collision-aware NAME layer ──
  // Biggest companies first: a label goes INSIDE its bubble when the bubble
  // is big enough, else it tries ABOVE → BELOW → RIGHT → LEFT — the first
  // position that fits without touching any placed label, another bubble's
  // circle, or the plot frame wins. Because screen space grows with k, zooming
  // in progressively reveals more names; zooming out keeps only the majors.
  // The hovered bubble is always labeled (drawn last, on top).
  // (Local pure helpers keep the memo dependency set compiler-inferable.)
  const hoverTicker = hover?.ticker ?? null;
  const labels = useMemo(() => {
    type Pos = "inside" | "above" | "below" | "right" | "left";
    type L = { row: ValRow; sx: number; sy: number; sr: number; pos: Pos };
    const lg0 = Math.log10(peMin);
    const lg1 = Math.log10(xMax);
    const xf = (pe: number) => {
      const v = Math.min(pe, xMax);
      return PX0 + (v <= peMin ? 0 : (Math.log10(v) - lg0) / (lg1 - lg0)) * (PX1 - PX0);
    };
    const yf = (de: number) => PY1 - (Math.min(de, yMax) / yMax) * (PY1 - PY0);
    const rf = (cap: number | null) => 4.5 + Math.sqrt((cap ?? 1e8) / maxCap) * 21;
    const placed: Box[] = [];
    const out: L[] = [];
    const sorted = [...rows].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
    // hovered bubble first — it always gets the best spot
    const order = hoverTicker ? [...sorted.filter((rw) => rw.ticker === hoverTicker), ...sorted.filter((rw) => rw.ticker !== hoverTicker)] : sorted;
    // does a candidate box touch any OTHER bubble's circle?
    const touchesBubble = (box: Box, selfTicker: string): boolean =>
      rows.some((o) => {
        if (o.ticker === selfTicker) return false;
        const osx = cam.x + xf(o.pe ?? 0) * cam.k;
        const osy = cam.y + yf(o.de ?? 0) * cam.k;
        const osr = rf(o.marketCap) * cam.k;
        if (osx < PX0 - osr || osx > PX1 + osr || osy < PY0 - osr || osy > PY1 + osr) return false;
        const nx = Math.max(box[0], Math.min(box[2], osx));
        const ny = Math.max(box[1], Math.min(box[3], osy));
        return Math.hypot(nx - osx, ny - osy) < osr;
      });
    for (const row of order) {
      const sx = cam.x + xf(row.pe ?? 0) * cam.k;
      const sy = cam.y + yf(row.de ?? 0) * cam.k;
      if (sx < PX0 - 60 || sx > PX1 + 60 || sy < PY0 - 60 || sy > PY1 + 60) continue;
      const sr = rf(row.marketCap) * cam.k;
      const w = row.ticker.length * 6.0 + 6;
      // candidate boxes in priority order
      const candidates: { pos: Pos; box: Box }[] = [];
      if (sr >= 12) candidates.push({ pos: "inside", box: [sx - sr + 3, sy - sr + 3, sx + sr - 3, sy + sr - 3] });
      candidates.push(
        { pos: "above", box: [sx - w / 2 - 2, sy - sr - 13, sx + w / 2 + 2, sy - sr - 1] },
        { pos: "below", box: [sx - w / 2 - 2, sy + sr + 1, sx + w / 2 + 2, sy + sr + 13] },
        { pos: "right", box: [sx + sr + 1, sy - 6, sx + sr + 3 + w, sy + 6] },
        { pos: "left", box: [sx - sr - 3 - w, sy - 6, sx - sr - 1, sy + 6] }
      );
      for (const cand of candidates) {
        const b = cand.box;
        // must sit inside the plot (labels never render over the axis chrome)
        if (b[0] < PX0 + 1 || b[2] > PX1 - 1 || b[1] < PY0 + 1 || b[3] > PY1 - 1) continue;
        if (cand.pos !== "inside" && touchesBubble(b, row.ticker)) continue;
        if (placed.some((p) => boxesOverlap(b, p))) continue;
        placed.push(b);
        out.push({ row, sx, sy, sr, pos: cand.pos });
        break;
      }
    }
    return out;
  }, [rows, cam, xMax, yMax, maxCap, hoverTicker, peMin]);

  // quadrant region labels: anchored to the (transformed) region centers,
  // hidden when the center leaves the plot — they MOVE with the graph
  const quadLabels = useMemo(() => {
    const medXPx = x(medianPe);
    const medYPx = y(medianDe);
    const quads: { key: string; cx: number; cy: number }[] = [
      { key: "leveraged", cx: (PX0 + medXPx) / 2, cy: (PY0 + medYPx) / 2 },
      { key: "expensive", cx: (medXPx + PX1) / 2, cy: (PY0 + medYPx) / 2 },
      { key: "value", cx: (PX0 + medXPx) / 2, cy: (medYPx + PY1) / 2 },
      { key: "quality", cx: (medXPx + PX1) / 2, cy: (medYPx + PY1) / 2 },
    ];
    return quads
      .map((q) => {
        const sx = cam.x + q.cx * cam.k;
        const sy = cam.y + q.cy * cam.k;
        return { key: q.key, sx, sy, visible: sx > PX0 + 30 && sx < PX1 - 30 && sy > PY0 + 12 && sy < PY1 - 12 };
      })
      .filter((q) => q.visible);
  }, [cam, medianPe, medianDe, xMax, yMax]);

  const fairLegend: [string, string, string][] = [
    ["#047857", "+40%", lang === "ar" ? "خصم عميق" : "deep discount"],
    ["#10b981", "+20%", ""],
    ["#34d399", "+10%", ""],
    ["#94a3b8", "±10%", lang === "ar" ? "حول العادلة" : "around fair"],
    ["#f87171", "−20%", ""],
    ["#b91c1c", "−40%", lang === "ar" ? "علاوة كبيرة" : "big premium"],
  ];

  return (
    <div className="space-y-3">
      {/* color mode toggle + hint */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-[11px]">
          <button
            onClick={() => setMode("quadrant")}
            className={`rounded-full border px-2.5 py-1 transition-colors ${
              mode === "quadrant" ? "border-foreground/20 bg-secondary font-semibold" : "border-transparent text-muted-foreground hover:bg-accent"
            }`}
          >
            {lang === "ar" ? "الرباعيات (مكرر × دين)" : "Quadrants (P/E × debt)"}
          </button>
          <button
            onClick={() => setMode("fair")}
            className={`rounded-full border px-2.5 py-1 transition-colors ${
              mode === "fair" ? "border-foreground/20 bg-secondary font-semibold" : "border-transparent text-muted-foreground hover:bg-accent"
            }`}
          >
            {lang === "ar" ? "عدسة القيمة العادلة" : "Fair-value lens"}
          </button>
        </div>
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <MousePointer2 className="h-3 w-3" aria-hidden />
          {lang === "ar"
            ? "اسحب للتجوّل · Ctrl/⌘ + عجلة أو قرصة بإصبعين للتقريب · قرّب لتظهر أسماء أكثر · نقرة مزدوجة لفتح الشركة"
            : "drag to pan · ctrl/⌘ + wheel or two-finger pinch to zoom · zoom in for more names · double-click opens the company"}
        </span>
      </div>

      <div className="relative overflow-hidden rounded-xl border bg-card">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full cursor-grab touch-none select-none active:cursor-grabbing"
          style={{ height: "min(62vh, 560px)" }}
          onClick={() => {
            if (movedRef.current < 5) setHover(null);
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <defs>
            {/* T66 — the plot-area clip: the data layer can NEVER spill over
                the axis chrome, no matter how deep the zoom */}
            <clipPath id="val-plot-clip">
              <rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} />
            </clipPath>
          </defs>

          {/* ── DATA layer: tints + median guides + bubbles, ONE camera, CLIPPED ── */}
          <g clipPath="url(#val-plot-clip)">
            <g transform={`translate(${cam.x},${cam.y}) scale(${cam.k})`}>
              {/* quadrant tints (reading aid in both modes — faint by design) */}
              <rect x={x(medianPe)} y={PY0} width={PX1 - x(medianPe)} height={y(medianDe) - PY0} fill={QUADRANT_COLORS.expensive} opacity={mode === "quadrant" ? 0.06 : 0.025} />
              <rect x={PX0} y={PY0} width={x(medianPe) - PX0} height={y(medianDe) - PY0} fill={QUADRANT_COLORS.leveraged} opacity={mode === "quadrant" ? 0.06 : 0.025} />
              <rect x={x(medianPe)} y={y(medianDe)} width={PX1 - x(medianPe)} height={PY1 - y(medianDe)} fill={QUADRANT_COLORS.quality} opacity={mode === "quadrant" ? 0.06 : 0.025} />
              <rect x={PX0} y={y(medianDe)} width={x(medianPe) - PX0} height={PY1 - y(medianDe)} fill={QUADRANT_COLORS.value} opacity={mode === "quadrant" ? 0.06 : 0.025} />

              {/* median guides — full-plot lines inside the clip */}
              <line x1={x(medianPe)} y1={PY0} x2={x(medianPe)} y2={PY1} stroke="currentColor" strokeDasharray="4 4" opacity={0.35} vectorEffect="non-scaling-stroke" />
              <line x1={PX0} y1={y(medianDe)} x2={PX1} y2={y(medianDe)} stroke="currentColor" strokeDasharray="4 4" opacity={0.35} vectorEffect="non-scaling-stroke" />

              {/* the bubbles */}
              {rows.map((row) => {
                const cx = x(row.pe ?? 0);
                const cy = y(row.de ?? 0);
                const rr = r(row.marketCap);
                const color = bubbleColor(row);
                const hovered = hover?.ticker === row.ticker;
                return (
                  <circle
                    key={row.ticker}
                    cx={cx}
                    cy={cy}
                    r={rr}
                    fill={color}
                    opacity={hovered ? 0.85 : 0.6}
                    stroke={color}
                    strokeWidth={hovered ? 2.5 : 1}
                    vectorEffect="non-scaling-stroke"
                    className="cursor-pointer"
                    onClick={(e) => {
                      if (movedRef.current >= 5) return;
                      e.stopPropagation();
                      setHover(row);
                    }}
                    onDoubleClick={() => navigate("company", { ticker: row.ticker })}
                  />
                );
              })}
            </g>
          </g>

          {/* ── SCREEN-SPACE grid at the re-valued ticks — moves WITH the zoom ── */}
          {xTicks.map((pe) => {
            const sx = sxOfPe(pe);
            if (sx < PX0 + 2 || sx > PX1 - 2) return null;
            return <line key={`gx-${pe}`} x1={sx} y1={PY0} x2={sx} y2={PY1} stroke="currentColor" opacity={0.09} vectorEffect="non-scaling-stroke" />;
          })}
          {yTicks.map((de) => {
            const sy = syOfDe(de);
            if (sy < PY0 + 2 || sy > PY1 - 2) return null;
            return <line key={`gy-${de}`} x1={PX0} y1={sy} x2={PX1} y2={sy} stroke="currentColor" opacity={0.09} vectorEffect="non-scaling-stroke" />;
          })}

          {/* ── CHROME layer (screen space): axes that RE-VALUE themselves ── */}
          {/* axis frame */}
          <line x1={PX0} y1={PY1} x2={PX1} y2={PY1} stroke="currentColor" opacity={0.3} />
          <line x1={PX0} y1={PY0} x2={PX0} y2={PY1} stroke="currentColor" opacity={0.3} />

          {/* x ticks — values from the VISIBLE domain, positioned on the
              transformed data grid: the axis moves with the companies */}
          {xTicks.map((pe) => {
            const sx = sxOfPe(pe);
            if (sx < PX0 + 2 || sx > PX1 - 2) return null;
            return (
              <g key={`xt-${pe}`}>
                <line x1={sx} y1={PY1} x2={sx} y2={PY1 + 4} stroke="currentColor" opacity={0.35} />
                <text x={sx} y={PY1 + 15} fontSize="9" textAnchor="middle" fill="currentColor" opacity={0.45}>
                  {`${pe >= 9.95 ? pe.toFixed(0) : +pe.toFixed(1)}x`}
                </text>
              </g>
            );
          })}
          {/* y ticks */}
          {yTicks.map((de) => {
            const sy = syOfDe(de);
            if (sy < PY0 + 2 || sy > PY1 - 2) return null;
            return (
              <g key={`yt-${de}`}>
                <line x1={PX0 - 4} y1={sy} x2={PX0} y2={sy} stroke="currentColor" opacity={0.35} />
                <text x={PX0 - 7} y={sy + 3} fontSize="9" textAnchor="end" fill="currentColor" opacity={0.45}>
                  {de.toFixed(1)}x
                </text>
              </g>
            );
          })}

          {/* quadrant region labels — screen space, tracking the regions */}
          {quadLabels.map((q) => (
            <text
              key={`ql-${q.key}`}
              x={q.sx}
              y={q.sy}
              fontSize="10"
              textAnchor="middle"
              fill={QUADRANT_COLORS[q.key]}
              opacity={0.55}
              className="pointer-events-none font-semibold"
            >
              {lang === "ar" ? data.quadrants[q.key].ar : data.quadrants[q.key].en} · {data.counts[q.key as keyof typeof data.counts]}
            </text>
          ))}

          {/* median labels — screen space, constant font, tracking the lines */}
          {medXVisible && (
            <text x={Math.min(medX + 6, PX1 - 90)} y={PY0 + 14} fontSize="10" fill="currentColor" opacity={0.6}>
              {lang === "ar" ? `وسيط P/E: ${medianPe.toFixed(1)}x` : `median P/E: ${medianPe.toFixed(1)}x`}
            </text>
          )}
          {medYVisible && (
            <text x={PX1 - 6} y={Math.max(medY - 6, PY0 + 10)} fontSize="10" textAnchor="end" fill="currentColor" opacity={0.6}>
              {lang === "ar" ? `حد الدين ${medianDe.toFixed(2)}x` : `debt line ${medianDe.toFixed(2)}x`}
            </text>
          )}

          {/* ── T66 — the NAME layer (screen space, collision-aware) ── */}
          {labels.map(({ row, sx, sy, sr, pos }) => {
            const hovered = hover?.ticker === row.ticker;
            const geo =
              pos === "inside"
                ? { x: sx, y: sy + 3.5, anchor: "middle" as const, size: Math.min(12, Math.max(8.5, sr / 3)) }
                : pos === "above"
                  ? { x: sx, y: sy - sr - 4, anchor: "middle" as const, size: 9 }
                  : pos === "below"
                    ? { x: sx, y: sy + sr + 10, anchor: "middle" as const, size: 9 }
                    : pos === "right"
                      ? { x: sx + sr + 4, y: sy + 3.5, anchor: "start" as const, size: 9 }
                      : { x: sx - sr - 4, y: sy + 3.5, anchor: "end" as const, size: 9 };
            return (
              <text
                key={`lb-${row.ticker}`}
                x={geo.x}
                y={geo.y}
                fontSize={geo.size}
                textAnchor={geo.anchor}
                fill={pos === "inside" ? "#ffffff" : "currentColor"}
                opacity={hovered ? 1 : pos === "inside" ? 0.95 : 0.8}
                stroke={pos === "inside" ? "rgba(0,0,0,0.35)" : "none"}
                strokeWidth={pos === "inside" ? 0.75 : 0}
                paintOrder="stroke"
                className="pointer-events-none font-semibold"
                style={{ textShadow: pos === "inside" ? "0 0 3px rgba(0,0,0,0.5)" : "0 0 2px var(--background, #00000080)" }}
              >
                {row.ticker}
              </text>
            );
          })}

          {/* axis titles */}
          <text x={PX1} y={PY1 + 30} textAnchor="end" fontSize="11" fill="currentColor" opacity={0.7}>
            {lang === "ar" ? "مكرر الربحية (مقياس لوغاريتمي) ← الأغلى يميناً" : "P/E (log scale) → more expensive rightward"}
          </text>
          <text x={PX0 + 6} y={PY0 + 10} fontSize="11" fill="currentColor" opacity={0.7}>
            {lang === "ar" ? "D/E ↑ رافعة أعلى" : "D/E ↑ more leverage"}
          </text>
        </svg>

        {/* hover card — now with the fair-value reading */}
        {hover && (
          <div className="absolute top-2 end-2 w-60 rounded-lg border bg-card/95 p-2.5 text-xs shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <b className="font-bold">{hover.ticker}</b>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate("scenarios", { ticker: hover.ticker })}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  title={lang === "ar" ? "افتح في مختبر النماذج" : "open in the model lab"}
                >
                  <FlaskConical className="h-3 w-3" aria-hidden />
                  {lang === "ar" ? "المختبر" : "lab"}
                </button>
                <button onClick={() => navigate("company", { ticker: hover.ticker })} className="text-primary hover:underline">
                  {lang === "ar" ? "افتح ↗" : "open ↗"}
                </button>
              </div>
            </div>
            <p className="mt-0.5 truncate text-muted-foreground">{lang === "ar" ? hover.nameAr : hover.nameEn}</p>
            <div className="mt-1.5 grid grid-cols-2 gap-1 tabular-nums">
              <span className="text-muted-foreground">{lang === "ar" ? "السعر" : "price"}</span>
              <span className="text-end font-semibold">{fmt2(hover.close)}</span>
              <span className="text-muted-foreground">P/E</span>
              <span className="text-end font-semibold">{hover.pe != null ? `${hover.pe.toFixed(1)}x` : "—"}</span>
              <span className="text-muted-foreground">D/E</span>
              <span className="text-end font-semibold">{hover.de != null ? `${hover.de.toFixed(2)}x` : "—"}</span>
              <span className="text-muted-foreground">{lang === "ar" ? "المعدّل بالدين" : "adjusted"}</span>
              <span className="text-end font-semibold">{hover.adjusted != null ? `${hover.adjusted.toFixed(1)}x` : "—"}</span>
              <span className="text-muted-foreground">P/B</span>
              <span className="text-end font-semibold">{hover.pb != null ? `${hover.pb.toFixed(2)}x` : "—"}</span>
              <span className="text-muted-foreground">{lang === "ar" ? "عائد الملكية" : "ROE"}</span>
              <span className="text-end font-semibold">{fmt1(hover.roe)}%</span>
              <span className="text-muted-foreground">{lang === "ar" ? "توزيعات" : "div yield"}</span>
              <span className="text-end font-semibold">{fmt1(hover.divYield)}%</span>
              <span className="text-muted-foreground">{lang === "ar" ? "القيمة السوقية" : "cap"}</span>
              <span className="text-end font-semibold">{fmtCap(hover.marketCap)}</span>
            </div>
            <div className="mt-1.5 border-t pt-1.5">
              {hover.fv != null ? (
                <div className="flex items-center justify-between gap-2 tabular-nums">
                  <span className="text-muted-foreground">{lang === "ar" ? "القيمة العادلة" : "fair value"}</span>
                  <b>{fmt2(hover.fv)}</b>
                  <span
                    className="rounded px-1.5 py-0.5 font-bold"
                    style={{ color: upsideColor(hover.upside), backgroundColor: `${upsideColor(hover.upside)}1a` }}
                  >
                    {fmtPct(hover.upside)}
                  </span>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  {lang === "ar" ? "لا قيمة عادلة — مدخلات النماذج غير منشورة" : "no fair value — model inputs not published"}
                </p>
              )}
              <p className="mt-1 text-[10px] text-muted-foreground">
                {lang === "ar"
                  ? `${Math.round((hover.fvCoverage ?? 0) * 5)} من ٥ نماذج · r ${fmt1(hover.fvR)}% · g ${fmt1(hover.fvG)}%`
                  : `${Math.round((hover.fvCoverage ?? 0) * 5)} of 5 models · r ${fmt1(hover.fvR)}% · g ${fmt1(hover.fvG)}%`}
              </p>
            </div>
          </div>
        )}

        {/* zoom controls */}
        <div className="absolute bottom-2 start-2 flex items-center gap-1 text-xs">
          <button className="rounded-md border bg-card/90 px-2 py-1 hover:bg-accent" onClick={() => zoomAt((PX0 + PX1) / 2, (PY0 + PY1) / 2, 1.3)} aria-label="zoom in">
            <ZoomIn className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button className="rounded-md border bg-card/90 px-2 py-1 hover:bg-accent" onClick={() => zoomAt((PX0 + PX1) / 2, (PY0 + PY1) / 2, 1 / 1.3)} aria-label="zoom out">
            <ZoomOut className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button className="rounded-md border bg-card/90 px-2 py-1 tabular-nums hover:bg-accent" onClick={reset}>
            {cam.k.toFixed(1)}× · {lang === "ar" ? "إعادة" : "reset"}
          </button>
        </div>
      </div>

      {/* legend */}
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        {mode === "quadrant" ? (
          (["value", "leveraged", "quality", "expensive"] as const).map((q) => (
            <span key={q} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: QUADRANT_COLORS[q] }} />
              <span className="font-medium">{lang === "ar" ? data.quadrants[q].ar : data.quadrants[q].en}</span>
              <span className="tabular-nums text-muted-foreground">· {data.counts[q]}</span>
            </span>
          ))
        ) : (
          fairLegend.map(([c, label, note]) => (
            <span key={c} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: c }} />
              <span className="tabular-nums font-medium">{label}</span>
              {note && <span className="text-muted-foreground">{note}</span>}
            </span>
          ))
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {lang === "ar"
          ? "مساحة كل فقاعة تمثل القيمة السوقية، وأسماء أكبر الشركات تظهر دائمًا — وكلما قرّبت ظهرت أسماء أكثر. اضغط على أي شركة لعرض مضاعفاتها وقيمتها العادلة، ونقرة مزدوجة لفتح صفحتها. الخطان المنقطان وسيطا السوق كله — والشبكة والمحاور يعيدون حساب أنفسهم مع كل تقريب."
          : "Bubble area = market cap; the biggest companies are always named — zoom in and more names appear. Click a company for its multiples and fair value, double-click to open its page. The dashed lines are the whole market's medians — the grid and axes re-value themselves on every zoom."}
      </p>
    </div>
  );
}
