"use client";

/** T60 — المزيد → فروق الأسعار والتسوية (pairs & relative value): the named
 *  sector pairs, compared on a base-100 price-return chart, with the
 *  relative-ratio σ reading and the full comparison card — cloned from the
 *  source model's screen, on our own Yahoo price history and live universe.
 *
 *  Honesty: the σ band is a statistic of the chosen window, printed with the
 *  standing caveat that pairs converge when they want to — the screen never
 *  says "trade the divergence". */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Scale } from "lucide-react";

type Point = { date: string; a: number; b: number; ratio: number };
type Card = {
  ticker: string;
  nameAr: string;
  nameEn: string;
  close: number | null;
  marketCap: number | null;
  netIncomeTTM: number | null;
  pe: number | null;
  pb: number | null;
  de: number | null;
  roe: number | null;
  divYield: number | null;
};
type Data = {
  asOf: string;
  pair: { id: string; a: string; b: string; labelAr: string; labelEn: string };
  range: string;
  pairs: { id: string; labelAr: string; labelEn: string; a: string; b: string }[];
  chart: { points: Point[]; mean: number; sd: number; last: number; sigma: number };
  cardA: Card;
  cardB: Card;
  note: { ar: string; en: string };
};

const RANGES = ["6M", "1Y", "2Y", "3Y", "5Y"] as const;
const W = 920;
const H = 340;

const fmtNum = (v: number | null, suffix = ""): string =>
  v == null ? "—" : `${v >= 1000 ? (v / 1000).toFixed(1) + "K" : v >= 100 ? v.toFixed(0) : v.toFixed(2)}${suffix}`;
