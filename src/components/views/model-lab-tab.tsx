"use client";

/** T64 — the VALUATION WORKBENCH (model lab, tab 1): pick any listed stock
 *  and the five fair-value models run on IT — prefilled from its own live
 *  fundamentals (EPS, book value, dividend, payout, ROE, beta, growth and
 *  its sector's medians), recomputed LIVE as you move the assumptions:
 *
 *    - rf / ERP / beta / g / margin of safety are all editable, with the
 *      computed CAPM discount rate printed beside them;
 *    - every model shows its formula with the actual numbers substituted;
 *    - the blend prints the weights actually used (renormalized over the
 *      models whose inputs exist) and the coverage dots;
 *    - the sensitivity grid re-runs the blend across g × r so you can SEE
 *      where the value comes from and where it breaks;
 *    - a two-stage DCF card (the same math as the company page) runs beside
 *      the blend for the earnings-power view.
 *
 *  Honesty rules: a model whose inputs are missing drops out in words, not
 *  in silence; the whole workbench is a transparent model, not advice. */

import { useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { Search, RotateCcw, FlaskConical, Calculator, Grid3x3, ExternalLink, TrendingUp } from "lucide-react";
import {
  computeFv,
  fvSensitivity,
  fvAutoG,
  fvDiscountRate,
  FV_VERDICT_META,
  upsideColor,
  type FvInputs,
} from "@/lib/fair-value";
import { dcfPerShare } from "../market/valuation-panel";
import { fmt1, fmt2, fmtCap, fmtPct, type ValData, type ValRow } from "./valuation-shared";

const MODEL_LABELS: Record<string, { ar: string; en: string }> = {
  multPe: { ar: "مكرر القطاع × الربح", en: "Peer P/E" },
  multPb: { ar: "مضاعف القطاع × الدفترية", en: "Peer P/B" },
  graham: { ar: "رقم جراهام", en: "Graham number" },
  ddm: { ar: "جوردون للتوزيعات", en: "Gordon DDM" },
  justifiedPb: { ar: "المضاعف المبرر (ROE)", en: "Justified P/B" },
};

export function ModelLabTab({ data, ticker, onPick }: { data: ValData; ticker: string; onPick: (t: string) => void }) {
  const { lang, navigate } = useApp();
  const [q, setQ] = useState("");
  // the stock comes from the parent; per-stock state below resets cleanly
  // because the parent remounts this component with a `key` per ticker.
  const row: ValRow | null = useMemo(() => data.rows.find((r) => r.ticker === ticker) ?? null, [data.rows, ticker]);

  const [rf, setRf] = useState<number>(() => data.assumptions.rf);
  const [erp, setErp] = useState<number>(() => data.assumptions.erp);
  const [beta, setBeta] = useState<number>(() => (row?.beta != null && row.beta > 0 ? row.beta : 1));
  const [gMode, setGMode] = useState<"auto" | "manual">("auto");
  const [gManual, setGManual] = useState<number>(8);
  const [mos, setMos] = useState<number>(() => data.assumptions.mos);
  const [dcfG, setDcfG] = useState<number>(10);
  const [dcfR, setDcfR] = useState<number>(22);
  const [dcfT, setDcfT] = useState<number>(5);

  const eps = useMemo(() => {
    if (row == null) return null;
    if (row.eps != null && Number.isFinite(row.eps) && row.eps !== 0) return row.eps;
    if (row.pe != null && row.pe > 0 && row.close) return row.close / row.pe;
    const shares = row.marketCap != null && row.close ? row.marketCap / row.close : null;
    if (row.netIncomeTTM != null && shares && shares > 0) return row.netIncomeTTM / shares;
    return null;
  }, [row]);

  const inputs: FvInputs = useMemo(
    () => ({
      price: row?.close ?? null,
      eps: eps != null && eps > 0 ? eps : null,
      bvps: row?.bvps ?? null,
      dps: row?.dps ?? null,
      payout: row?.payout ?? null,
      roe: row?.roe ?? null,
      beta,
      gRevQ: row?.gRevQ ?? null,
      sectorPe: row?.sectorPe ?? null,
      sectorPb: row?.sectorPb ?? null,
      pe: row?.pe ?? null,
      pb: row?.pb ?? null,
    }),
    [row, eps, beta]
  );

  const assumptions = useMemo(
    () => ({
      rf,
      erp,
      beta: 1,
      g: gMode === "manual" ? gManual : null,
      gCap: data.assumptions.gCap,
      spreadMin: data.assumptions.spreadMin,
      mos,
      rOverride: null,
    }),
    [rf, erp, gMode, gManual, mos, data.assumptions.gCap, data.assumptions.spreadMin]
  );

  const fv = useMemo(() => computeFv(inputs, assumptions), [inputs, assumptions]);
  const sens = useMemo(() => fvSensitivity(inputs, assumptions), [inputs, assumptions]);
  const autoG = useMemo(() => fvAutoG(inputs, assumptions), [inputs, assumptions]);
  const rUsed = useMemo(() => fvDiscountRate(assumptions, beta), [assumptions, beta]);

  // DCF card (same math as the company page)
  const dcf = useMemo(() => {
    if (!row) return null;
    const shares = row.marketCap != null && row.close ? row.marketCap / row.close : null;
    const fcf0 = row.netIncomeTTM != null ? row.netIncomeTTM : eps != null && shares ? eps * shares : null;
    if (fcf0 == null || shares == null || shares <= 0) return null;
    return dcfPerShare(fcf0, dcfG, dcfR, dcfT, row.netDebt ?? 0, shares);
  }, [row, eps, dcfG, dcfR, dcfT]);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return data.rows
      .filter(
        (c) =>
          c.ticker.toLowerCase().includes(needle) ||
          c.nameAr.includes(q.trim()) ||
          c.nameEn.toLowerCase().includes(needle) ||
          c.sectorAr.includes(q.trim())
      )
      .slice(0, 8);
  }, [q, data.rows]);

  const resetDefaults = () => {
    setRf(data.assumptions.rf);
    setErp(data.assumptions.erp);
    setBeta(row?.beta != null && row.beta > 0 ? row.beta : 1);
    setGMode("auto");
    setMos(data.assumptions.mos);
  };

  const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const verdict = fv.verdict != null ? FV_VERDICT_META[fv.verdict] : null;
  const priceFill = fv.blend != null && row?.close ? Math.min(100, (row.close / fv.blend) * 100) : 0;
  const coverageDots = Math.round(fv.coverage * 5);

  const field = (label: string, value: string, unit = "") => (
    <div className="rounded-lg border bg-card p-2">
      <p className="text-[10px] leading-tight text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-bold tabular-nums">
        {value}
        <span className="ms-0.5 text-[10px] font-normal text-muted-foreground">{unit}</span>
      </p>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* stock picker */}
      <div className="relative max-w-md">
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={lang === "ar" ? "اختر سهمًا لتشغيل النماذج عليه… (الاسم أو الرمز)" : "pick a stock to run the models on… (name or ticker)"}
            className="h-9 w-full rounded-lg border bg-background ps-8 pe-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            aria-label={lang === "ar" ? "اختر سهمًا" : "pick a stock"}
          />
        </div>
        {q && (
          <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-popover shadow-lg">
            {matches.map((m) => (
              <button
                key={m.ticker}
                onClick={() => {
                  onPick(m.ticker);
                  try {
                    window.localStorage.setItem("ml-ticker", m.ticker);
                  } catch {
                    /* private mode — skip */
                  }
                  setQ("");
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-start text-xs hover:bg-accent"
              >
                <b className="w-12 shrink-0">{m.ticker}</b>
                <span className="min-w-0 flex-1 truncate">{lang === "ar" ? m.nameAr : m.nameEn}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{fmt2(m.close)}</span>
              </button>
            ))}
            {!matches.length && <p className="px-2.5 py-2 text-xs text-muted-foreground">{lang === "ar" ? "لا نتائج" : "no matches"}</p>}
          </div>
        )}
      </div>

      {!row ? (
        <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          {lang === "ar" ? "اختر سهمًا من القائمة أعلاه." : "Pick a stock from the list above."}
        </div>
      ) : (
        <>
          {/* the picked stock — live fundamentals */}
          <div className="rounded-xl border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <b className="text-base font-bold">{row.ticker}</b>
                  <button onClick={() => navigate("company", { ticker: row.ticker })} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                    {lang === "ar" ? "صفحة الشركة" : "company page"} <ExternalLink className="h-3 w-3" aria-hidden />
                  </button>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {lang === "ar" ? row.nameAr : row.nameEn} · {lang === "ar" ? row.sectorAr : row.sector}
                </p>
              </div>
              <span className="tabular-nums text-sm">
                {lang === "ar" ? "السعر" : "price"} <b>{fmt2(row.close)}</b> EGP · {fmtCap(row.marketCap)}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-8">
              {field("P/E", row.pe != null ? `${fmt1(row.pe)}x` : "—")}
              {field("P/B", row.pb != null ? `${fmt1(row.pb)}x` : "—")}
              {field("EPS", fmt2(eps))}
              {field(lang === "ar" ? "دفترية/سهم" : "BVPS", fmt2(row.bvps))}
              {field(lang === "ar" ? "توزيع/سهم" : "DPS", fmt2(row.dps))}
              {field("ROE", fmt1(row.roe), "%")}
              {field("D/E", row.de != null ? `${fmt1(row.de)}x` : "—")}
              {field("β", fmt2(row.beta))}
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              {lang === "ar"
                ? `وسيط القطاع: مكرر ${fmt1(row.sectorPe)}x · مضاعف دفترية ${fmt1(row.sectorPb)}x · ROE ${fmt1(row.sectorRoe)}% — من نفس لقطة السوق الحية.`
                : `Sector medians: P/E ${fmt1(row.sectorPe)}x · P/B ${fmt1(row.sectorPb)}x · ROE ${fmt1(row.sectorRoe)}% — from the same live market snapshot.`}
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-[20rem_1fr] items-start">
            {/* assumptions panel */}
            <div className="space-y-3 rounded-xl border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-1.5 text-sm font-bold">
                  <FlaskConical className="h-4 w-4 text-primary" aria-hidden />
                  {lang === "ar" ? "الافتراضات (حرّكها)" : "Assumptions (move them)"}
                </h2>
                <button onClick={resetDefaults} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                  <RotateCcw className="h-3 w-3" aria-hidden />
                  {lang === "ar" ? "إعادة" : "reset"}
                </button>
              </div>

              {(
                [
                  [lang === "ar" ? "سعر الفائدة الخالي (rf)" : "Risk-free (rf)", rf, setRf, "%", 0, 40],
                  [lang === "ar" ? "علاوة مخاطر الأسهم (ERP)" : "Equity risk premium (ERP)", erp, setErp, "%", 0, 20],
                  [lang === "ar" ? "بيتا (β)" : "Beta (β)", beta, setBeta, "", 0.1, 3, 0.05],
                ] as [string, number, (v: number) => void, string, number, number, number?][]
              ).map(([label, value, setter, unit, min, max, step]) => (
                <label key={label} className="block">
                  <span className="flex items-center justify-between text-[11px] text-muted-foreground">
                    {label}
                    <b className="tabular-nums text-foreground">
                      {value}
                      {unit}
                    </b>
                  </span>
                  <input
                    type="range"
                    dir="ltr"
                    min={min}
                    max={max}
                    step={step ?? 0.5}
                    value={value}
                    onChange={(e) => setter(Number(e.target.value))}
                    className="mt-1 w-full accent-primary"
                  />
                </label>
              ))}

              <div className="rounded-lg bg-secondary/50 p-2 text-[11px] tabular-nums">
                <span className="text-muted-foreground">{lang === "ar" ? "معدل الخصم المحسوب (r = rf + β×ERP)" : "Computed discount rate (r = rf + β×ERP)"}</span>
                <b className="mt-0.5 block text-base">{fmt1(rUsed)}%</b>
              </div>

              <div>
                <span className="flex items-center justify-between text-[11px] text-muted-foreground">
                  {lang === "ar" ? "النمو (g)" : "Growth (g)"}
                  {gMode === "auto" ? (
                    <b className="tabular-nums text-foreground">
                      {autoG != null ? `${fmt1(autoG)}% ${lang === "ar" ? "(تلقائي)" : "(auto)"}` : `— ${lang === "ar" ? "(لا أساس)" : "(no basis)"}`}
                    </b>
                  ) : (
                    <b className="tabular-nums text-foreground">{fmt1(gManual)}%</b>
                  )}
                </span>
                <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                  <button
                    onClick={() => setGMode("auto")}
                    className={`rounded-full border px-2 py-0.5 transition-colors ${
                      gMode === "auto" ? "border-foreground/20 bg-secondary font-semibold" : "border-transparent text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {lang === "ar" ? "تلقائي (ROE×الاحتجاز)" : "auto (ROE×retention)"}
                  </button>
                  <button
                    onClick={() => setGMode("manual")}
                    className={`rounded-full border px-2 py-0.5 transition-colors ${
                      gMode === "manual" ? "border-foreground/20 bg-secondary font-semibold" : "border-transparent text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {lang === "ar" ? "يدوي" : "manual"}
                  </button>
                  {gMode === "manual" && (
                    <input
                      dir="ltr"
                      inputMode="decimal"
                      value={gManual}
                      onChange={(e) => setGManual(num(e.target.value))}
                      className="h-7 w-16 rounded-md border bg-background px-1.5 text-center text-xs tabular-nums outline-none focus:ring-1 focus:ring-ring"
                      aria-label="g"
                    />
                  )}
                </div>
                {gMode === "auto" && autoG != null && (
                  <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                    {lang === "ar"
                      ? `g = ROE ${fmt1(row.roe)}% × (1 − توزيع ${Math.round((row.payout ?? 0) * 100)}%) مقيدًا عند ${data.assumptions.gCap}%.`
                      : `g = ROE ${fmt1(row.roe)}% × (1 − payout ${Math.round((row.payout ?? 0) * 100)}%), capped at ${data.assumptions.gCap}%.`}
                  </p>
                )}
              </div>

              <label className="block">
                <span className="flex items-center justify-between text-[11px] text-muted-foreground">
                  {lang === "ar" ? "هامش الأمان" : "Margin of safety"}
                  <b className="tabular-nums text-foreground">{Math.round(mos * 100)}%</b>
                </span>
                <input
                  type="range"
                  dir="ltr"
                  min={0}
                  max={0.4}
                  step={0.05}
                  value={mos}
                  onChange={(e) => setMos(Number(e.target.value))}
                  className="mt-1 w-full accent-primary"
                />
              </label>
            </div>

            {/* results */}
            <div className="space-y-3">
              {/* verdict header */}
              <div className="rounded-xl border bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] text-muted-foreground">{lang === "ar" ? "القيمة العادلة الممزوكة (٥ نماذج)" : "Blended fair value (5 models)"}</p>
                    <p className="text-2xl font-bold tabular-nums">
                      {fv.blend != null ? fmt2(fv.blend) : "—"}
                      <span className="ms-1 text-xs font-normal text-muted-foreground">EGP</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-0.5" title={`${coverageDots}/5 ${lang === "ar" ? "نماذج" : "models"}`}>
                      {[0, 1, 2, 3, 4].map((i) => (
                        <span key={i} className={`size-2 rounded-full ${i < coverageDots ? "bg-primary" : "bg-muted"}`} />
                      ))}
                    </span>
                    <div className="text-end">
                      <p className={`text-xl font-bold tabular-nums`} style={{ color: upsideColor(fv.upside) }}>
                        {fmtPct(fv.upside, 0)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{lang === "ar" ? "من السعر الحالي" : "vs current price"}</p>
                    </div>
                    {verdict && (
                      <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ color: verdict.color, backgroundColor: `${verdict.color}1a` }}>
                        {lang === "ar" ? verdict.ar : verdict.en}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[10px] tabular-nums text-muted-foreground">
                    <span>
                      {lang === "ar" ? "السعر" : "price"} <b className="text-foreground">{fmt2(row.close)}</b>
                    </span>
                    <span>
                      {lang === "ar" ? "القيمة العادلة" : "fair value"} <b className="text-foreground">{fmt2(fv.blend)}</b>
                    </span>
                  </div>
                  <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-secondary" dir="ltr" aria-hidden>
                    <div className="h-full rounded-full" style={{ width: `${priceFill}%`, backgroundColor: upsideColor(fv.upside), opacity: 0.75 }} />
                  </div>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    {lang === "ar"
                      ? `r ${fmt1(fv.r)}% · g ${fmt1(fv.g) ?? "—"}% · ${coverageDots}/٥ نماذج · أوزان معاد تسويتها على المتاح`
                      : `r ${fmt1(fv.r)}% · g ${fmt1(fv.g) ?? "—"}% · ${coverageDots}/5 models · weights renormalized over what exists`}
                  </p>
                </div>
              </div>

              {/* the five models, formulas with real numbers */}
              <div className="rounded-xl border bg-card p-3">
                <h2 className="flex items-center gap-1.5 text-sm font-bold">
                  <Calculator className="h-4 w-4 text-primary" aria-hidden />
                  {lang === "ar" ? "النماذج الخمسة على هذا السهم" : "The five models on this stock"}
                </h2>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-[10px] text-muted-foreground">
                        <th className="py-1.5 text-start font-medium">{lang === "ar" ? "النموذج" : "Model"}</th>
                        <th className="py-1.5 px-2 text-end font-medium">{lang === "ar" ? "القيمة" : "Value"}</th>
                        <th className="py-1.5 px-2 text-end font-medium">{lang === "ar" ? "من السعر" : "vs price"}</th>
                        <th className="py-1.5 px-2 text-end font-medium">{lang === "ar" ? "الوزن" : "Weight"}</th>
                        <th className="py-1.5 ps-2 text-start font-medium">{lang === "ar" ? "المعادلة بأرقامها" : "Formula with its numbers"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fv.models.map((m) => {
                        const diff = m.value != null && row.close ? ((m.value / row.close) - 1) * 100 : null;
                        return (
                          <tr key={m.id} className="border-b last:border-0">
                            <td className="py-1.5 pe-2 font-semibold">{lang === "ar" ? MODEL_LABELS[m.id].ar : MODEL_LABELS[m.id].en}</td>
                            <td className="py-1.5 px-2 text-end font-bold tabular-nums">{m.value != null ? fmt2(m.value) : "—"}</td>
                            <td className={`py-1.5 px-2 text-end tabular-nums ${diff == null ? "text-muted-foreground" : diff >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                              {fmtPct(diff, 0)}
                            </td>
                            <td className="py-1.5 px-2 text-end tabular-nums text-muted-foreground">{Math.round(m.weight * 100)}%</td>
                            <td className="py-1.5 ps-2 text-[10px] leading-snug text-muted-foreground">
                              {m.value != null ? (lang === "ar" ? m.formulaAr : m.formulaEn) : (lang === "ar" ? m.missingAr : m.missingEn)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* sensitivity grid */}
              <div className="rounded-xl border bg-card p-3">
                <h2 className="flex items-center gap-1.5 text-sm font-bold">
                  <Grid3x3 className="h-4 w-4 text-primary" aria-hidden />
                  {lang === "ar" ? "شبكة الحساسية: النمو × الخصم" : "Sensitivity grid: growth × discount"}
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {lang === "ar"
                    ? "فرق السعر عند إعادة تشغيل المزيج عند كل زوج (g, r) — الصف الأفقي g، العمود r. الخلية الحالية مؤطرة."
                    : "The upside when the blend is re-run at each (g, r) pair — rows are g, columns are r. The current cell is ringed."}
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
                            const isCurrent = Math.abs(gv - (fv.g ?? 0)) < 0.05 && Math.abs(rv - (fv.r ?? 0)) < 0.05;
                            return (
                              <td key={`c${j}`} className="p-0.5">
                                <span
                                  className={`block rounded px-1.5 py-1 text-center font-semibold ${isCurrent ? "ring-2 ring-foreground/50" : ""}`}
                                  style={{
                                    backgroundColor: cell == null ? "var(--secondary)" : `${upsideColor(cell)}26`,
                                    color: cell == null ? "var(--muted-foreground)" : upsideColor(cell),
                                  }}
                                >
                                  {cell == null ? "—" : `${cell >= 0 ? "+" : ""}${cell.toFixed(0)}%`}
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

              {/* DCF card — the earnings-power view */}
              <div className="rounded-xl border bg-card p-3">
                <h2 className="flex items-center gap-1.5 text-sm font-bold">
                  <TrendingUp className="h-4 w-4 text-primary" aria-hidden />
                  {lang === "ar" ? "DCF مرحلي (١٠ سنوات)" : "Two-stage DCF (10 years)"}
                </h2>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {lang === "ar"
                    ? "صافي الربح TTM ينمو بمعدلك عشر سنوات ثم قيمة نهائية، والكل يُخصم — مطابق لحاسبة صفحة الشركة. الافتراضي ٢٢٪ خصم لأن فائدة الجنيه في مصر مرتفعة."
                    : "TTM net income grows at your rate for ten years then a terminal value, all discounted — the same math as the company page's calculator. The 22% default reflects Egypt's cost of money."}
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                  {(
                    [
                      [lang === "ar" ? "نمو سنوي" : "annual growth", dcfG, setDcfG, 0, 40],
                      [lang === "ar" ? "خصم" : "discount", dcfR, setDcfR, 5, 45],
                      [lang === "ar" ? "نمو نهائي" : "terminal", dcfT, setDcfT, 0, 20],
                    ] as [string, number, (v: number) => void, number, number][]
                  ).map(([label, value, setter, min, max]) => (
                    <label key={label} className="block">
                      <span className="flex items-center justify-between text-muted-foreground">
                        {label}
                        <b className="tabular-nums text-foreground">{value}%</b>
                      </span>
                      <input type="range" dir="ltr" min={min} max={max} step={0.5} value={value} onChange={(e) => setter(Number(e.target.value))} className="mt-1 w-full accent-primary" />
                    </label>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 text-[11px]">
                  <div className="rounded-lg bg-secondary/50 p-2">
                    <span className="block text-muted-foreground">{lang === "ar" ? "قيمة/سهم" : "value/share"}</span>
                    <b className="tabular-nums text-base">{dcf ? fmt2(dcf.perShare) : "—"}</b>
                  </div>
                  <div className="rounded-lg bg-secondary/50 p-2">
                    <span className="block text-muted-foreground">{lang === "ar" ? "من السعر" : "vs price"}</span>
                    <b className={`tabular-nums text-base ${dcf && row.close && dcf.perShare >= row.close ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      {dcf && row.close ? fmtPct(((dcf.perShare / row.close) - 1) * 100, 0) : "—"}
                    </b>
                  </div>
                  <div className="rounded-lg bg-secondary/50 p-2">
                    <span className="block text-muted-foreground">{lang === "ar" ? "قيمة المنشأة" : "enterprise"}</span>
                    <b className="tabular-nums text-sm">EGP {fmtCap(dcf?.ev)}</b>
                  </div>
                  <div className="rounded-lg bg-secondary/50 p-2">
                    <span className="block text-muted-foreground">{lang === "ar" ? "القيمة النهائية" : "PV terminal"}</span>
                    <b className="tabular-nums text-sm">EGP {fmtCap(dcf?.pvTerminal)}</b>
                  </div>
                </div>
                {!dcf && (
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    {lang === "ar" ? "لا أرباح TTM منشورة لهذه الشركة — النموذج معطّل بأمانة." : "No published TTM earnings for this company — the model stays off, honestly."}
                  </p>
                )}
              </div>
            </div>
          </div>

          <p className="rounded-xl border bg-card/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
            {lang === "ar"
              ? "كل ما فوقه نموذج تعليمي شفاف على بيانات مؤجلة ~١٥ دقيقة: حرّك الافتراضات لترى كيف تتحرك «القيمة» — النتيجة ليست توصية، والمنهجية الكاملة بمعادلاتها في قسم الأبحاث."
              : "Everything above is a transparent teaching model on ~15-minute-delayed data: move the assumptions to see how \"value\" moves — the result is not advice, and the full methodology with its equations lives in Research."}
          </p>
        </>
      )}
    </div>
  );
}
