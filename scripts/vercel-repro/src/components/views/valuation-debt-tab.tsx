"use client";

/** T64 → T68 — the DEBT MAP tab, rebuilt with the same professional chart
 *  architecture as the valuation map (the user's ask: "the debt map need to
 *  be improved like the valuation map"):
 *
 *  x = debt/equity on a SQRT scale — 40% of EGX sits under D/E 0.1 and a
 *  linear axis crammed them into the left 2.5% (THE crowding); sqrt spreads
 *  small values naturally and handles D/E = 0 (34 companies) exactly.
 *  y = net debt as a share of market value (net cash below the zero line).
 *  bubble = market cap, color = the five-zone reading.
 *
 *  T68 architecture (mirrors valuation-map-tab):
 *   (1) the whole data layer is CLIPPED to the plot rectangle — nothing ever
 *       spills over the axis chrome, at any zoom;
 *   (2) full GRID LINES in screen space at re-computed nice ticks — the grid
 *       visibly re-flows and re-values with every zoom, so the axes and the
 *       companies can never read as "out of sync";
 *   (3) the zone bands (safe <0.5 · moderate <1 · elevated <1.5 · high ≥1.5)
 *       and the net-cash band (below 0) live in the camera transform, with
 *       screen-space zone labels that track them;
 *   (4) NAMES: the same collision-aware, zoom-adaptive label layer — biggest
 *       companies first, more names appear as you zoom in;
 *   (5) touch PINCH zoom beside ctrl/⌘+wheel, buttons and drag-pan;
 *   (6) PER-COMPANY DEBT IMPACT panel under the map: every company's
 *       leverage reading illustrated on the same page — zone, net debt in
 *       EGP, the debt-adjusted multiple, and what the position MEANS —
 *       sortable, hover-linked to the map bubble.
 *
 *  Below it, the classic leverage ranking with net debt in EGP and the
 *  debt-adjusted multiple (P/E × (1 + D/E)) — the honest companion number
 *  that prices leverage into what you pay for earnings. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../market/app-context";
import { ZoomIn, ZoomOut, MousePointer2 } from "lucide-react";
import { DEBT_ZONE_META, type DebtZone } from "@/lib/fair-value";
import { fmt1, fmt2, fmtCap, type ValRow } from "./valuation-shared";

const W = 960;
const H = 560;

/** the plot rectangle in SVG units (chart chrome lives outside it) */
const PX0 = 70;
const PX1 = W - 40;
const PY0 = 30;
const PY1 = H - 60;

/** the y domain floor/ceiling (net debt as a share of market value) */
const Y_MIN = -0.5;
const Y_MAX = 2.0;

type Cam = { k: number; x: number; y: number };

/** "nice" tick values for a visible LINEAR domain (net debt/market) */
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

