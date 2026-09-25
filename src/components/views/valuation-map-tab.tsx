"use client";

/** T64 — the valuation MAP tab: every company with a published P/E and D/E
 *  on one 2D map — x = what you pay for earnings, y = how leveraged the
 *  balance sheet is, bubble = market cap. Two color modes: the four reading
 *  quadrants (median lines printed) or the FAIR VALUE lens — each bubble
 *  painted by its upside vs the five-model blended fair value (deep green
 *  = far below fair value, deep red = far above).
 *
 *  Improvements over the first cut: drag to pan, ctrl/⌘+wheel to zoom
 *  (plain wheel keeps scrolling the page — never hijacked), a richer hover
 *  card (fair value, upside, P/B, ROE, dividend yield, debt zone, a jump to
 *  the model lab), and honest median guides unchanged. */

import { useEffect, useRef, useState } from "react";
import { useApp } from "../market/app-context";
import { ZoomIn, ZoomOut, MousePointer2, FlaskConical } from "lucide-react";
import { upsideColor } from "@/lib/fair-value";
import { fmt1, fmt2, fmtCap, fmtPct, type ValData, type ValRow } from "./valuation-shared";

const W = 960;
const H = 560;

const QUADRANT_COLORS: Record<string, string> = {
  value: "#10b981",
  leveraged: "#f59e0b",
  quality: "#3b82f6",
  expensive: "#ef4444",
};

type ColorMode = "quadrant" | "fair";

