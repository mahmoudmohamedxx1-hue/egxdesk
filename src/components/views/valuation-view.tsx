"use client";

/** T60 — المزيد → التقييم والديون (the valuation & debt map), cloned from
 *  the source model's screen: every listed company with a P/E and a D/E on
 *  one 2D map — x = what you pay for earnings, y = how leveraged the balance
 *  sheet is, bubble = market cap, four reading quadrants, a sector filter,
 *  zoom, and the debt-adjusted multiple list.
 *
 *  Honesty rules: the quadrants are reading aids (median lines printed),
 *  the debt-adjusted multiple is the ranking column, and the map shows
 *  only companies whose P/E and D/E are actually published — no point is
 *  invented to fill a sector. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../market/app-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Scale, ZoomIn, ZoomOut } from "lucide-react";

type Row = {
  ticker: string;
  nameAr: string;
  nameEn: string;
  sector: string;
  sectorAr: string;
  pe: number;
  de: number;
  marketCap: number | null;
  adjusted: number;
  quadrant: "value" | "leveraged" | "quality" | "expensive";
};

type Data = {
  asOf: string;
  total: number;
  medianPe: number | null;
  medianDe: number | null;
  counts: { value: number; leveraged: number; quality: number; expensive: number };
  quadrants: Record<string, { ar: string; en: string; hintAr: string; hintEn: string }>;
  sectors: { sector: string; sectorAr: string; count: number; medianPe: number | null; medianDe: number | null }[];
  rows: Row[];
};

const W = 960;
const H = 560;

const QUADRANT_COLORS: Record<string, string> = {
  value: "#10b981",
  leveraged: "#f59e0b",
  quality: "#3b82f6",
  expensive: "#ef4444",
};

export function ValuationView() {
  const { lang, navigate } = useApp();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [sector, setSector] = useState<string>("all");
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<Row | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    fetch("/api/valuation-map")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("x"))))
      .then((d: Data) => setData(d))
      .catch(() => setError(true));
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return sector === "all" ? data.rows : data.rows.filter((r) => r.sectorAr === sector);
  }, [data, sector]);

  const axes = useMemo(() => {
    if (!data || !rows.length) return { xMax: 40, yMax: 4, medianPe: 15, medianDe: 1 };
    // axis caps at the 96th percentile so one outlier doesn't flatten the map
    const peSort = [...rows].map((r) => r.pe).sort((a, b) => a - b);
    const deSort = [...rows].map((r) => r.de).sort((a, b) => a - b);
    const p96 = (xs: number[]) => xs[Math.floor(xs.length * 0.96)];
    return {
      xMax: Math.max(20, Math.ceil(p96(peSort))),
      yMax: Math.max(2, Math.ceil(p96(deSort) * 10) / 10),
      medianPe: data.medianPe ?? 15,
      medianDe: data.medianDe ?? 1,
    };
  }, [data, rows]);

  if (error) {
    return (
      <div className="space-y-3 p-4">
        <h1 className="text-lg font-bold">{lang === "ar" ? "خريطة التقييم والديون" : "Valuation & debt map"}</h1>
        <p className="text-sm text-muted-foreground">{lang === "ar" ? "تعذّر التحميل." : "Unavailable."}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-[60vh] w-full rounded-xl" />
      </div>
    );
  }

  const x = (pe: number) => 70 + (Math.min(pe, axes.xMax) / axes.xMax) * (W - 110);
  const y = (de: number) => H - 60 - (Math.min(de, axes.yMax) / axes.yMax) * (H - 100);
  const r = (cap: number | null) => {
    const max = Math.max(...rows.map((r2) => r2.marketCap ?? 0), 1);
    return 5 + Math.sqrt((cap ?? 1e8) / max) * 26;
  };

  const fmtCap = (cap: number | null): string => {
    if (!cap) return "—";
    if (cap >= 1e12) return `${(cap / 1e12).toFixed(1)}T`;
    if (cap >= 1e9) return `${(cap / 1e9).toFixed(1)}B`;
    if (cap >= 1e6) return `${(cap / 1e6).toFixed(0)}M`;
    return String(Math.round(cap));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-primary" aria-hidden />
          <h1 className="text-lg font-bold">{lang === "ar" ? "خريطة التقييم والديون" : "Valuation & debt map"}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {lang === "ar"
            ? "مضاعف الربحية يسعّر حقوق الملكية فقط ويتجاهل ديون الشركة — هذه الخريطة تضع كل شركة عند دمج حجم الرافعة، لتفريق القيمة الحقيقية عن فخاخ الديون."
            : "P/E prices only the equity and ignores the debt — this map places every company once leverage is included, telling real value apart from debt traps."}
        </p>
      </div>

      {/* sector filter + quadrant counts */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setSector("all")}
          className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
            sector === "all" ? "border-foreground/20 bg-secondary font-semibold" : "border-transparent text-muted-foreground hover:bg-accent"
          }`}
        >
          {lang === "ar" ? `جميع القطاعات` : `All sectors`} · {data.total}
        </button>
        {data.sectors.slice(0, 14).map((s) => (
          <button
            key={s.sectorAr}
            onClick={() => setSector(s.sectorAr === sector ? "all" : s.sectorAr)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              sector === s.sectorAr ? "border-foreground/20 bg-secondary font-semibold" : "border-transparent text-muted-foreground hover:bg-accent"
            }`}
          >
            {lang === "ar" ? s.sectorAr : s.sector} · {s.count}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        {(["value", "leveraged", "quality", "expensive"] as const).map((q) => (
          <span key={q} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: QUADRANT_COLORS[q] }} />
            <span className="font-medium">{lang === "ar" ? data.quadrants[q].ar : data.quadrants[q].en}</span>
            <span className="tabular-nums text-muted-foreground">· {data.counts[q]}</span>
          </span>
        ))}
      </div>

      {/* the 2D map */}
      <div className="relative overflow-hidden rounded-xl border bg-card">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-none select-none"
          style={{ height: "min(62vh, 560px)" }}
          onClick={() => setHover(null)}
        >
          {/* quadrant tints */}
          <rect x={x(axes.medianPe)} y={30} width={W - 40 - x(axes.medianPe)} height={y(axes.medianDe) - 30} fill={QUADRANT_COLORS.expensive} opacity={0.05} />
          <rect x={70} y={30} width={x(axes.medianPe) - 70} height={y(axes.medianDe) - 30} fill={QUADRANT_COLORS.leveraged} opacity={0.05} />
          <rect x={x(axes.medianPe)} y={y(axes.medianDe)} width={W - 40 - x(axes.medianPe)} height={H - 60 - y(axes.medianDe)} fill={QUADRANT_COLORS.quality} opacity={0.05} />
          <rect x={70} y={y(axes.medianDe)} width={x(axes.medianPe) - 70} height={H - 60 - y(axes.medianDe)} fill={QUADRANT_COLORS.value} opacity={0.05} />

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
          <g transform={`translate(${(W / 2) * (1 - zoom)}, ${(H / 2) * (1 - zoom)}) scale(${zoom})`}>
            {rows.map((row) => {
              const cx = x(row.pe);
              const cy = y(row.de);
              const rr = r(row.marketCap);
              const color = QUADRANT_COLORS[row.quadrant];
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

        {/* hover card */}
        {hover && (
          <div className="absolute top-2 end-2 w-56 rounded-lg border bg-card/95 p-2.5 text-xs shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <b className="font-bold">{hover.ticker}</b>
              <button onClick={() => navigate("company", { ticker: hover.ticker })} className="text-primary hover:underline">
                {lang === "ar" ? "افتح ↗" : "open ↗"}
              </button>
            </div>
            <p className="mt-0.5 truncate text-muted-foreground">{lang === "ar" ? hover.nameAr : hover.nameEn}</p>
            <div className="mt-1.5 grid grid-cols-2 gap-1 tabular-nums">
              <span className="text-muted-foreground">P/E</span>
              <span className="text-end font-semibold">{hover.pe.toFixed(1)}x</span>
              <span className="text-muted-foreground">D/E</span>
              <span className="text-end font-semibold">{hover.de.toFixed(2)}x</span>
              <span className="text-muted-foreground">{lang === "ar" ? "المعدّل بالدين" : "adjusted"}</span>
              <span className="text-end font-semibold">{hover.adjusted.toFixed(1)}x</span>
              <span className="text-muted-foreground">{lang === "ar" ? "القيمة السوقية" : "cap"}</span>
              <span className="text-end font-semibold">{fmtCap(hover.marketCap)}</span>
            </div>
          </div>
        )}

        {/* zoom controls */}
        <div className="absolute bottom-2 start-2 flex items-center gap-1 text-xs">
          <button className="rounded-md border bg-card/90 px-2 py-1 hover:bg-accent" onClick={() => setZoom((z) => Math.min(3, z * 1.3))} aria-label="zoom in">
            <ZoomIn className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button className="rounded-md border bg-card/90 px-2 py-1 hover:bg-accent" onClick={() => setZoom((z) => Math.max(1, z / 1.3))} aria-label="zoom out">
            <ZoomOut className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button className="rounded-md border bg-card/90 px-2 py-1 tabular-nums hover:bg-accent" onClick={() => setZoom(1)}>
            {zoom.toFixed(1)}× · {lang === "ar" ? "إعادة" : "reset"}
          </button>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {lang === "ar"
          ? "مساحة كل فقاعة تمثل القيمة السوقية. اضغط على أي شركة لعرض مضاعفاتها، ونقرة مزدوجة لفتح صفحتها. الخطان المنقطان وسيطا السوق كله."
          : "Bubble area = market cap. Click a company for its multiples, double-click to open its page. The dashed lines are the whole market's medians."}
      </p>

      {/* the debt-adjusted list */}
      <div className="space-y-2">
        <h2 className="text-sm font-bold">
          {lang === "ar" ? `ترتيب المضاعف المعدل بالديون · ${rows.length} شركة` : `Debt-adjusted multiple ranking · ${rows.length} companies`}
        </h2>
        <p className="text-[11px] text-muted-foreground">
          {lang === "ar"
            ? "المضاعف المعدّل = المكرر × (1 + الدين/الملكية): ما تدفعه مقابل كل جنيه أرباح بعد تسعير الرافعة في الميزانية."
            : "Adjusted multiple = P/E × (1 + D/E): what you pay per pound of earnings once balance-sheet leverage is priced in."}
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {rows.slice(0, 36).map((row) => {
            const color = QUADRANT_COLORS[row.quadrant];
            return (
              <button
                key={row.ticker}
                onClick={() => navigate("company", { ticker: row.ticker })}
                className="flex items-center gap-2 rounded-lg border bg-card p-2 text-start text-xs transition-colors hover:bg-accent"
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span className="w-12 shrink-0 font-bold">{row.ticker}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{lang === "ar" ? row.nameAr : row.nameEn}</span>
                <span className="shrink-0 tabular-nums font-semibold">{row.adjusted.toFixed(1)}x</span>
                <span className="w-24 shrink-0 text-end tabular-nums text-muted-foreground">
                  {row.pe.toFixed(1)}x · {row.de.toFixed(2)}x
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