const fmtCap = (v: number | null): string => {
  if (v == null) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T EGP`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B EGP`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M EGP`;
  return `${v} EGP`;
};

export function PairsView() {
  const { lang, navigate } = useApp();
  const [pairId, setPairId] = useState("ABUK_MFPC");
  const [range, setRange] = useState<(typeof RANGES)[number]>("1Y");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);

  // reset when the pair or range changes — during render (the codebase's
  // convention) so the skeleton shows without an extra paint
  const reqKey = `${pairId}:${range}`;
  const [lastKey, setLastKey] = useState(reqKey);
  if (lastKey !== reqKey) {
    setLastKey(reqKey);
    setData(null);
  }

  useEffect(() => {
    fetch(`/api/pairs?pair=${pairId}&range=${range}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("x"))))
      .then((d: Data) => setData(d))
      .catch(() => setError(true));
  }, [pairId, range]);

  const path = useMemo(() => {
    if (!data?.chart.points.length) return null;
    const pts = data.chart.points;
    const min = Math.min(...pts.flatMap((p) => [p.a, p.b])) * 0.96;
    const max = Math.max(...pts.flatMap((p) => [p.a, p.b])) * 1.04;
    const x = (i: number) => 60 + (i / Math.max(1, pts.length - 1)) * (W - 90);
    const y = (v: number) => H - 40 - ((v - min) / (max - min)) * (H - 70);
    const line = (key: "a" | "b") => pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
    return { x, y, min, max, lineA: line("a"), lineB: line("b"), pts };
  }, [data]);

  if (error) {
    return (
      <div className="space-y-3 p-4">
        <h1 className="text-lg font-bold">{lang === "ar" ? "فروق الأسعار والتسوية" : "Pairs & relative value"}</h1>
        <p className="text-sm text-muted-foreground">{lang === "ar" ? "تعذّر التحميل." : "Unavailable."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-primary" aria-hidden />
          <h1 className="text-lg font-bold">{lang === "ar" ? "مقارنة الأزواج والفروق السعرية" : "Pairs & relative value"}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {lang === "ar"
            ? "مقارنة دقيقة بين الأسهم المتنافسة في نفس القطاع — عاير المسار بحسب عائد السعر لرصد الاختلالات النسبية."
            : "Precise comparison of competing stocks in the same sector — calibrate the path on price return to spot relative divergences."}
        </p>
      </div>

      {/* pair picker */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(data?.pairs ?? []).map((p) => (
          <button
            key={p.id}
            onClick={() => setPairId(p.id)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              pairId === p.id ? "border-foreground/20 bg-secondary font-semibold" : "border-transparent text-muted-foreground hover:bg-accent"
            }`}
          >
            {lang === "ar" ? p.labelAr : p.labelEn} ({p.a} / {p.b})
          </button>
        ))}
      </div>

      {/* range + σ reading */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                range === r ? "border-foreground/20 bg-secondary font-semibold" : "border-transparent text-muted-foreground hover:bg-accent"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        {data && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              {lang === "ar" ? "نسبة المسارين (أ ÷ ب)" : "path ratio (A ÷ B)"}
            </span>
            <span className="font-bold tabular-nums">{data.chart.last.toFixed(2)}</span>
            <span
              className={`rounded-full px-2 py-0.5 font-semibold tabular-nums ${
                Math.abs(data.chart.sigma) >= 2
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              {data.chart.sigma >= 0 ? "+" : ""}
              {data.chart.sigma.toFixed(2)}σ
            </span>
          </div>
        )}
      </div>

      {/* chart */}
      {!data ? (
        <Skeleton className="h-[46vh] w-full rounded-xl" />
      ) : path ? (
        <div className="overflow-hidden rounded-xl border bg-card p-2">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "min(46vh, 380px)" }}>
            {/* gridlines */}
            {[0, 0.25, 0.5, 0.75, 1].map((f) => {
              const v = path.min + f * (path.max - path.min);
              const yy = path.y(v);
              return (
                <g key={f}>
                  <line x1={60} y1={yy} x2={W - 30} y2={yy} stroke="currentColor" opacity={0.08} />
                  <text x={54} y={yy + 3} fontSize="9" textAnchor="end" fill="currentColor" opacity={0.5}>
                    {v.toFixed(0)}
                  </text>
                </g>
              );
            })}
            {/* base-100 line */}
            <line x1={60} y1={path.y(100)} x2={W - 30} y2={path.y(100)} stroke="currentColor" strokeDasharray="3 4" opacity={0.3} />
            <text x={W - 32} y={path.y(100) - 5} fontSize="9" textAnchor="end" fill="currentColor" opacity={0.5}>
              100
            </text>
            {/* the two legs */}
            <path d={path.lineA} fill="none" stroke="#10b981" strokeWidth={2} />
            <path d={path.lineB} fill="none" stroke="#3b82f6" strokeWidth={2} />
            {/* date axis */}
            {[0, 0.25, 0.5, 0.75, 1].map((f) => {
              const i = Math.round(f * (path.pts.length - 1));
              return (
                <text key={`d${f}`} x={path.x(i)} y={H - 18} fontSize="9" textAnchor="middle" fill="currentColor" opacity={0.5}>
                  {path.pts[i]?.date.slice(0, 7)}
                </text>
              );
            })}
            {/* labels */}
            <text x={66} y={26} fontSize="11" fill="#10b981" className="font-bold">
              {data.pair.a} · {lang === "ar" ? data.cardA.nameAr : data.cardA.nameEn}
            </text>
            <text x={66} y={42} fontSize="11" fill="#3b82f6" className="font-bold">
              {data.pair.b} · {lang === "ar" ? data.cardB.nameAr : data.cardB.nameEn}
            </text>
          </svg>
        </div>
      ) : null}

      {data && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {lang === "ar" ? data.note.ar : data.note.en}
        </p>
      )}

      {/* comparison card */}
      {data && (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="border-b bg-secondary/50 px-3 py-2 text-sm font-bold">
            {lang === "ar" ? "بطاقة المقارنة المالية" : "Financial comparison card"}
          </div>
          <div className="grid grid-cols-3 text-xs">
            <div className="border-b border-s-0 p-2.5 font-semibold text-muted-foreground"> </div>
            <div className="border-b p-2.5 text-center font-bold">
              <button onClick={() => navigate("company", { ticker: data.cardA.ticker })} className="hover:text-primary">
                {data.cardA.ticker}
              </button>
            </div>
            <div className="border-b p-2.5 text-center font-bold">
              <button onClick={() => navigate("company", { ticker: data.cardB.ticker })} className="hover:text-primary">
                {data.cardB.ticker}
              </button>
            </div>
            {(
              [
                ["سعر الإغلاق الأخير", "Last close", (c: Card) => fmtNum(c.close, " EGP")],
                ["القيمة السوقية", "Market cap", (c: Card) => fmtCap(c.marketCap)],
                ["صافي الربح السنوي", "Net income (TTM)", (c: Card) => fmtCap(c.netIncomeTTM)],
                ["مكرر الربحية (P/E)", "P/E", (c: Card) => (c.pe == null ? "—" : `${c.pe.toFixed(1)}x`)],
                ["مضاعف القيمة الدفترية (P/B)", "P/B", (c: Card) => (c.pb == null ? "—" : `${c.pb.toFixed(2)}x`)],
                ["الدين / حقوق الملكية", "Debt / equity", (c: Card) => (c.de == null ? "—" : `${c.de.toFixed(2)}x`)],
                ["العائد على حقوق الملكية (ROE)", "ROE", (c: Card) => (c.roe == null ? "—" : `${c.roe.toFixed(1)}%`)],
                ["عائد التوزيعات النقدية", "Dividend yield", (c: Card) => (c.divYield == null ? "—" : `${c.divYield.toFixed(1)}%`)],
              ] as [string, string, (c: Card) => string][]
            ).map(([labelAr, labelEn, fn]) => (
              <div key={labelEn} className="contents">
                <div className="border-b p-2.5 text-muted-foreground">{lang === "ar" ? labelAr : labelEn}</div>
                <div className="border-b p-2.5 text-center tabular-nums">{fn(data.cardA)}</div>
                <div className="border-b p-2.5 text-center tabular-nums">{fn(data.cardB)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
