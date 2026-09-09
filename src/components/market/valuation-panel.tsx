"use client";

/** Valuation layer (G10) for the company view:
 *  1. A teaching-grade DCF calculator with editable assumptions (Finbox
 *     style): the numbers come from the company's own TTM fundamentals, the
 *     discount-rate default is anchored to Egypt's ~19-27% rate environment,
 *     and every result is labeled as a model, not a verdict.
 *  2. A Simply-Wall-St-style five-factor score rendered as an SVG snowflake
 *     (value / future / past performance / health / dividends), each scored
 *     0-5 from live fundamentals and sector medians the site already serves.
 *  Everything is computed client-side from /api/company — no new data source. */

import { useMemo, useState } from "react";
import { useApp } from "./app-context";
import { T, tt } from "@/lib/i18n";
import { fmtNum, fmtPct, fmtValue, directionClass } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calculator, Snowflake, RotateCcw, Download } from "lucide-react";
import { downloadCsv } from "@/lib/export";

type CompanyFund = {
  ticker: string;
  close: number | null;
  marketCap: number | null;
  pe: number | null;
  pb?: number | null;
  roe?: number | null;
  divYield: number | null;
  payoutRatio?: number | null;
  grossMarginTTM?: number | null;
  revenueGrowthQ?: number | null;
  debtToEquity?: number | null;
  netIncomeTTM?: number | null;
  netDebt?: number | null;
  revenueTTM?: number | null;
  netMarginTTM?: number | null;
};

type SectorAgg = {
  pe: number | null;
  pb: number | null;
  roe: number | null;
  divYield: number | null;
};

// ── snowflake scoring ──

function clamp(v: number, lo = 0, hi = 5): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Score one factor 0-5 from live fundamentals (transparent formulas). */
function snowflakeScores(c: CompanyFund, sector: SectorAgg) {
  // Value: P/E and P/B vs the sector median (cheaper = higher)
  const peRatio = c.pe && sector.pe && c.pe > 0 && sector.pe > 0 ? c.pe / sector.pe : null;
  const pbRatio = c.pb && sector.pb && c.pb > 0 && sector.pb > 0 ? c.pb / sector.pb : null;
  const relScore = (ratio: number | null) =>
    ratio === null ? null : clamp((2 - ratio) / 1.5 * 5);
  const relParts = [relScore(peRatio), relScore(pbRatio)].filter((x): x is number => x !== null);
  const value = relParts.length ? relParts.reduce((s, x) => s + x, 0) / relParts.length : null;

  // Future: revenue growth (quarterly YoY) — 0% → 0, 25%+ → 5
  const future = c.revenueGrowthQ == null ? null : clamp(c.revenueGrowthQ / 5);

  // Past: ROE (5% → 0, 30% → 5) blended with net margin (0 → 0, 20% → 5)
  const roeScore = c.roe == null ? null : clamp((c.roe - 5) / 5);
  const marginScore = c.netMarginTTM == null ? null : clamp(c.netMarginTTM / 4);
  const pastParts = [roeScore, marginScore].filter((x): x is number => x !== null);
  const past = pastParts.length ? pastParts.reduce((s, x) => s + x, 0) / pastParts.length : null;

  // Health: debt/equity (0 → 5, 1.5+ → 0) plus net-cash bonus
  let health = c.debtToEquity == null ? null : clamp((1.5 - c.debtToEquity) / 0.3);
  if (health !== null && c.netDebt != null && c.netDebt < 0) health = clamp(health + 1);

  // Dividends: yield (0 → 0, 10%+ → 5) with a sustainable-payout bonus (30-70%)
  let div = c.divYield == null ? null : clamp(c.divYield / 2);
  if (div !== null && c.payoutRatio != null && c.payoutRatio >= 0.3 && c.payoutRatio <= 0.7) div = clamp(div + 0.5);

  return { value, future, past, health, div };
}

