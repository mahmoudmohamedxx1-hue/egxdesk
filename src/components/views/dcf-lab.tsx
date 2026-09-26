"use client";

/** T65 — the FULL DCF valuation for the Model Lab. The old DCF card showed
 *  three sliders and four totals; this one shows WHERE the value comes from:
 *
 *    - the BASIS strip (TTM earnings used as the cash-flow proxy, share
 *      count, net debt) — nothing hidden;
 *    - the VALUE COMPOSITION chart: one bar per year's present value plus
 *      the terminal bar, so the reader SEES that (usually) most of a DCF
 *      is the terminal assumption, not the forecast years;
 *    - the YEAR-BY-YEAR table: cash flow, discount factor, present value
 *      for every one of the ten years, then the terminal row and totals;
 *    - a g × r SENSITIVITY grid of per-share values around the current
 *      assumptions, the current cell ringed;
 *    - a one-line comparison against the market price AND the five-model
 *      blended fair value computed above it in the same lab.
 *
 *  Honesty rules unchanged: net income stands in for free cash flow (no
 *  published FCF for EGX names in our sources — labeled, not hidden), the
 *  r ≤ g_terminal model break is guarded in words, and the whole thing is
 *  a transparent teaching model, not advice. */

import { useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { TrendingUp, Grid3x3 } from "lucide-react";
import { dcfProjection } from "../market/valuation-panel";
import { fmt1, fmt2, fmtCap, fmtPct, type ValRow } from "./valuation-shared";

const UP = "#059669";
const DOWN = "#e11d48";
const TERM = "#7c3aed"; // the terminal bar — deliberately distinct

export function DcfLab({ row, eps, blendFv }: { row: ValRow; eps: number | null; blendFv: number | null }) {
  const { lang } = useApp();
  const ar = lang === "ar";

  const [g, setG] = useState(10);
  const [r, setR] = useState(22);
  const [gt, setGt] = useState(5);

  // the basis — same derivation the old card used
  const basis = useMemo(() => {
    const shares = row.marketCap != null && row.close ? row.marketCap / row.close : null;
    const fcf0 = row.netIncomeTTM != null ? row.netIncomeTTM : eps != null && shares ? eps * shares : null;
    return { shares, fcf0, netDebt: row.netDebt ?? 0 };
  }, [row, eps]);

  const proj = useMemo(
    () => (basis.fcf0 == null || basis.shares == null ? null : dcfProjection(basis.fcf0, g, r, gt, basis.netDebt, basis.shares)),
    [basis, g, r, gt]
  );

  // sensitivity: 5×5 per-share values around the current g × r
  const sens = useMemo(() => {
    if (basis.fcf0 == null || basis.shares == null) return null;
    const gSteps = [g - 8, g - 4, g, g + 4, g + 8].map((v) => Math.max(0, Math.min(40, v)));
    const rSteps = [r - 8, r - 4, r, r + 4, r + 8].map((v) => Math.max(6, Math.min(45, v)));
    const cells = gSteps.map((gv) =>
      rSteps.map((rv) => {
        const p = dcfProjection(basis.fcf0!, gv, rv, Math.min(gt, rv - 3), basis.netDebt, basis.shares!);
        return p ? p.perShare : null;
      })
    );
    return { gSteps, rSteps, cells };
  }, [basis, g, r, gt]);

  const breaks = r <= gt + 2; // discount too close to terminal — the model degenerates
  const vsPrice = proj && row.close ? ((proj.perShare / row.close) - 1) * 100 : null;
  const valColor = (v: number) => (v >= (row.close ?? 0) ? UP : DOWN);

  const slider = (label: string, value: number, setter: (v: number) => void, min: number, max: number) => (
    <label key={label} className="block">
      <span className="flex items-center justify-between text-[11px] text-muted-foreground">
        {label}
        <b className="tabular-nums text-foreground">{value}%</b>
      </span>
      <input type="range" dir="ltr" min={min} max={max} step={0.5} value={value} onChange={(e) => setter(Number(e.target.value))} className="mt-1 w-full accent-primary" />
    </label>
  );

  // ── the value-composition bars (pure SVG — no chart lib for 11 bars) ──
  const bars = useMemo(() => {
    if (!proj) return null;
    const items = [
      ...proj.years.map((y) => ({ label: String(y.t), pv: y.pv, terminal: false })),
      { label: ar ? "نهائي" : "TV", pv: proj.pvTerminal, terminal: true },
    ];
    const max = Math.max(...items.map((i) => i.pv), 1);
    return { items, max };
  }, [proj, ar]);

  return (
    <div className="rounded-xl border bg-card p-3">
      <h2 className="flex items-center gap-1.5 text-sm font-bold">
        <TrendingUp className="h-4 w-4 text-primary" aria-hidden />
        {ar ? "مختبر DCF — التقييم بالتدفقات المخصومة (١٠ سنوات)" : "DCF lab — discounted cash-flow valuation (10 years)"}
      </h2>
      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
        {ar
          ? "ربح السهم TTM ينمو بمعدلك عشر سنوات ثم قيمة نهائية بنمو دائم، والكل يُخصم إلى اليوم ثم يُطرح صافي الدين. حرك الافتراضات وشاهد من أين تأتي القيمة فعلاً — الافتراضي ٢٢٪ خصم لأن فائدة الجنيه في مصر مرتفعة."
          : "TTM earnings grow at your rate for ten years, then a perpetuity terminal value; everything is discounted to today and net debt is subtracted. Move the assumptions and watch where the value actually comes from — the 22% default reflects Egypt's cost of money."}
      </p>

      {!basis.fcf0 || !basis.shares ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {ar ? "لا أرباح TTM منشورة لهذه الشركة — النموذج معطّل بأمانة." : "No published TTM earnings for this company — the model stays off, honestly."}
        </p>
      ) : (
        <>
          {/* basis strip */}
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
            <div className="rounded-lg bg-secondary/50 p-2">
              <span className="block text-muted-foreground">{ar ? "أساس التدفق (ربح TTM)" : "cash-flow basis (TTM earnings)"}</span>
              <b className="tabular-nums text-sm">EGP {fmtCap(basis.fcf0)}</b>
            </div>
            <div className="rounded-lg bg-secondary/50 p-2">
              <span className="block text-muted-foreground">{ar ? "عدد الأسهم" : "shares"}</span>
              <b className="tabular-nums text-sm">{fmtCap(basis.shares)}</b>
            </div>
            <div className="rounded-lg bg-secondary/50 p-2">
              <span className="block text-muted-foreground">{ar ? "صافي الدين" : "net debt"}</span>
              <b className="tabular-nums text-sm">EGP {fmtCap(basis.netDebt)}</b>
            </div>
            <div className="rounded-lg bg-secondary/50 p-2">
              <span className="block text-muted-foreground">{ar ? "القيمة/سهم" : "value/share"}</span>
              <b className="tabular-nums text-base">{proj ? fmt2(proj.perShare) : "—"}</b>
            </div>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {ar
              ? "نستخدم صافي الربح كبديل عن التدفق النقدي الحر — لا تُنشر تدفقات FCF لمصر في مصادرنا، وهذا بديل معلن لا صامت."
              : "Net income stands in for free cash flow — EGX names publish no FCF in our sources; this labeled proxy is used openly."}
          </p>

          {/* sliders */}
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
            {slider(ar ? "نمو سنوي (١٠ سنوات)" : "annual growth (10y)", g, setG, 0, 40)}
            {slider(ar ? "معدل الخصم" : "discount rate", r, setR, 5, 45)}
            {slider(ar ? "النمو النهائي الدائم" : "terminal growth", gt, setGt, 0, 20)}
          </div>

          {breaks && (
            <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
              {ar
                ? "الخصم قريب جدًا من النمو النهائي — القيمة النهائية تنفجر رياضيًا. ارفع الخصم أو اخفض النمو النهائي لتفادي رقم بلا معنى."
                : "The discount is too close to terminal growth — the perpetuity explodes mathematically. Raise the discount or lower terminal growth to keep the number meaningful."}
            </p>
          )}

          {proj && !breaks && (
            <>
              {/* headline stats */}
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                <div className="rounded-lg bg-secondary/50 p-2">
                  <span className="block text-muted-foreground">{ar ? "من السعر" : "vs price"}</span>
                  <b className="tabular-nums text-base" style={{ color: (vsPrice ?? 0) >= 0 ? UP : DOWN }}>
                    {fmtPct(vsPrice, 0)}
                  </b>
                </div>
                <div className="rounded-lg bg-secondary/50 p-2">
                  <span className="block text-muted-foreground">{ar ? "قيمة المنشأة" : "enterprise"}</span>
                  <b className="tabular-nums text-sm">EGP {fmtCap(proj.ev)}</b>
                </div>
                <div className="rounded-lg bg-secondary/50 p-2">
                  <span className="block text-muted-foreground">{ar ? "قيمة السنوات العشر" : "PV of the 10 years"}</span>
                  <b className="tabular-nums text-sm">EGP {fmtCap(proj.pvSum)}</b>
                </div>
                <div className="rounded-lg bg-secondary/50 p-2">
                  <span className="block text-muted-foreground">{ar ? "حصة القيمة النهائية" : "terminal share"}</span>
                  <b className="tabular-nums text-base" style={{ color: TERM }}>
                    {Math.round(proj.terminalShare * 100)}%
                  </b>
                </div>
              </div>

              {/* value composition bars */}
              <div className="mt-3">
                <p className="text-[11px] font-semibold">{ar ? "من أين تأتي القيمة" : "Where the value comes from"}</p>
                <p className="text-[10px] text-muted-foreground">
                  {ar ? "القيمة الحالية لكل سنة + العمود البنفسجي للقيمة النهائية المخصومة." : "Each bar = a year's present value; the violet bar is the discounted terminal value."}
                </p>
                {bars && (
                  <div className="mt-1.5 overflow-x-auto">
                    <svg viewBox="0 0 560 130" className="w-full min-w-[420px]" role="img" aria-label={ar ? "توزيع القيمة الحالية" : "present value composition"}>
                      {bars.items.map((it, i) => {
                        const bw = 34;
                        const gap = 16;
                        const x0 = 30 + i * (bw + gap);
                        const h = Math.max(2, (it.pv / bars.max) * 92);
                        const pctv = proj.ev > 0 ? (it.pv / proj.ev) * 100 : 0;
                        return (
                          <g key={i}>
                            <rect x={x0} y={104 - h} width={bw} height={h} rx={3} fill={it.terminal ? TERM : UP} opacity={it.terminal ? 0.85 : 0.55} />
                            <text x={x0 + bw / 2} y={100 - h < 92 ? 100 - h : 88} textAnchor="middle" fontSize="8.5" fill="currentColor" opacity={0.75} className="tabular-nums">
                              {pctv >= 1 ? `${Math.round(pctv)}%` : ""}
                            </text>
                            <text x={x0 + bw / 2} y={118} textAnchor="middle" fontSize="9" fill="currentColor" opacity={it.terminal ? 0.95 : 0.55} fontWeight={it.terminal ? 700 : 400}>
                              {it.label}
                            </text>
                          </g>
                        );
                      })}
                      <line x1={22} y1={104.5} x2={548} y2={104.5} stroke="currentColor" opacity={0.25} />
                    </svg>
                  </div>
                )}
                <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  {ar
                    ? `${Math.round(proj.terminalShare * 100)}٪ من قيمة المنشأة تأتي من افتراض ما بعد السنة العاشرة — هذه هي حساسية DCF الحقيقية: النمو النهائي يحرك النتيجة أكثر من أي سنة متوقعة.`
                    : `${Math.round(proj.terminalShare * 100)}% of the enterprise value sits beyond year ten — that is the real fragility of a DCF: the terminal assumption moves the answer more than any forecast year.`}
                </p>
              </div>

              {/* year-by-year table */}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-[10px] text-muted-foreground">
                      <th className="py-1.5 text-start font-medium">{ar ? "السنة" : "year"}</th>
                      <th className="py-1.5 px-2 text-end font-medium">{ar ? "التدفق المتوقع" : "forecast cash flow"}</th>
                      <th className="py-1.5 px-2 text-end font-medium">{ar ? "معامل الخصم" : "discount factor"}</th>
                      <th className="py-1.5 px-2 text-end font-medium">{ar ? "القيمة الحالية" : "present value"}</th>
                      <th className="py-1.5 ps-2 text-end font-medium">{ar ? "نسبة من المنشأة" : "% of EV"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proj.years.map((y) => (
                      <tr key={y.t} className="border-b last:border-0">
                        <td className="py-1 pe-2 font-semibold tabular-nums">{y.t}</td>
                        <td className="py-1.5 px-2 text-end tabular-nums">EGP {fmtCap(y.fcf)}</td>
                        <td className="py-1.5 px-2 text-end tabular-nums text-muted-foreground">×{y.df.toFixed(3)}</td>
                        <td className="py-1.5 px-2 text-end font-semibold tabular-nums">EGP {fmtCap(y.pv)}</td>
                        <td className="py-1.5 ps-2 text-end tabular-nums text-muted-foreground">{((y.pv / proj.ev) * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                    <tr className="border-b border-dashed" style={{ color: TERM }}>
                      <td className="py-1.5 pe-2 font-bold">{ar ? "نهائي" : "TV"}</td>
                      <td className="py-1.5 px-2 text-end tabular-nums">EGP {fmtCap(proj.terminalFcf)} → ∞</td>
                      <td className="py-1.5 px-2 text-end tabular-nums">×{(1 / Math.pow(1 + r / 100, 10)).toFixed(3)}</td>
                      <td className="py-1.5 px-2 text-end font-bold tabular-nums">EGP {fmtCap(proj.pvTerminal)}</td>
                      <td className="py-1.5 ps-2 text-end font-bold tabular-nums">{(proj.terminalShare * 100).toFixed(1)}%</td>
                    </tr>
                    <tr className="border-t-2 font-bold">
                      <td className="py-1.5 pe-2">{ar ? "الإجمالي" : "total"}</td>
                      <td className="py-1.5 px-2 text-end tabular-nums text-muted-foreground">=</td>
                      <td className="py-1.5 px-2 text-end tabular-nums text-muted-foreground">=</td>
                      <td className="py-1.5 px-2 text-end tabular-nums">EGP {fmtCap(proj.ev)}</td>
                      <td className="py-1.5 ps-2 text-end tabular-nums">100%</td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {ar
                    ? `قيمة المنشأة − صافي الدين EGP ${fmtCap(proj.ev - proj.equity)} = حقوق الملكية EGP ${fmtCap(proj.equity)} ÷ ${fmtCap(basis.shares)} سهم = ${fmt2(proj.perShare)} جنيه/سهم.`
                    : `EV − net debt EGP ${fmtCap(proj.ev - proj.equity)} = equity EGP ${fmtCap(proj.equity)} ÷ ${fmtCap(basis.shares)} shares = ${fmt2(proj.perShare)} EGP/share.`}
                </p>
              </div>

              {/* sensitivity grid */}
              {sens && (
                <div className="mt-3">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-bold">
                    <Grid3x3 className="h-3.5 w-3.5 text-primary" aria-hidden />
                    {ar ? "حساسية DCF: النمو × الخصم" : "DCF sensitivity: growth × discount"}
                  </h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {ar ? "قيمة السهم عند كل زوج (نمو، خصم) — الخلية الحالية مؤطرة، والأخضر فوق السعر الحالي." : "Per-share value at each (growth, discount) pair — the current cell is ringed; green = above the market price."}
                  </p>
                  <div className="mt-2 overflow-x-auto">
                    <table className="text-[11px] tabular-nums">
                      <thead>
                        <tr>
                          <th className="p-1 text-[10px] text-muted-foreground">g \ r</th>
                          {sens.rSteps.map((rv, j) => (
                            <th key={`r${j}`} className="p-1 text-center text-[10px] font-medium text-muted-foreground">
                              {fmt1(rv)}%
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sens.gSteps.map((gv, i) => (
                          <tr key={`g${i}`} className="border-b last:border-0">
                            <td className="p-1 text-[10px] font-medium text-muted-foreground">{fmt1(gv)}%</td>
                            {sens.rSteps.map((rv, j) => {
                              const cell = sens.cells[i][j];
                              const isCurrent = Math.abs(gv - g) < 0.05 && Math.abs(rv - r) < 0.05;
                              const above = cell != null && row.close != null && cell >= row.close;
                              return (
                                <td key={`c${j}`} className="p-0.5">
                                  <span
                                    className={`block rounded px-1.5 py-1 text-center font-semibold ${isCurrent ? "ring-2 ring-foreground/50" : ""}`}
                                    style={{
                                      backgroundColor: cell == null ? "var(--secondary)" : above ? `${UP}22` : `${DOWN}22`,
                                      color: cell == null ? "var(--muted-foreground)" : above ? UP : DOWN,
                                    }}
                                  >
                                    {cell == null ? "—" : fmt1(cell)}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* one-line comparison against the blend above */}
              <p className="mt-2 rounded-lg bg-secondary/40 px-2.5 py-1.5 text-[11px] tabular-nums">
                {ar ? "DCF" : "DCF"} <b style={{ color: valColor(proj.perShare) }}>{fmt2(proj.perShare)}</b>
                {" · "}
                {ar ? "السعر" : "price"} <b>{fmt2(row.close)}</b>
                {blendFv != null && (
                  <>
                    {" · "}
                    {ar ? "مزيج النماذج الخمسة" : "5-model blend"} <b>{fmt2(blendFv)}</b>
                  </>
                )}
                {" · "}
                {ar ? "الفرق عن السعر" : "gap to price"}{" "}
                <b style={{ color: (vsPrice ?? 0) >= 0 ? UP : DOWN }}>{fmtPct(vsPrice, 0)}</b>
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
