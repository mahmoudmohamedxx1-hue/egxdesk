"use client";

/** T64 → T65 — the valuation MAP tab: every company with a published P/E and
 *  D/E on one 2D map — x = what you pay for earnings, y = how leveraged the
 *  balance sheet is, bubble = market cap. Two color modes: the four reading
 *  quadrants (median lines printed) or the FAIR VALUE lens — each bubble
 *  painted by its upside vs the five-model blended fair value (deep green
 *  = far below fair value, deep red = far above).
 *
 *  T65 — THE ZOOM IS NOW SYNCHRONIZED WITH THE GRAPH: the user reported that
 *  zooming moved the bubbles while the axes/tints/median guides stayed
 *  frozen. The whole DATA layer (quadrant tints, median guides, bubbles)
 *  now lives inside ONE camera transform, and the AXES are drawn in screen
 *  space with their tick values RE-COMPUTED from the visible domain at
 *  every camera change — exactly how a professional chart zooms: the grid
 *  moves with the data, the labels re-value themselves, and nothing ever
 *  desyncs. Zoom is cursor-anchored (ctrl/⌘ + wheel, buttons, pinch via
 *  ctrl+wheel), drag pans, labels scale sub-linearly (√k) so they stay
 *  readable at every zoom, and bubble strokes use non-scaling-stroke so
 *  they stay hairline-thin at 3×. */

import { useEffect, useRef, useState } from "react";
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

/** "nice" tick values for a visible domain — 1/2/2.5/5×10^n steps. */
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