export function ValuationMapTab({ data, rows }: { data: ValData; rows: ValRow[] }) {
  const { lang, navigate } = useApp();
  const [mode, setMode] = useState<ColorMode>("quadrant");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
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

  const x = (pe: number) => 70 + (Math.min(pe, axes.xMax) / axes.xMax) * (W - 110);
  const y = (de: number) => H - 60 - (Math.min(de, axes.yMax) / axes.yMax) * (H - 100);
  const maxCap = Math.max(...rows.map((r) => r.marketCap ?? 0), 1);
  const r = (cap: number | null) => 5 + Math.sqrt((cap ?? 1e8) / maxCap) * 26;

  const bubbleColor = (row: ValRow): string =>
    mode === "fair" ? upsideColor(row.upside) : QUADRANT_COLORS[row.quadrant ?? "expensive"];

  // ctrl/⌘ + wheel = zoom (non-passive so the pinch gesture can be stopped);
  // a plain wheel keeps scrolling the page — it is never hijacked.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom((z) => Math.min(3, Math.max(0.8, z * Math.exp(-e.deltaY * 0.0022))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const clampPan = (px: number, py: number, z: number) => ({
    x: Math.min(60, Math.max(W * (1 - z) - 60, px)),
    y: Math.min(60, Math.max(H * (1 - z) - 60, py)),
  });

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    movedRef.current = 0;
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, scale: W / rect.width };
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    movedRef.current = Math.abs(dx) + Math.abs(dy);
    setPan(clampPan(d.px + dx * d.scale, d.py + dy * d.scale, zoom));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

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
          {lang === "ar" ? "اسحب للتجوّل · Ctrl/⌘ + عجلة للتقريب · نقرة مزدوجة لفتح الشركة" : "drag to pan · ctrl/⌘ + wheel to zoom · double-click opens the company"}
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
          {/* quadrant tints (reading aid in both modes — faint by design) */}
          <rect x={x(axes.medianPe)} y={30} width={W - 40 - x(axes.medianPe)} height={y(axes.medianDe) - 30} fill={QUADRANT_COLORS.expensive} opacity={mode === "quadrant" ? 0.05 : 0.02} />
          <rect x={70} y={30} width={x(axes.medianPe) - 70} height={y(axes.medianDe) - 30} fill={QUADRANT_COLORS.leveraged} opacity={mode === "quadrant" ? 0.05 : 0.02} />
          <rect x={x(axes.medianPe)} y={y(axes.medianDe)} width={W - 40 - x(axes.medianPe)} height={H - 60 - y(axes.medianDe)} fill={QUADRANT_COLORS.quality} opacity={mode === "quadrant" ? 0.05 : 0.02} />
          <rect x={70} y={y(axes.medianDe)} width={x(axes.medianPe) - 70} height={H - 60 - y(axes.medianDe)} fill={QUADRANT_COLORS.value} opacity={mode === "quadrant" ? 0.05 : 0.02} />

          {/* median guides */}
          <line x1={x(axes.medianPe)} y1={30} x2={x(axes.medianPe)} y2={H - 60} stroke="currentColor" strokeDasharray="4 4" opacity={0.35} />
          <line x1={70} y1={y(axes.medianDe)} x2={W - 40} y2={y(axes.medianDe)} stroke="currentColor" strokeDasharray="4 4" opacity={0.35} />
          <text x={x(axes.medianPe) + 6} y={44} fontSize="10" fill="currentColor" opacity={0.6}>
            {lang === "ar" ? `وسيط P/E: ${axes.medianPe.toFixed(1)}x` : `median P/E: ${axes.medianPe.toFixed(1)}x`}
          </text>
          <text x={W - 44} y={y(axes.medianDe) - 6} fontSize="10" textAnchor="end" fill="currentColor" opacity={0.6}>
            {lang === "ar" ? `حد الدين ${axes.medianDe.toFixed(2)}x` : `debt line ${axes.medianDe.toFixed(2)}x`}
          </text>

          {/* axes */}
          <line x1={70} y1={H - 60} x2={W - 40} y2={H - 60} stroke="currentColor" opacity={0.3} />
          <line x1={70} y1={30} x2={70} y2={H - 60} stroke="currentColor" opacity={0.3} />
          <text x={W - 40} y={H - 40} textAnchor="end" fontSize="11" fill="currentColor" opacity={0.7}>
            {lang === "ar" ? "مكرر الربحية (P/E) ← الأغلى يميناً" : "P/E → more expensive rightward"}
          </text>
          <text x={76} y={40} fontSize="11" fill="currentColor" opacity={0.7}>
            {lang === "ar" ? "D/E ↑ رافعة أعلى" : "D/E ↑ more leverage"}
          </text>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <text key={`x${f}`} x={70 + f * (W - 110)} y={H - 46} fontSize="9" textAnchor="middle" fill="currentColor" opacity={0.45}>
              {(axes.xMax * f).toFixed(0)}x
            </text>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <text key={`y${f}`} x={64} y={H - 60 - f * (H - 100) + 3} fontSize="9" textAnchor="end" fill="currentColor" opacity={0.45}>
              {(axes.yMax * f).toFixed(1)}x
            </text>
          ))}

          {/* the bubbles */}
          <g transform={`translate(${(W / 2) * (1 - zoom) + pan.x}, ${(H / 2) * (1 - zoom) + pan.y}) scale(${zoom})`}>
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
                      fontSize={Math.min(10, rr / 2.6)}
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
          <button className="rounded-md border bg-card/90 px-2 py-1 hover:bg-accent" onClick={() => setZoom((z) => Math.min(3, z * 1.3))} aria-label="zoom in">
            <ZoomIn className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button className="rounded-md border bg-card/90 px-2 py-1 hover:bg-accent" onClick={() => setZoom((z) => Math.max(0.8, z / 1.3))} aria-label="zoom out">
            <ZoomOut className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button className="rounded-md border bg-card/90 px-2 py-1 tabular-nums hover:bg-accent" onClick={reset}>
            {zoom.toFixed(1)}× · {lang === "ar" ? "إعادة" : "reset"}
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
          ? "مساحة كل فقاعة تمثل القيمة السوقية. اضغط على أي شركة لعرض مضاعفاتها وقيمتها العادلة، ونقرة مزدوجة لفتح صفحتها. الخطان المنقطان وسيطا السوق كله."
          : "Bubble area = market cap. Click a company for its multiples and fair value, double-click to open its page. The dashed lines are the whole market's medians."}
      </p>
    </div>
  );
}
