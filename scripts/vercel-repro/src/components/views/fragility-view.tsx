"use client";

/** T60 — المزيد → إنذار الانهيارات (crash-warning research), cloned in
 *  STRUCTURE from the source model's published research page — but the
 *  numbers are OURS, computed live by /api/crash-warning on a declared
 *  composite of EGX30 large caps (10y daily, Yahoo — the app's own chart
 *  source; no free source serves the official index for years).
 *
 *  The page's contract with the reader, verbatim in spirit from the source:
 *  a backtest on past prices is a reading of what the rule WOULD have done —
 *  not advice, not a forecast, and not a claim that the next crash will
 *  knock politely before arriving. */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert } from "lucide-react";

type CurvePoint = {
  date: string;
  close: number;
  warning: boolean;
  regime: "stock" | "bill";
  wealthRule: number;
  wealthHold: number;
  drawdownRule: number;
  drawdownHold: number;
};

type Trade = { date: string; action: "to_bills" | "to_stocks"; price: number };

type Data = {
  asOf: string;
  billYield: number;
  members: number;
  compositeNote: { ar: string; en: string };
  stats: {
    sessions: number;
    years: number;
    switches: number;
    warnings: number;
    falseWarnings: number;
    finalRule: number;
    finalHold: number;
    cagrRule: number;
    cagrHold: number;
    worstDdRule: number;
    worstDdHold: number;
  };
  curve: CurvePoint[];
  trades: Trade[];
  last: {
    date: string;
    close: number;
    ma20: number;
    vol20: number;
    volPct: number | null;
    warning: boolean;
    regime: "stock" | "bill";
  };
};

const W = 940;
const H = 380;

const fmtK = (v: number): string =>
  v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v.toFixed(0);