/** curated D/E tick values (the sqrt axis reads best at round marks) */
const DE_TICKS = [0, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** axis-aligned box [x0, y0, x1, y1] with padding, for label collision */
type Box = [number, number, number, number];
const boxesOverlap = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

export function ValuationDebtTab({ rows }: { rows: ValRow[] }) {
  const { lang, navigate } = useApp();
  const [cam, setCam] = useState<Cam>({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<ValRow | null>(null);
  const [sort, setSort] = useState<"deDesc" | "deAsc" | "adjusted">("deDesc");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number; scale: number } | null>(null);
  const movedRef = useRef(0);
  const pinchRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  const debtRows = useMemo(() => rows.filter((r) => r.de != null), [rows]);
  const mapRows = useMemo(
    () => debtRows.filter((r) => r.netDebtToCap != null && Number.isFinite(r.netDebtToCap)),
    [debtRows]
  );

  // x caps at the 96th percentile so one outlier doesn't flatten the map
  const deSort = useMemo(() => mapRows.map((r) => r.de as number).sort((a, b) => a - b), [mapRows]);
  const xMax = Math.max(1.5, Math.ceil(((deSort[Math.floor(deSort.length * 0.96)] ?? 2) as number) * 10) / 10);
  const medDe = useMemo(() => {
    const xs = debtRows.map((r) => r.de as number).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : null;
  }, [debtRows]);
  const medNdc = useMemo(() => {
    const xs = mapRows.map((r) => r.netDebtToCap as number).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : null;
  }, [mapRows]);

  // ── the SQRT x transform (handles D/E = 0 exactly; spreads the left mass) ──
  const xf = (de: number) => PX0 + (Math.sqrt(Math.max(0, Math.min(de, xMax))) / Math.sqrt(xMax)) * (PX1 - PX0);
  const yf = (ndc: number) => {
    const clamped = Math.min(Y_MAX, Math.max(Y_MIN, ndc));
    return PY1 - ((clamped - Y_MIN) / (Y_MAX - Y_MIN)) * (PY1 - PY0);
  };
  const maxCap = Math.max(...mapRows.map((r) => r.marketCap ?? 0), 1);
  const r = (cap: number | null) => 4.5 + Math.sqrt((cap ?? 1e8) / maxCap) * 21;

  // ── the camera ──
  const clampCam = (c: Cam): Cam => {
    const k = Math.min(3, Math.max(0.8, c.k));
    const padX = 48;
    const padY = 36;
    const cx = k >= 1 ? Math.min(padX, Math.max(W - W * k - padX, c.x)) : (W - W * k) / 2;
    const cy = k >= 1 ? Math.min(padY, Math.max(H - H * k - padY, c.y)) : (H - H * k) / 2;
    return { k, x: cx, y: cy };
  };

  const zoomAt = (px: number, py: number, factor: number) => {
    setCam((c) => {
      const k = Math.min(3, Math.max(0.8, c.k * factor));
      const s = k / c.k;
      return clampCam({ k, x: px - (px - c.x) * s, y: py - (py - c.y) * s });
    });
  };

  const svgPoint = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
  };

  // ctrl/⌘ + wheel = CURSOR-ANCHORED zoom; a plain wheel keeps scrolling the page
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
      dragRef.current = null;
    } else if (pinchRef.current.size === 1) {
      dragRef.current = { sx: e.clientX, sy: e.clientY, px: cam.x, py: cam.y, scale: W / rect.width };
    }
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pinchRef.current.has(e.pointerId)) pinchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchRef.current.size === 2) {
      const [a, b] = [...pinchRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
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
  const sxOfDe = (de: number) => cam.x + xf(de) * cam.k;
  const syOfNdc = (ndc: number) => cam.y + yf(ndc) * cam.k;
  // the VISIBLE domains at the current camera — the fraction→data inverse of
  // the sqrt x transform is de = (f·√xMax)² = f²·xMax (parens matter: the
  // division by the plot width happens INSIDE min/max, or the domain
  // collapses to a sliver — the bug that made only the 0.1x tick render)
  const deAt = (f: number) => f * f * xMax;
  const deVisible: [number, number] = [
    deAt(Math.max(0, ((PX0 - cam.x) / cam.k - PX0) / (PX1 - PX0))),
    Math.min(xMax, deAt(Math.min(1, ((PX1 - cam.x) / cam.k - PX0) / (PX1 - PX0)))),
  ];
  const ndcVisible: [number, number] = [
    Math.max(Y_MIN, ((PY1 - (PY1 - cam.y) / cam.k) - PY0) / (PY1 - PY0) * (Y_MAX - Y_MIN) + Y_MIN),
    Math.max(Y_MIN, ((PY1 - (PY0 - cam.y) / cam.k) - PY0) / (PY1 - PY0) * (Y_MAX - Y_MIN) + Y_MIN),
  ];
  const xTicks = DE_TICKS.filter((t) => t >= deVisible[0] * 0.999 && t <= deVisible[1] * 1.001);
  const yTicks = niceTicks(Math.max(Y_MIN, ndcVisible[0]), Math.min(Y_MAX, ndcVisible[1]), 6);

  // median label positions in SCREEN space (constant font, tracks the line)
  const medX = medDe != null ? sxOfDe(medDe) : null;
  const medY = medNdc != null ? syOfNdc(medNdc) : null;

  // ── the zoom-adaptive, collision-aware NAME layer (same as the valuation map) ──
  const hoverTicker = hover?.ticker ?? null;
  const labels = useMemo(() => {
    type Pos = "inside" | "above" | "below" | "right" | "left";
    type L = { row: ValRow; sx: number; sy: number; sr: number; pos: Pos };
    const xfL = (de: number) => PX0 + (Math.sqrt(Math.max(0, Math.min(de, xMax))) / Math.sqrt(xMax)) * (PX1 - PX0);
    const yfL = (ndc: number) => PY1 - ((Math.min(Y_MAX, Math.max(Y_MIN, ndc)) - Y_MIN) / (Y_MAX - Y_MIN)) * (PY1 - PY0);
    const rf = (cap: number | null) => 4.5 + Math.sqrt((cap ?? 1e8) / maxCap) * 21;
    const placed: Box[] = [];
    const out: L[] = [];
    const sorted = [...mapRows].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
    const order = hoverTicker
      ? [...sorted.filter((rw) => rw.ticker === hoverTicker), ...sorted.filter((rw) => rw.ticker !== hoverTicker)]
      : sorted;
    const touchesBubble = (box: Box, selfTicker: string): boolean =>
      mapRows.some((o) => {
        if (o.ticker === selfTicker) return false;
        const osx = cam.x + xfL(o.de ?? 0) * cam.k;
        const osy = cam.y + yfL(o.netDebtToCap ?? 0) * cam.k;
        const osr = rf(o.marketCap) * cam.k;
        if (osx < PX0 - osr || osx > PX1 + osr || osy < PY0 - osr || osy > PY1 + osr) return false;
        const nx = Math.max(box[0], Math.min(box[2], osx));
        const ny = Math.max(box[1], Math.min(box[3], osy));
        return Math.hypot(nx - osx, ny - osy) < osr;
      });
    for (const row of order) {
      const sx = cam.x + xfL(row.de ?? 0) * cam.k;
      const sy = cam.y + yfL(row.netDebtToCap ?? 0) * cam.k;
      if (sx < PX0 - 60 || sx > PX1 + 60 || sy < PY0 - 60 || sy > PY1 + 60) continue;
      const sr = rf(row.marketCap) * cam.k;
      const w = row.ticker.length * 6.0 + 6;
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
        if (b[0] < PX0 + 1 || b[2] > PX1 - 1 || b[1] < PY0 + 1 || b[3] > PY1 - 1) continue;
        if (cand.pos !== "inside" && touchesBubble(b, row.ticker)) continue;
        if (placed.some((p) => boxesOverlap(b, p))) continue;
        placed.push(b);
        out.push({ row, sx, sy, sr, pos: cand.pos });
        break;
      }
    }
    return out;
  }, [mapRows, cam, xMax, maxCap, hoverTicker]);

  // zone band labels: anchored to the (transformed) band centers, hidden when
  // the center leaves the plot — they MOVE with the graph
  const zoneLabels = useMemo(() => {
    const bands: { zone: DebtZone; cx: number }[] = [
      { zone: "safe", cx: xf(0.25) },
      { zone: "moderate", cx: (xf(0.5) + xf(1)) / 2 },
      { zone: "elevated", cx: (xf(1) + xf(1.5)) / 2 },
      { zone: "high", cx: (xf(1.5) + PX1) / 2 },
    ];
    return bands
      .map((b) => {
        const sx = cam.x + b.cx * cam.k;
        const sy = cam.y + (PY0 + 26) * cam.k;
        return { zone: b.zone, sx, sy, visible: sx > PX0 + 30 && sx < PX1 - 30 && sy > PY0 + 6 && sy < PY1 - 10 };
      })
      .filter((b) => b.visible);
  }, [cam, xMax]);

  const zoneCounts = useMemo(() => {
    const out = new Map<DebtZone, number>();
    for (const row of debtRows) {
      const z = row.debtZone;
      if (z) out.set(z, (out.get(z) ?? 0) + 1);
    }
    return out;
  }, [debtRows]);

  const ranked = useMemo(() => {
    const cmp: Record<typeof sort, (a: ValRow, b: ValRow) => number> = {
      deDesc: (a, b) => (b.de as number) - (a.de as number),
      deAsc: (a, b) => (a.de as number) - (b.de as number),
      adjusted: (a, b) => (a.adjusted ?? 1e9) - (b.adjusted ?? 1e9),
    };
    return [...debtRows].sort(cmp[sort]);
  }, [debtRows, sort]);

  const fmtEgp = (v: number | null): string => {
    if (v == null || !Number.isFinite(v)) return "—";
    if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
    if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return v.toFixed(0);
  };

  return (
    <div className="space-y-3">
      {/* interaction hint */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <MousePointer2 className="h-3 w-3" aria-hidden />
          {lang === "ar"
            ? "اسحب للتجوّل · Ctrl/⌘ + عجلة أو قرصة بإصبعين للتقريب · قرّب لتظهر أسماء أكثر · نقرة مزدوجة لفتح الشركة"
            : "drag to pan · ctrl/⌘ + wheel or two-finger pinch to zoom · zoom in for more names · double-click opens the company"}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {lang === "ar" ? "المحور الأفقي بمقياس جذر مربع — يفرد الكتلة اليسرى (D/E تحت 0.1)" : "x-axis on a square-root scale — it spreads the left mass (D/E under 0.1)"}
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
            <clipPath id="debt-plot-clip">
              <rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} />
            </clipPath>
          </defs>

          {/* ── DATA layer: zone bands + zero line + guides + bubbles, ONE camera, CLIPPED ── */}
          <g clipPath="url(#debt-plot-clip)">
            <g transform={`translate(${cam.x},${cam.y}) scale(${cam.k})`}>
              {/* the four D/E zone bands (vertical tints) */}
              <rect x={PX0} y={PY0} width={xf(0.5) - PX0} height={PY1 - PY0} fill={DEBT_ZONE_META.safe.color} opacity={0.05} />
              <rect x={xf(0.5)} y={PY0} width={xf(1) - xf(0.5)} height={PY1 - PY0} fill={DEBT_ZONE_META.moderate.color} opacity={0.05} />
              <rect x={xf(1)} y={PY0} width={xf(1.5) - xf(1)} height={PY1 - PY0} fill={DEBT_ZONE_META.elevated.color} opacity={0.07} />
              <rect x={xf(1.5)} y={PY0} width={PX1 - xf(1.5)} height={PY1 - PY0} fill={DEBT_ZONE_META.high.color} opacity={0.07} />
              {/* the net-cash band (below the zero line) */}
              <rect x={PX0} y={yf(0)} width={PX1 - PX0} height={PY1 - yf(0)} fill={DEBT_ZONE_META.netCash.color} opacity={0.06} />

              {/* zone threshold lines (0.5 / 1 / 1.5) + the net-cash zero line */}
              {[0.5, 1, 1.5].map((t) => (
                <line key={`zt-${t}`} x1={xf(t)} y1={PY0} x2={xf(t)} y2={PY1} stroke={DEBT_ZONE_META[t < 0.5 ? "safe" : t < 1 ? "moderate" : t < 1.5 ? "elevated" : "high"].color} strokeDasharray="4 4" opacity={0.45} vectorEffect="non-scaling-stroke" />
              ))}
              <line x1={PX0} y1={yf(0)} x2={PX1} y2={yf(0)} stroke={DEBT_ZONE_META.netCash.color} strokeWidth={1.4} opacity={0.7} vectorEffect="non-scaling-stroke" />

              {/* median guides — full-plot lines inside the clip */}
              {medDe != null && (
                <line x1={xf(medDe)} y1={PY0} x2={xf(medDe)} y2={PY1} stroke="currentColor" strokeDasharray="4 4" opacity={0.35} vectorEffect="non-scaling-stroke" />
              )}
              {medNdc != null && (
                <line x1={PX0} y1={yf(medNdc)} x2={PX1} y2={yf(medNdc)} stroke="currentColor" strokeDasharray="4 4" opacity={0.35} vectorEffect="non-scaling-stroke" />
              )}

              {/* the bubbles */}
              {mapRows.map((row) => {
                const cx = xf(row.de ?? 0);
                const cy = yf(row.netDebtToCap ?? 0);
                const rr = r(row.marketCap);
                const color = DEBT_ZONE_META[row.debtZone ?? "safe"].color;
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
          {xTicks.map((de) => {
            const sx = sxOfDe(de);
            if (sx < PX0 + 2 || sx > PX1 - 2) return null;
            return <line key={`gx-${de}`} x1={sx} y1={PY0} x2={sx} y2={PY1} stroke="currentColor" opacity={0.09} vectorEffect="non-scaling-stroke" />;
          })}
          {yTicks.map((ndc) => {
            const sy = syOfNdc(ndc);
            if (sy < PY0 + 2 || sy > PY1 - 2) return null;
            return <line key={`gy-${ndc}`} x1={PX0} y1={sy} x2={PX1} y2={sy} stroke="currentColor" opacity={0.09} vectorEffect="non-scaling-stroke" />;
          })}

          {/* ── CHROME layer (screen space): axes that RE-VALUE themselves ── */}
          <line x1={PX0} y1={PY1} x2={PX1} y2={PY1} stroke="currentColor" opacity={0.3} />
          <line x1={PX0} y1={PY0} x2={PX0} y2={PY1} stroke="currentColor" opacity={0.3} />

          {/* x ticks */}
          {xTicks.map((de) => {
            const sx = sxOfDe(de);
            if (sx < PX0 + 2 || sx > PX1 - 2) return null;
            return (
              <g key={`xt-${de}`}>
                <line x1={sx} y1={PY1} x2={sx} y2={PY1 + 4} stroke="currentColor" opacity={0.35} />
                <text x={sx} y={PY1 + 15} fontSize="9" textAnchor="middle" fill="currentColor" opacity={0.45}>
                  {de === 0 ? "0" : `${de.toFixed(2).replace(/0$/, "")}x`}
                </text>
              </g>
            );
          })}
          {/* y ticks (percent of market value) */}
          {yTicks.map((ndc) => {
            const sy = syOfNdc(ndc);
            if (sy < PY0 + 2 || sy > PY1 - 2) return null;
            return (
              <g key={`yt-${ndc}`}>
                <line x1={PX0 - 4} y1={sy} x2={PX0} y2={sy} stroke="currentColor" opacity={0.35} />
                <text x={PX0 - 7} y={sy + 3} fontSize="9" textAnchor="end" fill="currentColor" opacity={0.45}>
                  {ndc > 0 ? `+${(ndc * 100).toFixed(0)}%` : `${(ndc * 100).toFixed(0)}%`}
                </text>
              </g>
            );
          })}

          {/* zone band labels — screen space, tracking the bands */}
          {zoneLabels.map((z) => (
            <text
              key={`zl-${z.zone}`}
              x={z.sx}
              y={z.sy}
              fontSize="10"
              textAnchor="middle"
              fill={DEBT_ZONE_META[z.zone].color}
              opacity={0.65}
              className="pointer-events-none font-semibold"
            >
              {lang === "ar" ? DEBT_ZONE_META[z.zone].ar : DEBT_ZONE_META[z.zone].en}
            </text>
          ))}

          {/* net-cash band label */}
          <text
            x={cam.x + ((PX0 + PX1) / 2) * cam.k}
            y={Math.min(syOfNdc(-0.06), PY1 - 8)}
            fontSize="9.5"
            textAnchor="middle"
            fill={DEBT_ZONE_META.netCash.color}
            opacity={0.8}
            className="pointer-events-none font-semibold"
          >
            {lang === "ar" ? "نقد يفوق الدين (صافي نقد)" : "cash exceeds debt (net cash)"}
          </text>

          {/* median labels — screen space, constant font, tracking the lines */}
          {medX != null && medX > PX0 + 8 && medX < PX1 - 90 && (
            <text x={medX + 6} y={PY0 + 14} fontSize="10" fill="currentColor" opacity={0.6}>
              {lang === "ar" ? `وسيط D/E: ${medDe?.toFixed(2)}x` : `median D/E: ${medDe?.toFixed(2)}x`}
            </text>
          )}
          {medY != null && medY > PY0 + 10 && medY < PY1 - 8 && (
            <text x={PX1 - 6} y={Math.max(medY - 6, PY0 + 10)} fontSize="10" textAnchor="end" fill="currentColor" opacity={0.6}>
              {lang === "ar" ? `وسيط الدين/سوق ${((medNdc ?? 0) * 100).toFixed(0)}%` : `median net debt/market ${((medNdc ?? 0) * 100).toFixed(0)}%`}
            </text>
          )}

          {/* ── the NAME layer (screen space, collision-aware) ── */}
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
            {lang === "ar" ? "الدين ÷ حقوق الملكية (مقياس الجذر) ← رافعة أعلى" : "D/E (square-root scale) → more leverage"}
          </text>
          <text x={PX0 + 6} y={PY0 + 10} fontSize="11" fill="currentColor" opacity={0.7}>
            {lang === "ar" ? "صافي الدين ÷ القيمة السوقية ↑" : "net debt / market cap ↑"}
          </text>
        </svg>

        {/* hover card — the leverage reading at a glance */}
        {hover && (
          <div className="absolute top-2 end-2 w-60 rounded-lg border bg-card/95 p-2.5 text-xs shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <b className="font-bold">{hover.ticker}</b>
              <button onClick={() => navigate("company", { ticker: hover.ticker })} className="text-primary hover:underline">
                {lang === "ar" ? "افتح ↗" : "open ↗"}
              </button>
            </div>
            <p className="mt-0.5 truncate text-muted-foreground">{lang === "ar" ? hover.nameAr : hover.nameEn}</p>
            <div className="mt-1.5 grid grid-cols-2 gap-1 tabular-nums">
              <span className="text-muted-foreground">D/E</span>
              <span className="text-end font-semibold">{hover.de != null ? `${hover.de.toFixed(2)}x` : "—"}</span>
              <span className="text-muted-foreground">{lang === "ar" ? "صافي الدين" : "net debt"}</span>
              <span className="text-end font-semibold">{hover.netDebt != null ? `EGP ${fmtEgp(hover.netDebt)}` : "—"}</span>
              <span className="text-muted-foreground">{lang === "ar" ? "الدين ÷ السوق" : "net debt / market"}</span>
              <span className="text-end font-semibold">{hover.netDebtToCap != null ? `${(hover.netDebtToCap * 100).toFixed(0)}%` : "—"}</span>
              <span className="text-muted-foreground">{lang === "ar" ? "المكرر المعدّل" : "adjusted P/E"}</span>
              <span className="text-end font-semibold">{hover.adjusted != null ? `${hover.adjusted.toFixed(1)}x` : "—"}</span>
              <span className="text-muted-foreground">{lang === "ar" ? "صافي الربح TTM" : "net income TTM"}</span>
              <span className="text-end font-semibold">{hover.netIncomeTTM != null ? `EGP ${fmtEgp(hover.netIncomeTTM)}` : "—"}</span>
              <span className="text-muted-foreground">{lang === "ar" ? "القيمة السوقية" : "cap"}</span>
              <span className="text-end font-semibold">{fmtCap(hover.marketCap)}</span>
            </div>
            {hover.debtZone && (
              <p className="mt-1.5 border-t pt-1.5 text-[10px]" style={{ color: DEBT_ZONE_META[hover.debtZone].color }}>
                {lang === "ar" ? DEBT_ZONE_META[hover.debtZone].ar : DEBT_ZONE_META[hover.debtZone].en} —{" "}
                {lang === "ar" ? DEBT_ZONE_META[hover.debtZone].hintAr : DEBT_ZONE_META[hover.debtZone].hintEn}
              </p>
            )}
            {hover.fv != null && (
              <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
                {lang === "ar" ? "القيمة العادلة" : "fair value"} {fmt2(hover.fv)} · {lang === "ar" ? "الفرق" : "upside"}{" "}
                <b style={{ color: hover.upside != null && hover.upside >= 0 ? "#10b981" : "#ef4444" }}>
                  {hover.upside != null ? `${hover.upside >= 0 ? "+" : ""}${hover.upside.toFixed(0)}%` : "—"}
                </b>
              </p>
            )}
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

      {/* zone legend with counts */}
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        {(Object.keys(DEBT_ZONE_META) as DebtZone[]).map((z) => (
          <span key={z} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: DEBT_ZONE_META[z].color }} />
            <span className="font-medium">{lang === "ar" ? DEBT_ZONE_META[z].ar : DEBT_ZONE_META[z].en}</span>
            <span className="tabular-nums text-muted-foreground">
              · {zoneCounts.get(z) ?? 0} {lang === "ar" ? DEBT_ZONE_META[z].hintAr : DEBT_ZONE_META[z].hintEn}
            </span>
          </span>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {lang === "ar"
          ? `مساحة كل فقعة تمثل القيمة السوقية، وأسماء أكبر الشركات تظهر دائمًا — وكلما قرّبت ظهرت أسماء أكثر. المقياس الأفقي جذري لأن أغلب الشركات ديونها صغيرة. ${mapRows.length} من ${debtRows.length} شركة لها D/E منشور ظهرت على الخريطة — البقية في لوحة الأثر والجدول أدناه.`
          : `Bubble area = market cap; the biggest companies are always named — zoom in and more names appear. The x-axis is square-rooted because most companies carry small debt. ${mapRows.length} of ${debtRows.length} companies with a published D/E made it onto the map — the rest stay in the impact panel and the table below.`}
      </p>

      {/* T68 — PER-COMPANY DEBT IMPACT: every company's leverage reading
          illustrated on the SAME page, hover-linked to the map bubble */}
      <DebtImpactPanel rows={debtRows} lang={lang} onHover={setHover} onOpen={(ticker) => navigate("company", { ticker })} />

      {/* the leverage ranking */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">
            {lang === "ar" ? `ترتيب الرافعة · ${debtRows.length} شركة` : `Leverage ranking · ${debtRows.length} companies`}
          </h2>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            {(
              [
                ["deDesc", lang === "ar" ? "الأكثر رفعًا" : "most leveraged"],
                ["deAsc", lang === "ar" ? "الأكثر أمانًا" : "safest"],
                ["adjusted", lang === "ar" ? "المكرر المعدّل" : "adjusted multiple"],
              ] as [typeof sort, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setSort(k)}
                className={`rounded-full border px-2 py-0.5 transition-colors ${
                  sort === k ? "border-foreground/20 bg-secondary font-semibold" : "border-transparent hover:bg-accent"
                }`}
              >
                {label}
              </button>
            ))}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {lang === "ar"
            ? "المضاعف المعدّل = المكرر × (1 + الدين/الملكية): ما تدفعه مقابل كل جنيه أرباح بعد تسعير الرافعة في الميزانية."
            : "Adjusted multiple = P/E × (1 + D/E): what you pay per pound of earnings once balance-sheet leverage is priced in."}
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {ranked.slice(0, 36).map((row) => {
            const zone = row.debtZone != null ? DEBT_ZONE_META[row.debtZone] : null;
            return (
              <button
                key={row.ticker}
                onClick={() => navigate("company", { ticker: row.ticker })}
                className="flex items-center gap-2 rounded-lg border bg-card p-2 text-start text-xs transition-colors hover:bg-accent"
              >
                {zone && <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: zone.color }} />}
                <span className="w-12 shrink-0 font-bold">{row.ticker}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{lang === "ar" ? row.nameAr : row.nameEn}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {row.netDebt != null ? `ND ${fmtEgp(row.netDebt)}` : "ND —"}
                </span>
                <span className="w-20 shrink-0 text-end tabular-nums">
                  <b className="font-semibold">{row.de != null ? `${fmt1(row.de)}x` : "—"}</b>
                  <span className="text-muted-foreground"> · {row.adjusted != null ? `${row.adjusted.toFixed(1)}x` : "—"}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** T68 — the per-company DEBT impact panel: for every company with a
 *  published D/E, the one-line reading of what its leverage MEANS — the
 *  zone (net cash → high leverage) with net debt in EGP, the burden priced
 *  against the market value, and the debt-adjusted multiple — rendered as
 *  an impact sentence + colored chips, sortable four ways, hover-linked to
 *  the map bubble (hovering a row highlights its bubble and opens its card). */
function DebtImpactPanel({
  rows,
  lang,
  onHover,
  onOpen,
}: {
  rows: ValRow[];
  lang: "ar" | "en";
  onHover: (row: ValRow | null) => void;
  onOpen: (ticker: string) => void;
}) {
  const [sort, setSort] = useState<"cap" | "de" | "ndc" | "adjusted">("cap");

  const sorted = useMemo(() => {
    const out = [...rows];
    if (sort === "cap") out.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
    if (sort === "de") out.sort((a, b) => (b.de ?? -Infinity) - (a.de ?? -Infinity));
    if (sort === "ndc") out.sort((a, b) => (b.netDebtToCap ?? -Infinity) - (a.netDebtToCap ?? -Infinity));
    if (sort === "adjusted") out.sort((a, b) => (b.adjusted ?? -Infinity) - (a.adjusted ?? -Infinity));
    return out;
  }, [rows, sort]);

  const counts = useMemo(() => {
    const out = new Map<DebtZone, number>();
    for (const row of rows) {
      const z = row.debtZone;
      if (z) out.set(z, (out.get(z) ?? 0) + 1);
    }
    return out;
  }, [rows]);

  const sortChips: { key: typeof sort; ar: string; en: string }[] = [
    { key: "cap", ar: "الأكبر سوقيًا", en: "Biggest" },
    { key: "de", ar: "الأكثر ديونًا", en: "Most debt" },
    { key: "ndc", ar: "الأثقل مقابل السوق", en: "Heaviest vs market" },
    { key: "adjusted", ar: "الأغلى بالدين", en: "Priciest with debt" },
  ];

  const fmtEgp = (v: number | null): string => {
    if (v == null || !Number.isFinite(v)) return "—";
    if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
    if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return v.toFixed(0);
  };

  /** the impact sentence: what this company's leverage actually means. */
  const impactOf = (row: ValRow): string => {
    const deTxt = row.de != null ? `${row.de.toFixed(2)}×` : "—";
    if (row.debtZone === "netCash" || (row.netDebt != null && row.netDebt < 0)) {
      return lang === "ar"
        ? `صافي نقد — نقد يفوق ديونها بـ ${fmtEgp(Math.abs(row.netDebt ?? 0))} جنيه: وسادة دفاعية تقيها من ضغوط الرفع وتمنح مرونة توزيعات`
        : `net cash — cash exceeds debt by EGP ${fmtEgp(Math.abs(row.netDebt ?? 0))}: a defensive cushion against refinancing pressure and dividend flexibility`;
    }
    if (row.debtZone === "high" || row.debtZone === "elevated") {
      const heavy = row.netDebtToCap != null && row.netDebtToCap > 0.5;
      return lang === "ar"
        ? `مثقلة بالمديونية — D/E ${deTxt}${heavy ? `، وصافي دينها يعادل ${(row.netDebtToCap! * 100).toFixed(0)}% من قيمتها السوقية` : ""}${row.adjusted != null ? `؛ المكرر المعدّل بالدين ${row.adjusted.toFixed(1)}× يعني أنك تدفع هذا العلاوة مقابل كل جنيه أرباح` : ""}`
        : `debt-heavy — D/E ${deTxt}${heavy ? `, and its net debt equals ${(row.netDebtToCap! * 100).toFixed(0)}% of its market value` : ""}${row.adjusted != null ? `; the debt-adjusted ${row.adjusted.toFixed(1)}× multiple means that is the real price you pay per pound of earnings` : ""}`;
    }
    if (row.debtZone === "moderate") {
      return lang === "ar"
        ? `رفع متوسط — D/E ${deTxt} (${fmtEgp(row.netDebt)} جنيه صافي دين): عبء قابل للإدارة بشرط استقرار الأرباح والفائدة`
        : `moderate leverage — D/E ${deTxt} (EGP ${fmtEgp(row.netDebt)} net debt): a manageable burden while earnings and rates hold`;
    }
    if (row.debtZone === "safe") {
      return lang === "ar"
        ? `ديون آمنة — D/E ${deTxt}: رافعة منخفضة تترك هامشًا واسعًا للاقتراض المستقبلي${row.netDebtToCap != null && row.netDebtToCap > 0 ? ` (صافي دين ${ (row.netDebtToCap * 100).toFixed(0)}% من السوق)` : ""}`
        : `safe debt — D/E ${deTxt}: low leverage leaves wide headroom for future borrowing${row.netDebtToCap != null && row.netDebtToCap > 0 ? ` (net debt ${(row.netDebtToCap * 100).toFixed(0)}% of market)` : ""}`;
    }
    return lang === "ar" ? "قراءة متوازنة — لا مثقلات ولا صافي نقد" : "balanced reading — no flags either way";
  };

  const chip = (label: string, color: string, title?: string) => (
    <span
      className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
      style={{ color, backgroundColor: `${color}1a` }}
      title={title}
      dir="auto"
    >
      {label}
    </span>
  );

  return (
    <div className="rounded-xl border bg-card/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold leading-snug">
            {lang === "ar" ? "أثر كل شركة — المديونية والرافعة" : "Each company's impact — leverage & debt"}
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {lang === "ar"
              ? "قراءة مديونية كل شركة مرسومة على الخريطة أعلاه: المنطقة، صافي الدين بالجنيه، وثقله مقابل القيمة السوقية والمكرر المعدّل — مرّر على أي صف لإبراز فقعته على الخريطة."
              : "The leverage reading of every company plotted on the map above: zone, net debt in EGP, its weight vs the market value, and the adjusted multiple — hover a row to highlight its bubble on the map."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {sortChips.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSort(s.key)}
              className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-colors ${
                sort === s.key ? "bg-primary/15 text-primary border-primary/40" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {lang === "ar" ? s.ar : s.en}
            </button>
          ))}
        </div>
      </div>

      {/* the summary strip — the section's headline numbers */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {(Object.keys(DEBT_ZONE_META) as DebtZone[]).map((z) => (
          <span key={z} className="flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ backgroundColor: DEBT_ZONE_META[z].color }} />
            <span className="font-medium">{lang === "ar" ? DEBT_ZONE_META[z].ar : DEBT_ZONE_META[z].en}</span>
            <b className="tabular-nums">{counts.get(z) ?? 0}</b>
          </span>
        ))}
        <span className="text-muted-foreground">
          {lang === "ar" ? `من أصل ${rows.length} شركة لديها D/E منشور` : `of ${rows.length} companies with a published D/E`}
        </span>
      </div>

      {/* the rows */}
      <div className="thin-scroll mt-2 max-h-[420px] overflow-auto pe-1">
        <ul className="space-y-1">
          {sorted.map((row) => {
            const zMeta = row.debtZone ? DEBT_ZONE_META[row.debtZone] : null;
            return (
              <li key={row.ticker}>
                <button
                  type="button"
                  className="w-full rounded-lg border bg-background/60 px-2.5 py-1.5 text-start transition-colors hover:bg-accent/50"
                  onMouseEnter={() => onHover(row)}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => onOpen(row.ticker)}
                  title={lang === "ar" ? "افتح صفحة الشركة" : "open the company page"}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-xs font-bold">
                      <span className="tabular-nums" dir="ltr">{row.ticker}</span>
                      <span className="ms-1.5 font-medium text-muted-foreground">{lang === "ar" ? row.nameAr : row.nameEn}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {row.de != null &&
                        chip(
                          `D/E ${row.de.toFixed(2)}×`,
                          zMeta?.color ?? "#64748b",
                          zMeta ? `${lang === "ar" ? zMeta.hintAr : zMeta.hintEn}` : undefined
                        )}
                      {row.netDebt != null &&
                        chip(
                          `ND ${fmtEgp(row.netDebt)}`,
                          row.netDebt < 0 ? DEBT_ZONE_META.netCash.color : "#64748b",
                          lang === "ar" ? "صافي الدين بالجنيه المصري" : "net debt in EGP"
                        )}
                      {row.netDebtToCap != null &&
                        chip(
                          `${row.netDebtToCap > 0 ? "+" : ""}${(row.netDebtToCap * 100).toFixed(0)}%${lang === "ar" ? " سوق" : " mkt"}`,
                          row.netDebtToCap > 0.5 ? "#ef4444" : row.netDebtToCap > 0.2 ? "#f59e0b" : "#64748b",
                          lang === "ar" ? "صافي الدين ÷ القيمة السوقية" : "net debt ÷ market cap"
                        )}
                      {row.adjusted != null &&
                        chip(
                          `${row.adjusted.toFixed(1)}×${lang === "ar" ? " مُعدّل" : " adj"}`,
                          row.adjusted > 30 ? "#ef4444" : "#64748b",
                          lang === "ar" ? "المكرر × (1 + الدين/الملكية)" : "P/E × (1 + D/E)"
                        )}
                    </span>
                  </div>
                  {/* the impact sentence — WHAT the leverage means */}
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground" dir="auto">
                    {impactOf(row)}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
        {lang === "ar"
          ? "«مثقلة بالمديونية» = D/E فوق 1× (منطقة رفع مرتفع أو أعلى)؛ «صافي نقد» = نقد يفوق الدين؛ «% سوق» = صافي الدين ÷ القيمة السوقية — كل الأرقام من القوائم المنشورة، لا تقديرات."
          : "“Debt-heavy” = D/E above 1× (elevated zone or higher); “net cash” = cash exceeds debt; “% market” = net debt ÷ market value — all figures from published statements, never estimates."}
      </p>
    </div>
  );
}
