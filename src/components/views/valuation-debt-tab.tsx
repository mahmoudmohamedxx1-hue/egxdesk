"use client";

/** T64 — the DEBT MAP tab: leverage on two axes instead of one —
 *  x = debt/equity (the classic burden on the book), y = net debt as a
 *  share of market value (the burden priced against what you pay), bubble
 *  = market cap, color = the five-zone reading (net cash · safe · moderate
 *  · elevated · high). Below it, the leverage ranking with net debt in EGP
 *  and the debt-adjusted multiple — the honest companion number that prices
 *  leverage into what you pay for earnings. */

import { useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { DEBT_ZONE_META, type DebtZone } from "@/lib/fair-value";
import { fmt1, fmt2, fmtCap, type ValRow } from "./valuation-shared";

const W = 960;
const H = 520;

const Y_MIN = -0.4; // deep net-cash floor
const Y_MAX = 1.6; // net debt 160% of market value

export function ValuationDebtTab({ rows }: { rows: ValRow[] }) {
  const { lang, navigate } = useApp();
  const [hover, setHover] = useState<ValRow | null>(null);
  const [sort, setSort] = useState<"deDesc" | "deAsc" | "adjusted">("deDesc");

  const debtRows = useMemo(() => rows.filter((r) => r.de != null), [rows]);
  const mapRows = useMemo(
    () => debtRows.filter((r) => r.netDebtToCap != null && Number.isFinite(r.netDebtToCap)),
    [debtRows]
  );

  // x caps at the 96th percentile so one outlier doesn't flatten the map
  const deSort = [...mapRows].map((r) => r.de as number).sort((a, b) => a - b);
  const xMax = Math.max(1.5, Math.ceil(((deSort[Math.floor(deSort.length * 0.96)] ?? 2) as number) * 10) / 10);
  const medDe = useMemo(() => {
    const xs = debtRows.map((r) => r.de as number).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : null;
  }, [debtRows]);
  const medNdc = useMemo(() => {
    const xs = mapRows.map((r) => r.netDebtToCap as number).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : null;
  }, [mapRows]);

  const x = (de: number) => 70 + (Math.min(de, xMax) / xMax) * (W - 110);
  const y = (ndc: number) => {
    const clamped = Math.min(Y_MAX, Math.max(Y_MIN, ndc));
    return H - 60 - ((clamped - Y_MIN) / (Y_MAX - Y_MIN)) * (H - 100);
  };
  const maxCap = Math.max(...mapRows.map((r) => r.marketCap ?? 0), 1);
  const r = (cap: number | null) => 5 + Math.sqrt((cap ?? 1e8) / maxCap) * 26;

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
      <div className="relative overflow-hidden rounded-xl border bg-card">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none" style={{ height: "min(56vh, 520px)" }} onClick={() => setHover(null)}>
          {/* net-cash band (bottom) tint */}
          <rect x={70} y={y(0)} width={W - 110} height={H - 60 - y(0)} fill={DEBT_ZONE_META.netCash.color} opacity={0.06} />

          {/* median guides */}
          {medDe != null && (
            <>
              <line x1={x(medDe)} y1={30} x2={x(medDe)} y2={H - 60} stroke="currentColor" strokeDasharray="4 4" opacity={0.35} />
              <text x={x(medDe) + 6} y={44} fontSize="10" fill="currentColor" opacity={0.6}>
                {lang === "ar" ? `وسيط D/E: ${medDe.toFixed(2)}x` : `median D/E: ${medDe.toFixed(2)}x`}
              </text>
            </>
          )}
          {medNdc != null && (
            <>
              <line x1={70} y1={y(medNdc)} x2={W - 40} y2={y(medNdc)} stroke="currentColor" strokeDasharray="4 4" opacity={0.35} />
              <text x={W - 44} y={y(medNdc) - 6} fontSize="10" textAnchor="end" fill="currentColor" opacity={0.6}>
                {lang === "ar" ? `وسيط الدين/سوق ${(medNdc * 100).toFixed(0)}%` : `median net debt/market ${(medNdc * 100).toFixed(0)}%`}
              </text>
            </>
          )}

          {/* axes + labels */}
          <line x1={70} y1={H - 60} x2={W - 40} y2={H - 60} stroke="currentColor" opacity={0.3} />
          <line x1={70} y1={30} x2={70} y2={H - 60} stroke="currentColor" opacity={0.3} />
          <text x={W - 40} y={H - 40} textAnchor="end" fontSize="11" fill="currentColor" opacity={0.7}>
            {lang === "ar" ? "الدين ÷ حقوق الملكية (D/E) ← رافعة أعلى" : "D/E → more leverage"}
          </text>
          <text x={76} y={40} fontSize="11" fill="currentColor" opacity={0.7}>
            {lang === "ar" ? "صافي الدين ÷ القيمة السوقية ↑" : "net debt / market cap ↑"}
          </text>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <text key={`x${f}`} x={70 + f * (W - 110)} y={H - 46} fontSize="9" textAnchor="middle" fill="currentColor" opacity={0.45}>
              {(xMax * f).toFixed(1)}x
            </text>
          ))}
          {[-0.4, 0, 0.4, 0.8, 1.2, 1.6].map((v) => (
            <text key={`y${v}`} x={64} y={y(v) + 3} fontSize="9" textAnchor="end" fill="currentColor" opacity={0.45}>
              {v > 0 ? `+${(v * 100).toFixed(0)}%` : `${(v * 100).toFixed(0)}%`}
            </text>
          ))}
          <text x={74} y={y(0) - 4} fontSize="9" fill={DEBT_ZONE_META.netCash.color} opacity={0.9}>
            {lang === "ar" ? "أسفل الخط: نقد يفوق الدين" : "below the line: cash exceeds debt"}
          </text>

          {/* the bubbles */}
          {mapRows.map((row) => {
            const cx = x(row.de ?? 0);
            const cy = y(row.netDebtToCap ?? 0);
            const rr = r(row.marketCap);
            const color = DEBT_ZONE_META[row.debtZone ?? "safe"].color;
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
                  <text x={cx} y={cy + 3} fontSize={Math.min(10, rr / 2.6)} textAnchor="middle" fill="currentColor" opacity={0.85} className="pointer-events-none font-semibold">
                    {row.ticker}
                  </text>
                )}
              </g>
            );
          })}
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
            {hover.fv != null && (
              <p className="mt-1.5 border-t pt-1.5 text-[10px] tabular-nums text-muted-foreground">
                {lang === "ar" ? "القيمة العادلة" : "fair value"} {fmt2(hover.fv)} · {lang === "ar" ? "الفرق" : "upside"}{" "}
                <b style={{ color: hover.upside != null && hover.upside >= 0 ? "#10b981" : "#ef4444" }}>
                  {hover.upside != null ? `${hover.upside >= 0 ? "+" : ""}${hover.upside.toFixed(0)}%` : "—"}
                </b>
              </p>
            )}
          </div>
        )}
      </div>

      {/* zone legend with counts */}
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        {(Object.keys(DEBT_ZONE_META) as DebtZone[]).map((z) => (
          <span key={z} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: DEBT_ZONE_META[z].color }} />
            <span className="font-medium">{lang === "ar" ? DEBT_ZONE_META[z].ar : DEBT_ZONE_META[z].en}</span>
            <span className="tabular-nums text-muted-foreground">
              · {zoneCounts.get(z) ?? 0} {lang === "ar" ? (DEBT_ZONE_META[z].hintAr) : (DEBT_ZONE_META[z].hintEn)}
            </span>
          </span>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {lang === "ar"
          ? `النقاط تحت الخط الصفري شركات نقدُها يفوق ديونها. ${mapRows.length} من ${debtRows.length} شركة لها D/E منشور ظهرت على الخريطة (تحتاج صافي دين منشورًا للمحور الثاني) — البقية في الجدول أدناه.`
          : `Points below the zero line hold more cash than debt. ${mapRows.length} of ${debtRows.length} companies with a published D/E made it onto the map (the second axis needs a published net debt) — the rest stay in the table below.`}
      </p>

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
