"use client";

/** T64 — the CHEAP-STOCKS tab: every stock ranked by how far it trades
 *  BELOW its five-model blended fair value — the screen the section always
 *  owed the reader. Honest by construction:
 *   - only stocks with a computed fair value appear (a missing model drops
 *     out, it never gets a phantom number);
 *   - the coverage dots show how many of the 5 models actually ran;
 *   - the assumptions strip prints the exact discount-rate and margin-of-
 *     safety defaults the engine used, with a link to the full methodology
 *     paper in Research;
 *   - and the ranking is a reading aid, not a buy list. */

import { useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { FlaskConical, ArrowRight, BookOpen } from "lucide-react";
import { FV_VERDICT_META, DEBT_ZONE_META, upsideColor } from "@/lib/fair-value";
import { fmt1, fmt2, fmtCap, fmtPct, type ValData, type ValRow } from "./valuation-shared";

type SortKey = "upside" | "coverage" | "cap";

export function ValuationCheapTab({ data, rows }: { data: ValData; rows: ValRow[] }) {
  const { lang, navigate } = useApp();
  const [minUpside, setMinUpside] = useState(15);
  const [needCoverage, setNeedCoverage] = useState(true);
  const [sort, setSort] = useState<SortKey>("upside");

  const candidates = useMemo(
    () => rows.filter((r) => r.fv != null && r.upside != null && r.close != null && r.close > 0),
    [rows]
  );

  const list = useMemo(() => {
    let out = candidates;
    if (needCoverage) out = out.filter((r) => (r.fvCoverage ?? 0) >= 0.6);
    if (minUpside > 0) out = out.filter((r) => (r.upside as number) >= minUpside);
    const cmp: Record<SortKey, (a: ValRow, b: ValRow) => number> = {
      upside: (a, b) => (b.upside as number) - (a.upside as number),
      coverage: (a, b) => (b.fvCoverage ?? 0) - (a.fvCoverage ?? 0) || (b.upside as number) - (a.upside as number),
      cap: (a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0),
    };
    return [...out].sort(cmp[sort]);
  }, [candidates, needCoverage, minUpside, sort]);

  const medUpside = useMemo(() => {
    const ups = candidates.map((r) => r.upside as number).sort((a, b) => a - b);
    return ups.length ? ups[Math.floor(ups.length / 2)] : null;
  }, [candidates]);

  const upsideChips: { v: number; label: string }[] = [
    { v: 15, label: lang === "ar" ? "خصم ١٥٪+" : "15%+ discount" },
    { v: 30, label: lang === "ar" ? "خصم ٣٠٪+" : "30%+ discount" },
    { v: 50, label: lang === "ar" ? "خصم ٥٠٪+" : "50%+ discount" },
    { v: 0, label: lang === "ar" ? "الكل" : "all" },
  ];

  return (
    <div className="space-y-3">
      {/* assumptions strip — the "how do you get fair value" answer, on the page */}
      <div className="rounded-xl border bg-card p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
          <span className="font-semibold">{lang === "ar" ? "افتراضات المحرك:" : "Engine assumptions:"}</span>
          <span className="tabular-nums text-muted-foreground">
            r<sub>free</sub> = {fmt1(data.assumptions.rf)}% ({data.assumptions.rfSource})
          </span>
          <span className="tabular-nums text-muted-foreground">{lang === "ar" ? "علاوة المخاطر" : "ERP"} = {fmt1(data.assumptions.erp)}%</span>
          <span className="tabular-nums text-muted-foreground">
            β {lang === "ar" ? "لكل سهم" : "per stock"} · g {lang === "ar" ? "من" : "from"} ROE×{lang === "ar" ? "الاحتجاز" : "retention"} ({lang === "ar" ? "سقف" : "cap"} {data.assumptions.gCap}%)
          </span>
          <span className="tabular-nums text-muted-foreground">
            {lang === "ar" ? "أمان الهامش" : "margin of safety"} = {Math.round(data.assumptions.mos * 100)}%
          </span>
          <button onClick={() => navigate("research")} className="inline-flex items-center gap-1 text-primary hover:underline">
            <BookOpen className="h-3 w-3" aria-hidden />
            {lang === "ar" ? "كيف تُحسب القيمة العادلة؟" : "how fair value is computed ↗"}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {lang === "ar"
            ? "خمسة نماذج (مكرر القطاع × الربح، مضاعف القطاع × الدفترية، رقم جراهام، جوردون للتوزيعات، والمضاعف المبرر) تُمزج بأوزان معاد تسويتها — القيمة الناتجة قراءة نموذجية معلنة الافتراضات، وليست توصية شراء."
            : "Five models (sector P/E × earnings, sector P/B × book, Graham number, Gordon DDM, justified P/B) blended with renormalized weights — the result is a model reading with its assumptions printed, not a buy recommendation."}
        </p>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
        <span className="flex items-center gap-1">
          {upsideChips.map((c) => (
            <button
              key={c.v}
              onClick={() => setMinUpside(c.v)}
              className={`rounded-full border px-2 py-0.5 transition-colors ${
                minUpside === c.v ? "border-foreground/20 bg-secondary font-semibold" : "border-transparent text-muted-foreground hover:bg-accent"
              }`}
            >
              {c.label}
            </button>
          ))}
        </span>
        <button
          onClick={() => setNeedCoverage((v) => !v)}
          className={`rounded-full border px-2 py-0.5 transition-colors ${
            needCoverage ? "border-foreground/20 bg-secondary font-semibold" : "border-transparent text-muted-foreground hover:bg-accent"
          }`}
        >
          {lang === "ar" ? "٣ نماذج فأكثر" : "3+ models coverage"}
        </button>
        <span className="flex items-center gap-1 text-muted-foreground">
          {lang === "ar" ? "ترتيب:" : "sort:"}
          {(
            [
              ["upside", lang === "ar" ? "الخصم" : "discount"],
              ["coverage", lang === "ar" ? "التغطية" : "coverage"],
              ["cap", lang === "ar" ? "الحجم" : "size"],
            ] as [SortKey, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={`rounded-full border px-2 py-0.5 transition-colors ${
                sort === k ? "border-foreground/20 bg-secondary font-semibold" : "border-transparent text-muted-foreground hover:bg-accent"
              }`}
            >
              {label}
            </button>
          ))}
        </span>
        <span className="ms-auto tabular-nums text-muted-foreground">
          {list.length} / {candidates.length} {lang === "ar" ? "سهمًا له قيمة عادلة" : "stocks with a fair value"}
          {medUpside != null && ` · ${lang === "ar" ? "وسيط الفرق" : "median upside"} ${fmtPct(medUpside, 0)}`}
        </span>
      </div>

      {/* the ranked cards */}
      {list.length ? (
        <div className="grid gap-2 lg:grid-cols-2">
          {list.map((row) => {
            const dots = Math.round((row.fvCoverage ?? 0) * 5);
            const v = row.verdict != null ? FV_VERDICT_META[row.verdict] : null;
            const priceFill = Math.min(100, ((row.close as number) / (row.fv as number)) * 100);
            const zone = row.debtZone != null ? DEBT_ZONE_META[row.debtZone] : null;
            return (
              <div key={row.ticker} className="rounded-xl border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <button onClick={() => navigate("company", { ticker: row.ticker })} className="min-w-0 text-start">
                    <div className="flex items-center gap-1.5">
                      <b className="font-bold">{row.ticker}</b>
                      <span className="flex items-center gap-0.5" title={`${dots}/5 ${lang === "ar" ? "نماذج" : "models"}`}>
                        {[0, 1, 2, 3, 4].map((i) => (
                          <span key={i} className={`size-1.5 rounded-full ${i < dots ? "bg-primary" : "bg-muted"}`} />
                        ))}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {lang === "ar" ? row.nameAr : row.nameEn} · {lang === "ar" ? row.sectorAr : row.sector}
                    </p>
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-bold tabular-nums"
                      style={{ color: upsideColor(row.upside), backgroundColor: `${upsideColor(row.upside)}1a` }}
                    >
                      {fmtPct(row.upside, 0)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {lang === "ar" ? "من القيمة العادلة" : "vs fair value"}
                    </span>
                  </div>
                </div>

                {/* price vs fair value bar */}
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[10px] tabular-nums text-muted-foreground">
                    <span>
                      {lang === "ar" ? "السعر" : "price"} <b className="text-foreground">{fmt2(row.close)}</b>
                    </span>
                    <span>
                      {lang === "ar" ? "القيمة العادلة" : "fair value"} <b className="text-foreground">{fmt2(row.fv)}</b>
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-secondary" dir="ltr" aria-hidden>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${priceFill}%`, backgroundColor: upsideColor(row.upside), opacity: 0.75 }}
                    />
                  </div>
                </div>

                {/* meta chips */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] tabular-nums">
                  {v && (
                    <span className="rounded-full px-1.5 py-0.5 font-semibold" style={{ color: v.color, backgroundColor: `${v.color}1a` }}>
                      {lang === "ar" ? v.ar : v.en}
                    </span>
                  )}
                  {row.pe != null && <span className="rounded-full bg-secondary/70 px-1.5 py-0.5">P/E {fmt1(row.pe)}x</span>}
                  {row.pb != null && <span className="rounded-full bg-secondary/70 px-1.5 py-0.5">P/B {fmt1(row.pb)}x</span>}
                  {row.roe != null && <span className="rounded-full bg-secondary/70 px-1.5 py-0.5">ROE {fmt1(row.roe)}%</span>}
                  {row.divYield != null && row.divYield > 0 && (
                    <span className="rounded-full bg-secondary/70 px-1.5 py-0.5">
                      {lang === "ar" ? "توزيع" : "div"} {fmt1(row.divYield)}%
                    </span>
                  )}
                  {zone && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-secondary/70 px-1.5 py-0.5">
                      <span className="size-1.5 rounded-full" style={{ backgroundColor: zone.color }} />
                      {lang === "ar" ? zone.ar : zone.en}
                    </span>
                  )}
                  <span className="rounded-full bg-secondary/70 px-1.5 py-0.5">{fmtCap(row.marketCap)}</span>
                  <button
                    onClick={() => navigate("scenarios", { ticker: row.ticker })}
                    className="ms-auto inline-flex items-center gap-1 rounded-full border border-ring/40 px-1.5 py-0.5 text-primary hover:bg-accent"
                  >
                    <FlaskConical className="h-3 w-3" aria-hidden />
                    {lang === "ar" ? "جرّب النماذج" : "run the models"}
                    <ArrowRight className="h-3 w-3 rtl:rotate-180" aria-hidden />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          {lang === "ar"
            ? "لا أسهم تحت هذا الفلتر الآن — ارفع حد الخصم أو أطفئ شرط التغطية. الخلوات ليست إشارة شراء؛ هي نتيجة الفلاتر فقط."
            : "No stocks under this filter right now — loosen the discount floor or switch off the coverage gate. An empty list is a filter result, not a signal."}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {lang === "ar"
          ? "«رخيصة» تعني أن السعر أدنى من القيمة العادلة الممزوكة بهامش أمان ١٥٪ على الأقل. النماذج تعليمية على بيانات مؤجلة، والخصم العميق قد يعكس مشكلة لا يراها النموذج — راجع الشركة قبل أي قرار، فهذا ليس توصية."
          : "\"Cheap\" means the price sits at least the 15% margin of safety below the blended fair value. The models are educational on delayed data — a deep discount can reflect a problem the model cannot see. Review the company before any decision; this is not advice."}
      </p>
    </div>
  );
}