export function ValuationMapTab({ data, rows }: { data: ValData; rows: ValRow[] }) {
  const { lang, navigate } = useApp();
  const [mode, setMode] = useState<ColorMode>("quadrant");
  const [cam, setCam] = useState<Cam>({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<ValRow | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number; scale: number } | null>(null);
  const movedRef = useRef(0);

  // axis caps at the 96th percentile so one outlier doesn't flatten the map
  const peSort = rows.map((r) => r.pe).filter((v): v is number => v != null).sort((a, b) => a - b);
  const deSort = rows.map((r) => r.de).filter((v): v is number => v != null).sort((a, b) => a - b);
  const p96 = (xs: number[]) => xs[Math.floor(xs.length * 0.96)];
  const axes = {
    xMax: Math.max(20, Math.ceil(p96(peSort) ?? 40)),
    yMax: Math.max(2, Math.ceil((p96(deSort) ?? 4) * 10) / 10),
    medianPe: data.medianPe ?? 15,
    medianDe: data.medianDe ?? 1,
  };

  // data-space → SVG-plot mapping (clamped at the axis caps, as before)
  const x = (pe: number) => PX0 + (Math.min(pe, axes.xMax) / axes.xMax) * (PX1 - PX0);
  const y = (de: number) => PY1 - (Math.min(de, axes.yMax) / axes.yMax) * (PY1 - PY0);
  const maxCap = Math.max(...rows.map((r) => r.marketCap ?? 0), 1);
  const r = (cap: number | null) => 5 + Math.sqrt((cap ?? 1e8) / maxCap) * 26;

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

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    movedRef.current = 0;
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: cam.x, py: cam.y, scale: W / rect.width };
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    movedRef.current = Math.abs(dx) + Math.abs(dy);
    setCam((c) => clampCam({ k: c.k, x: d.px + dx * d.scale, y: d.py + dy * d.scale }));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const reset = () => setCam({ k: 1, x: 0, y: 0 });

  // ── screen-space values derived from the camera (the synchronized axes) ──
  // data-space pe → screen x, and back
  const sxOfPe = (pe: number) => cam.x + x(pe) * cam.k;
  const syOfDe = (de: number) => cam.y + y(de) * cam.k;
  // the VISIBLE domain at the current camera
  const peVisible: [number, number] = [
    Math.max(0, ((PX0 - cam.x) / cam.k - PX0) / (PX1 - PX0) * axes.xMax),
    Math.max(0, ((PX1 - cam.x) / cam.k - PX0) / (PX1 - PX0) * axes.xMax),
  ];
  const deVisible: [number, number] = [
    Math.max(0, ((PY1 - (PY1 - cam.y) / cam.k) - PY0) / (PY1 - PY0) * axes.yMax),
    Math.max(0, ((PY1 - (PY0 - cam.y) / cam.k) - PY0) / (PY1 - PY0) * axes.yMax),
  ];
  const xTicks = niceTicks(peVisible[0], peVisible[1]);
  const yTicks = niceTicks(deVisible[0], deVisible[1]);

  // median label positions in SCREEN space (constant font, tracks the line)
  const medX = sxOfPe(axes.medianPe);
  const medY = syOfDe(axes.medianDe);
  const medXVisible = medX > PX0 + 8 && medX < PX1 - 8;
  const medYVisible = medY > PY0 + 8 && medY < PY1 - 8;

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
            ? "اسحب للتجوّل · Ctrl/⌘ + عجلة للتقريب حيث يشير المؤشر · نقرة مزدوجة لفتح الشركة"
            : "drag to pan · ctrl/⌘ + wheel to zoom at the cursor · double-click opens the company"}
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
          onPointerLeave={onPointerUp}
        >
          {/* ── DATA layer: tints + median guides + bubbles, ONE camera ── */}
          <g transform={`translate(${cam.x},${cam.y}) scale(${cam.k})`}>
            {/* quadrant tints (reading aid in both modes — faint by design) */}
            <rect x={x(axes.medianPe)} y={PY0} width={PX1 - x(axes.medianPe)} height={y(axes.medianDe) - PY0} fill={QUADRANT_COLORS.expensive} opacity={mode === "quadrant" ? 0.05 : 0.02} />
            <rect x={PX0} y={PY0} width={x(axes.medianPe) - PX0} height={y(axes.medianDe) - PY0} fill={QUADRANT_COLORS.leveraged} opacity={mode === "quadrant" ? 0.05 : 0.02} />
            <rect x={x(axes.medianPe)} y={y(axes.medianDe)} width={PX1 - x(axes.medianPe)} height={PY1 - y(axes.medianDe)} fill={QUADRANT_COLORS.quality} opacity={mode === "quadrant" ? 0.05 : 0.02} />
            <rect x={PX0} y={y(axes.medianDe)} width={x(axes.medianPe) - PX0} height={PY1 - y(axes.medianDe)} fill={QUADRANT_COLORS.value} opacity={mode === "quadrant" ? 0.05 : 0.02} />

            {/* median guides */}
            <line x1={x(axes.medianPe)} y1={PY0} x2={x(axes.medianPe)} y2={PY1} stroke="currentColor" strokeDasharray="4 4" opacity={0.35} vectorEffect="non-scaling-stroke" />
            <line x1={PX0} y1={y(axes.medianDe)} x2={PX1} y2={y(axes.medianDe)} stroke="currentColor" strokeDasharray="4 4" opacity={0.35} vectorEffect="non-scaling-stroke" />

            {/* the bubbles — labels scale sub-linearly (√k) so they stay
                readable at every zoom while everything moves together */}
            {rows.map((row) => {
              const cx = x(row.pe ?? 0);
              const cy = y(row.de ?? 0);
              const rr = r(row.marketCap);
              const color = bubbleColor(row);
              return (
                <g key={row.ticker}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={rr}
                    fill={color}
                    opacity={hover?.ticker === row.ticker ? 0.85 : 0.55}
                    stroke={color}
                    strokeWidth={hover?.ticker === row.ticker ? 2.5 : 1}
                    vectorEffect="non-scaling-stroke"
                    className="cursor-pointer"
                    onClick={(e) => {
                      if (movedRef.current >= 5) return;
                      e.stopPropagation();
                      setHover(row);
                    }}
                    onDoubleClick={() => navigate("company", { ticker: row.ticker })}
                  />
                  {rr > 15 && (
                    <text
                      x={cx}
                      y={cy + 3}
                      fontSize={Math.min(10, rr / 2.6) * Math.sqrt(cam.k)}
                      textAnchor="middle"
                      fill="currentColor"
                      opacity={0.85}
                      className="pointer-events-none font-semibold"
                    >
                      {row.ticker}
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          {/* ── CHROME layer (screen space): axes that RE-VALUE themselves ── */}
          {/* axis lines */}
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
                  {pe >= 10 ? pe.toFixed(0) : pe.toFixed(1)}x
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

          {/* median labels — screen space, constant font, tracking the lines */}
          {medXVisible && (
            <text x={Math.min(medX + 6, PX1 - 90)} y={PY0 + 14} fontSize="10" fill="currentColor" opacity={0.6}>
              {lang === "ar" ? `وسيط P/E: ${axes.medianPe.toFixed(1)}x` : `median P/E: ${axes.medianPe.toFixed(1)}x`}
            </text>
          )}
          {medYVisible && (
            <text x={PX1 - 6} y={Math.max(medY - 6, PY0 + 10)} fontSize="10" textAnchor="end" fill="currentColor" opacity={0.6}>
              {lang === "ar" ? `حد الدين ${axes.medianDe.toFixed(2)}x` : `debt line ${axes.medianDe.toFixed(2)}x`}
            </text>
          )}

          {/* axis titles */}
          <text x={PX1} y={PY1 + 30} textAnchor="end" fontSize="11" fill="currentColor" opacity={0.7}>
            {lang === "ar" ? "مكرر الربحية (P/E) ← الأغلى يميناً" : "P/E → more expensive rightward"}
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
          ? "مساحة كل فقاعة تمثل القيمة السوقية. اضغط على أي شركة لعرض مضاعفاتها وقيمتها العادلة، ونقرة مزدوجة لفتح صفحتها. الخطان المنقطان وسيطا السوق كله — والمحاور والشبكة يتحركون مع التكبير معًا."
          : "Bubble area = market cap. Click a company for its multiples and fair value, double-click to open its page. The dashed lines are the whole market's medians — and the axes and grid move together with the zoom."}
      </p>
    </div>
  );
}