function SnowflakeChart({ scores, lang }: { scores: Record<string, number | null>; lang: "ar" | "en" }) {
  const R = 78;
  const CX = 110;
  const CY = 105;
  const N = 5;
  const angles = Array.from({ length: N }, (_, i) => (-90 + i * (360 / N)) * (Math.PI / 180));
  const pt = (i: number, r: number) => ({
    x: CX + r * Math.cos(angles[i]),
    y: CY + r * Math.sin(angles[i]),
  });
  const polygon = (r: number) => angles.map((_, i) => pt(i, r)).map((p) => `${p.x},${p.y}`).join(" ");
  const labels = [
    { ar: "القيمة", en: "Value" },
    { ar: "المستقبل", en: "Future" },
    { ar: "الأداء", en: "Past" },
    { ar: "الملاءة", en: "Health" },
    { ar: "التوزيعات", en: "Dividends" },
  ];
  const keys = ["value", "future", "past", "health", "div"];
  const dataPts = keys.map((k, i) => pt(i, ((scores[k] ?? 0) / 5) * R));
  const dataPolygon = dataPts.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <svg viewBox="0 0 220 215" className="w-full max-w-[260px] mx-auto" role="img" aria-label="five-factor score">
      {[0.2, 0.4, 0.6, 0.8, 1].map((f) => (
        <polygon key={f} points={polygon(R * f)} fill="none" stroke="var(--border)" strokeWidth={1} />
      ))}
      {angles.map((_, i) => {
        const p = pt(i, R);
        return <line key={i} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="var(--border)" strokeWidth={1} />;
      })}
      <polygon points={dataPolygon} fill="var(--c3)" fillOpacity={0.25} stroke="var(--c3)" strokeWidth={2} />
      {dataPts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill="var(--c3)" />
      ))}
      {labels.map((l, i) => {
        const p = pt(i, R + 18);
        return (
          <text
            key={l.en}
            x={p.x}
            y={p.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={11}
            fill="var(--muted-foreground)"
          >
            {lang === "ar" ? l.ar : l.en}
            <tspan x={p.x} dy={12} fontSize={11} fill="var(--foreground)" fontWeight={600}>
              {scores[keys[i]] != null ? (scores[keys[i]] as number).toFixed(1) : "—"}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}

// ── DCF calculator ──

function dcfPerShare(
  fcf0: number,
  growth: number, // percent per year, years 1-10
  discount: number, // percent
  terminal: number, // percent
  netDebt: number,
  shares: number
): { perShare: number; ev: number; pvSum: number; pvTerminal: number } | null {
  if (!(fcf0 > 0) || !(shares > 0)) return null;
  const g = growth / 100;
  const r = discount / 100;
  const gt = terminal / 100;
  if (r <= gt) return null; // model breaks — guarded in the UI too
  let pvSum = 0;
  let fcf = fcf0;
  for (let t = 1; t <= 10; t++) {
    fcf = fcf * (1 + g);
    pvSum += fcf / Math.pow(1 + r, t);
  }
  const tv = (fcf * (1 + gt)) / (r - gt);
  const pvTerminal = tv / Math.pow(1 + r, 10);
  const ev = pvSum + pvTerminal;
  const equity = ev - netDebt;
  return { perShare: equity / shares, ev, pvSum, pvTerminal };
}

export function ValuationPanel({ company, sectorAgg }: { company: CompanyFund; sectorAgg: SectorAgg }) {
  const { lang } = useApp();

  // editable assumptions — Egypt-anchored defaults
  const [growth, setGrowth] = useState("10");
  const [discount, setDiscount] = useState("22");
  const [terminal, setTerminal] = useState("5");

  const shares = useMemo(
    () => (company.marketCap && company.close && company.close > 0 ? company.marketCap / company.close : null),
    [company.marketCap, company.close]
  );

  const fcf0 =
    company.netIncomeTTM != null
      ? company.netIncomeTTM
      : company.revenueTTM != null && company.netMarginTTM != null
        ? company.revenueTTM * company.netMarginTTM
        : null;

  const dcf = useMemo(() => {
    if (fcf0 == null || shares == null) return null;
    return dcfPerShare(fcf0, Number(growth), Number(discount), Number(terminal), company.netDebt ?? 0, shares);
  }, [fcf0, shares, growth, discount, terminal, company.netDebt]);

  const scores = useMemo(() => snowflakeScores(company, sectorAgg), [company, sectorAgg]);
  const totalScore = useMemo(() => {
    const vals = Object.values(scores).filter((x): x is number => x !== null);
    return vals.length ? vals.reduce((s, x) => s + x, 0) : null;
  }, [scores]);

  const upside = dcf && company.close ? ((dcf.perShare / company.close) - 1) * 100 : null;
  const broken = Number(discount) <= Number(terminal);

  const gLabel = lang === "ar" ? "نمو سنوي متوقع (٪)" : "Expected annual growth (%)";
  const rLabel = lang === "ar" ? "معدل الخصم (٪)" : "Discount rate (%)";
  const tLabel = lang === "ar" ? "النمو النهائي (٪)" : "Terminal growth (%)";

  return (
    <div className="space-y-5">
      {/* DCF calculator */}
      <section aria-label="dcf calculator" className="rounded-lg border bg-card p-4">
        <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            {lang === "ar" ? "حاسبة القيمة العادلة (DCF)" : "Fair-value calculator (DCF)"}
          </h2>
          {company.close != null && (
            <span className="num text-[11px] text-muted-foreground">
              {tt(T.alertCurrentPrice, lang)}: {fmtNum(company.close)}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-4 max-w-3xl leading-relaxed">
          {lang === "ar"
            ? "نموذج تدفعات مخصومة لتعليمي: الربح الحالي (TTM) ينمو بالمعدل الذي تختاره عشر سنوات، ثم قيمة نهائية، والكل يُخصم بمعدلك. المعدل الافتراضي ٢٢٪ لأن سعر الفائدة في مصر يجعل الجنيه اليوم أغلى بكثير من الجنيه غداً. غيّر الافتراضات لترى كيف تتغير \"القيمة\" — هذا ليس توصية."
            : "A teaching discounted-cash-flow model: current TTM earnings grow at your chosen rate for ten years, then a terminal value, all discounted at your rate. The default is 22% because Egyptian interest rates make today's pound far more expensive than tomorrow's. Move the assumptions to see how \"value\" moves — this is not advice."}
        </p>

        <div className="grid gap-5 lg:grid-cols-[1fr_16rem] items-start">
          {/* assumptions + result */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-[11px] text-muted-foreground">{gLabel}</span>
                <Input dir="ltr" inputMode="decimal" value={growth} onChange={(e) => setGrowth(e.target.value)} className="h-8 text-xs num mt-1" />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">{rLabel}</span>
                <Input dir="ltr" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} className="h-8 text-xs num mt-1" />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">{tLabel}</span>
                <Input dir="ltr" inputMode="decimal" value={terminal} onChange={(e) => setTerminal(e.target.value)} className="h-8 text-xs num mt-1" />
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] gap-1.5 text-muted-foreground"
                onClick={() => {
                  setGrowth("10");
                  setDiscount("22");
                  setTerminal("5");
                }}
              >
                <RotateCcw className="h-3 w-3" />
                {lang === "ar" ? "الافتراضات" : "Defaults"}
              </Button>
              {fcf0 == null && (
                <span className="text-[11px] text-muted-foreground">
                  {lang === "ar" ? "لا توجد أرباح TTM منشورة لهذه الشركة" : "No published TTM earnings for this company"}
                </span>
              )}
            </div>

            {broken ? (
              <p className="text-xs text-down">
                {lang === "ar"
                  ? "معدل الخصم يجب أن يكون أعلى من النمو النهائي وإلا يستحيل النموذج."
                  : "Discount rate must exceed terminal growth or the model is impossible."}
              </p>
            ) : dcf ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    {lang === "ar" ? "القيمة العادلة/سهم" : "Fair value/share"}
                  </p>
                  <p className="num text-xl font-bold">{fmtNum(dcf.perShare)}</p>
                  <p className="num text-[10px] text-muted-foreground">EGP</p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    {lang === "ar" ? "مقارنة بالسعر" : "vs current price"}
                  </p>
                  <p className={`num text-xl font-bold ${directionClass(upside)}`}>
                    {upside != null ? fmtPct(upside) : "—"}
                  </p>
                  <p className="num text-[10px] text-muted-foreground">
                    {upside != null ? (upside >= 0 ? (lang === "ar" ? "أرخص من النموذج" : "model says cheap") : lang === "ar" ? "أغلى من النموذج" : "model says rich") : ""}
                  </p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    {lang === "ar" ? "قيمة المنشأة (EV)" : "Enterprise value"}
                  </p>
                  <p className="num text-lg font-bold">EGP {fmtValue(dcf.ev)}</p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    {lang === "ar" ? "الأسهم المتداولة" : "Shares"}
                  </p>
                  <p className="num text-lg font-bold">{fmtNum(shares ?? 0, 0)}</p>
                  <p className="num text-[10px] text-muted-foreground">
                    {lang === "ar" ? "من القيمة السوقية ÷ السعر" : "market cap ÷ price"}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {lang === "ar" ? "أدخل افتراضات صحيحة لحساب النموذج." : "Enter valid assumptions to run the model."}
              </p>
            )}
          </div>

          {/* model inputs readout */}
          <div className="rounded-lg bg-secondary/40 p-3 space-y-1.5 text-[11px]">
            <p className="font-semibold text-foreground/80">{lang === "ar" ? "مدخلات النموذج" : "Model inputs"}</p>
            <p className="num text-muted-foreground flex justify-between">
              <span>{lang === "ar" ? "الربح TTM" : "TTM earnings"}</span>
              <b>{fcf0 != null ? `EGP ${fmtValue(fcf0)}` : "—"}</b>
            </p>
            <p className="num text-muted-foreground flex justify-between">
              <span>{lang === "ar" ? "صافي الدين" : "Net debt"}</span>
              <b>{company.netDebt != null ? `EGP ${fmtValue(company.netDebt)}` : "—"}</b>
            </p>
            <p className="num text-muted-foreground flex justify-between">
              <span>P/E</span>
              <b>{company.pe != null ? fmtNum(company.pe, 1) : "—"}</b>
            </p>
            <p className="num text-muted-foreground flex justify-between">
              <span>{lang === "ar" ? "وسيط القطاع P/E" : "Sector median P/E"}</span>
              <b>{sectorAgg.pe != null ? fmtNum(sectorAgg.pe, 1) : "—"}</b>
            </p>
            <p className="num text-muted-foreground flex justify-between">
              <span>{lang === "ar" ? "القيمة الحالية للتدفقات" : "PV of cash flows"}</span>
              <b>{dcf ? `EGP ${fmtValue(dcf.pvSum)}` : "—"}</b>
            </p>
            <p className="num text-muted-foreground flex justify-between">
              <span>{lang === "ar" ? "القيمة الحالية للنهاية" : "PV of terminal"}</span>
              <b>{dcf ? `EGP ${fmtValue(dcf.pvTerminal)}` : "—"}</b>
            </p>
            <p className="text-[10px] text-muted-foreground pt-1 leading-relaxed">
              {lang === "ar"
                ? "الأرقام من TradingView (TTM) والسعر مؤجل ~١٥ دقيقة."
                : "Figures from TradingView (TTM); price delayed ~15 min."}
            </p>
          </div>
        </div>
      </section>

      {/* snowflake five-factor score */}
      <section aria-label="five factor score" className="rounded-lg border bg-card p-4">
        <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Snowflake className="h-4 w-4 text-primary" />
            {lang === "ar" ? "لوحة خمس عوامل" : "Five-factor score"}
          </h2>
          {totalScore != null && (
            <span className="num text-[11px] text-muted-foreground">
              {lang === "ar" ? "الإجمالي" : "Total"}: <b className="text-foreground">{totalScore.toFixed(1)}/25</b>
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-2 max-w-3xl leading-relaxed">
          {lang === "ar"
            ? "كل عامل من ٥: القيمة مقابل وسيط القطاع، النمو المتوقع، الأداء التاريخي، الملاءة، والتوزيعات — من نفس أرقام صفحة الشركة، مقارنةً بقطاعها. صورة سريعة للملف، ليست توصية."
            : "Each factor out of 5: value vs the sector median, expected growth, past performance, health, and dividends — from the same numbers on the company page, compared against its sector. A quick profile, not advice."}
        </p>
        <div className="grid gap-4 sm:grid-cols-[260px_1fr] items-center">
          <SnowflakeChart scores={scores} lang={lang} />
          <div className="space-y-2">
            {(
              [
                ["value", lang === "ar" ? "القيمة — أرخص أم أغلى من القطاع؟" : "Value — cheaper or pricier than the sector?"],
                ["future", lang === "ar" ? "المستقبل — نمو الإيرادات (ربع سنوي)" : "Future — revenue growth (quarterly YoY)"],
                ["past", lang === "ar" ? "الأداء — عائد حقوق الملكية والهامش" : "Past — return on equity and margin"],
                ["health", lang === "ar" ? "الملاءة — الدين مقابل النقد" : "Health — debt versus cash"],
                ["div", lang === "ar" ? "التوزيعات — العائد واستدامته" : "Dividends — yield and sustainability"],
              ] as const
            ).map(([k, label]) => {
              const v = scores[k];
              return (
                <div key={k} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-muted-foreground leading-snug">{label}</p>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden mt-1" dir="ltr">
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{ width: `${((v ?? 0) / 5) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="num text-xs font-semibold w-8 text-end">{v != null ? v.toFixed(1) : "—"}</span>
                </div>
              );
            })}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] gap-1 text-muted-foreground"
              onClick={() => {
                const headers = ["factor", "score_0_to_5"];
                const rows = (["value", "future", "past", "health", "div"] as const).map((k) => [
                  k, scores[k] != null ? +(scores[k] as number).toFixed(2) : null,
                ]);
                downloadCsv(`egx-${company.ticker}-snowflake`, headers, rows);
              }}
            >
              <Download className="h-3 w-3" />
              CSV
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