export function FragilityView() {
  const { lang } = useApp();
  const [yieldPct, setYieldPct] = useState(15);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);

  // reset when the yield scenario changes — during render (the codebase's
  // convention) so the skeleton shows without an extra paint
  const [lastYield, setLastYield] = useState(yieldPct);
  if (lastYield !== yieldPct) {
    setLastYield(yieldPct);
    setData(null);
  }

  useEffect(() => {
    fetch(`/api/crash-warning?yield=${yieldPct}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("x"))))
      .then((d: Data) => setData(d))
      .catch(() => setError(true));
  }, [yieldPct]);

  const chart = useMemo(() => {
    if (!data?.curve.length) return null;
    const pts = data.curve;
    const wMin = Math.min(...pts.map((p) => Math.min(p.wealthRule, p.wealthHold))) * 0.98;
    const wMax = Math.max(...pts.map((p) => p.wealthRule), ...pts.map((p) => p.wealthHold)) * 1.02;
    const x = (i: number) => 66 + (i / Math.max(1, pts.length - 1)) * (W - 100);
    const y = (v: number) => H - 42 - ((v - wMin) / (wMax - wMin)) * (H - 72);
    const line = (key: "wealthRule" | "wealthHold") =>
      pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
    // warning bands (regime === bill)
    const bands: { x0: number; x1: number }[] = [];
    let start: number | null = null;
    pts.forEach((p, i) => {
      if (p.regime === "bill" && start == null) start = i;
      if ((p.regime !== "bill" || i === pts.length - 1) && start != null) {
        bands.push({ x0: x(start), x1: x(i) });
        start = null;
      }
    });
    return { pts, x, y, wMin, wMax, lineRule: line("wealthRule"), lineHold: line("wealthHold"), bands };
  }, [data]);

  if (error) {
    return (
      <div className="space-y-3 p-4">
        <h1 className="text-lg font-bold">{lang === "ar" ? "إنذار الانهيارات" : "Crash warning"}</h1>
        <p className="text-sm text-muted-foreground">{lang === "ar" ? "تعذّر التحميل." : "Unavailable."}</p>
      </div>
    );
  }

  const s = data?.stats;

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-primary" aria-hidden />
          <h1 className="text-lg font-bold">
            {lang === "ar" ? "بحث إنذار الانهيارات" : "Crash-warning research"}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {lang === "ar"
            ? `هل كان إنذار مبكر سيخفّف أسوأ تراجعات البورصة المصرية؟ قاعدة واحدة على ${s ? s.sessions.toLocaleString("en-US") : "—"} جلسة تداول، مُختبرة على مؤشر مرجعي مركّب.`
            : `Would an early warning have softened the exchange's worst crashes? One rule over ${s ? s.sessions.toLocaleString("en-US") : "—"} trading sessions, tested on a reference composite.`}
        </p>
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          {lang === "ar"
            ? "اختبار على أسعار سابقة، وليس نصيحة استثمارية ولا توقعًا للأزمة القادمة."
            : "A backtest on past prices — not investment advice and not a forecast of the next crisis."}
        </p>
      </div>

      {!data || !s || !chart ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-[52vh] w-full rounded-xl" />
        </div>
      ) : (
        <>
          {/* headline: what 100,000 became */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border bg-card p-3">
              <p className="text-[11px] text-muted-foreground">
                {lang === "ar" ? `أصبحت ١٠٠,٠٠٠ جنيه بالقاعدة (أذون ${yieldPct}%)` : `100,000 EGP became — rule (T-bills ${yieldPct}%)`}
              </p>
              <p className="mt-0.5 text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{fmtK(s.finalRule)}</p>
              <p className="text-[10px] text-muted-foreground">+{s.cagrRule}% {lang === "ar" ? "سنويًا" : "/ yr"}</p>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <p className="text-[11px] text-muted-foreground">
                {lang === "ar" ? "بالاحتفاظ بالمؤشر" : "Holding the index"}
              </p>
              <p className="mt-0.5 text-xl font-bold tabular-nums">{fmtK(s.finalHold)}</p>
              <p className="text-[10px] text-muted-foreground">+{s.cagrHold}% {lang === "ar" ? "سنويًا" : "/ yr"}</p>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <p className="text-[11px] text-muted-foreground">{lang === "ar" ? "أسوأ تراجع على الطريق" : "Worst drawdown on the way"}</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums">
                <span className="text-emerald-600 dark:text-emerald-400">{s.worstDdRule}%</span>
                <span className="mx-1 text-muted-foreground">/</span>
                <span className="text-rose-600 dark:text-rose-400">{s.worstDdHold}%</span>
              </p>
              <p className="text-[10px] text-muted-foreground">
                {lang === "ar" ? "بالقاعدة / بالاحتفاظ" : "rule / holding"}
              </p>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <p className="text-[11px] text-muted-foreground">
                {lang === "ar" ? `الإنذارات خلال ${s.years} سنة` : `Warnings over ${s.years} years`}
              </p>
              <p className="mt-0.5 text-lg font-bold tabular-nums">
                {s.warnings}
                <span className="ms-2 text-sm font-normal text-muted-foreground">
                  {lang === "ar" ? `${s.falseWarnings} منها إنذارات كاذبة` : `${s.falseWarnings} of them false`}
                </span>
              </p>
              <p className="text-[10px] text-muted-foreground">{s.switches} {lang === "ar" ? "تحويلًا" : "switches"}</p>
            </div>
          </div>

          {/* latest reading */}
          <div className="rounded-xl border bg-card p-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <h2 className="text-sm font-bold">
                {lang === "ar" ? "أحدث قراءة للنموذج" : "Latest model reading"}
              </h2>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  data.last.warning
                    ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                    : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                }`}
              >
                {data.last.warning
                  ? lang === "ar"
                    ? "إنذار قائم"
                    : "warning active"
                  : lang === "ar"
                    ? "لا يوجد إنذار"
                    : "no warning"}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {lang === "ar" ? "لإغلاق" : "as of the close of"} {data.last.date} ·{" "}
                {lang === "ar" ? "الضغط الحالي" : "current stress"}: {data.last.volPct ?? "—"}%
                {lang === "ar" ? " (يعمل عند ٧٥٪ مع كسر المتوسط يومين)" : " (fires at 75% with the average broken two days)"}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className={`h-full rounded-full transition-all ${data.last.warning ? "bg-rose-500" : "bg-emerald-500"}`}
                style={{ width: `${Math.min(100, data.last.volPct ?? 0)}%` }}
              />
            </div>
          </div>

          {/* yield scenario input */}
          <div className="rounded-xl border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold">
                {lang === "ar" ? "عائد أذون الخزانة أثناء الإنذار (سيناريو)" : "T-bill yield while the warning stands (scenario)"}
              </span>
              <span className="tabular-nums text-sm font-bold">{yieldPct}%</span>
            </div>
            <input
              type="range"
              min={5}
              max={30}
              step={0.5}
              value={yieldPct}
              onChange={(e) => setYieldPct(Number(e.target.value))}
              className="mt-2 w-full accent-primary"
              aria-label={lang === "ar" ? "عائد الأذون" : "T-bill yield"}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {lang === "ar"
                ? "القيمة الافتراضية ١٥٪ قريبة من متوسط العقد — حرّكها لترى حساسية النتيجة لعائد جانب الأذون."
                : "The 15% default sits near the decade's average — move it to see how sensitive the outcome is to the T-bill leg."}
            </p>
          </div>

          {/* the wealth chart with warning bands */}
          <div className="overflow-hidden rounded-xl border bg-card p-2">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "min(52vh, 400px)" }}>
              {/* warning bands */}
              {chart.bands.map((b, i) => (
                <rect key={i} x={b.x0} y={30} width={Math.max(1, b.x1 - b.x0)} height={H - 72} fill="#f59e0b" opacity={0.12} />
              ))}
              {/* grid */}
              {[0, 0.25, 0.5, 0.75, 1].map((f) => {
                const v = chart.wMin + f * (chart.wMax - chart.wMin);
                const yy = chart.y(v);
                return (
                  <g key={f}>
                    <line x1={66} y1={yy} x2={W - 34} y2={yy} stroke="currentColor" opacity={0.08} />
                    <text x={60} y={yy + 3} fontSize="9" textAnchor="end" fill="currentColor" opacity={0.5}>
                      {fmtK(v)}
                    </text>
                  </g>
                );
              })}
              {/* the two wealth curves */}
              <path d={chart.lineRule} fill="none" stroke="#10b981" strokeWidth={2.2} />
              <path d={chart.lineHold} fill="none" stroke="currentColor" opacity={0.55} strokeWidth={1.6} strokeDasharray="5 3" />
              {/* date axis */}
              {[0, 0.25, 0.5, 0.75, 1].map((f) => {
                const i = Math.round(f * (chart.pts.length - 1));
                return (
                  <text key={`d${f}`} x={chart.x(i)} y={H - 20} fontSize="9" textAnchor="middle" fill="currentColor" opacity={0.5}>
                    {chart.pts[i]?.date.slice(0, 4)}
                  </text>
                );
              })}
              <text x={72} y={24} fontSize="10.5" fill="#10b981" className="font-bold">
                {lang === "ar" ? "القاعدة" : "the rule"} → {fmtK(s.finalRule)}
              </text>
              <text x={200} y={24} fontSize="10.5" fill="currentColor" opacity={0.6}>
                {lang === "ar" ? "الاحتفاظ بالمؤشر" : "holding the index"} → {fmtK(s.finalHold)}
              </text>
              <text x={W - 36} y={24} fontSize="9" textAnchor="end" fill="#f59e0b">
                {lang === "ar" ? "ٱلشرائط المظلّلة = الإنذار قائم" : "shaded bands = warning active"}
              </text>
            </svg>
          </div>

          {/* composite + method notes */}
          <div className="grid gap-2 lg:grid-cols-2">
            <div className="rounded-xl border bg-card/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
              <b className="text-foreground">{lang === "ar" ? "المؤشر المرجعي" : "The reference index"}</b>
              <p className="mt-1">{lang === "ar" ? data.compositeNote.ar : data.compositeNote.en}</p>
            </div>
            <div className="rounded-xl border bg-card/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
              <b className="text-foreground">{lang === "ar" ? "كيف تعمل القاعدة" : "How the rule works"}</b>
              <ol className="mt-1 space-y-1">
                {(lang === "ar"
                  ? [
                      "يعمل الإنذار عندما يغلق المؤشر تحت متوسط آخر ٢٠ جلسة ليومين متتاليين، بينما تقلّب ٢٠ جلسة أعلى من مربعه الخامس والسبعين في تاريخه.",
                      "تنتظر الأموال في أذون الخزانة وتحقق فائدتها المفترضة.",
                      "تعود إلى المؤشر بعد إغلاق فوق المتوسط — كل تحويل بعمولة ٠٫٢٪.",
                    ]
                  : [
                      "The warning fires when the composite closes below its 20-session average for two consecutive sessions while 20-session volatility sits above its own 75th percentile.",
                      "The money waits in treasury bills, earning the scenario yield.",
                      "It returns to the composite after a close back above the average — every switch pays 0.2% commission.",
                    ]
                ).map((step, i) => (
                  <li key={i}>
                    <b className="text-foreground">{i + 1}.</b> {step}
                  </li>
                ))}
              </ol>
              <p className="mt-1.5">
                {lang === "ar"
                  ? "قراءة من اختبار على أسعار سابقة، وليست إشارة للتصرّف."
                  : "A reading from a backtest on past prices — not a signal to act."}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
