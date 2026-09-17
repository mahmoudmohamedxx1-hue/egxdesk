"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { useApp } from "../market/app-context";
import { T, tt } from "@/lib/i18n";
import { fmtNum, fmtPct, directionClass } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { BadgeCheck, FlaskConical, ArrowLeft } from "lucide-react";

/** T26 — the PUBLIC Strategy Lab: exposes the walk-forward backtest and
 *  charter as a first-class view — methodology, params, full-run stats, the
 *  compounded equity curve vs the equal-weight benchmark, and the complete
 *  per-window log (every pick + net result + excess). This is the cheapest
 *  trust differentiator we own: we publish what others only claim. */

type LabWindow = { date: string; picks: string[]; netPct: number; benchPct: number };
type LabStats = {
  windows: number;
  trades: number;
  hitRate: number;
  profitFactor: number | null;
  avgNetPct: number;
  avgExcessPct: number;
  strategyCumPct: number;
  benchCumPct: number;
  maxDrawdownPct: number;
  beatBenchRate: number;
};

type LabData = {
  asOf: string;
  strategyRev: string;
  method: string;
  params: Record<string, number>;
  universe: { size: number; selection: string };
  stats: LabStats;
  windows: LabWindow[];
  notes: string[];
  curve: { date: string; strategy: number; benchmark: number }[];
  curveMaxDD: number;
  error?: string;
};

/* T39 — the charter/universe strings live in backtest.json in English
 * (machine-readable canonical form); the view renders them in the reader's
 * language, keyed by strategyRev with an honest fallback to the original. */
const METHOD_AR: Record<string, string> = {
  "egx-trend-v1":
    "اختبار مشي-للأمام بلا أي اطلاع مسبق: كل ١٠ جلسات يُرتَّب السوق بالدالة الحية نفسها على شموع حتى ذلك التاريخ فقط؛ الشراء لأعلى ٥ أسهم بدرجة ≥ 0.5؛ الاحتفاظ ١٠ جلسات؛ التكاليف 0.35٪ لكل صفقة ذهاباً وإياباً؛ المرجع = السوق بترجيح متساوٍ.",
};
const UNIVERSE_AR =
  "أكثر ٤٠ سهماً تداولاً في البورصة المصرية اليوم ولديها تاريخ يومي لثلاث سنوات.";
const PARAM_AR: Record<string, string> = {
  warmupSessions: "جلسات الإحماء",
  holdSessions: "جلسات الاحتفاظ",
  topN: "عدد الأسهم",
  scoreMin: "الحد الأدنى للدرجة",
  costPctRoundTrip: "التكاليف٪ ذهاباً وإياباً",
};

/* T41 — the disclaimer notes live in backtest.json in English (generator
 * output); the Arabic view translates them by stable prefix so the Arabic
 * reader gets the full honesty small-print, not Latin soup. The suspect
 * count inside note 2 is extracted from the English text and interpolated;
 * anything unrecognized falls back to the original English line. */
const NOTE_AR: [RegExp, (en: string) => string][] = [
  [
    /^Past performance is NOT a guarantee/,
    () => "الأداء السابق ليس ضماناً للمستقبل — الاختبار التاريخي يتحقق من القواعد على التاريخ فقط، ولا يمكنه التحقق من حكم النموذج اللغوي مستقبلاً.",
  ],
  [
    /^Trades with \|gross return\|/,
    (en) => {
      const m = /(\d+) found/.exec(en);
      const n = m ? m[1] : "0";
      return `الصفقات التي يتجاوز عائدها الإجمالي 45٪ في احتفاظ لعشر جلسات (${n} صفقة) مستبعدة كأثر محتمل لعمولات اكتتاب أو تجزئة أسهم.`;
    },
  ],
  [
    /^Universe is today's most-traded/,
    () => "عينة الاختبار هي الأكثر تداولاً اليوم — قد يوجد انحياز بقاء/اختيار طفيف.",
  ],
  [
    /^Quotes are ~15-min delayed/,
    () => "الأسعار شموع يومية مؤجلة نحو ١٥ دقيقة؛ التنفيذ عند أقرب إغلاق متاح، دون نمذجة وقف داخل الجلسة (قواطع الدائرة تجعل تنفيذ الوقف غير مضمون).",
  ],
];
export function noteAr(en: string): string {
  for (const [re, fn] of NOTE_AR) if (re.test(en)) return fn(en);
  return en; // honest fallback: unknown generator line stays in English
}

export function StrategyLabView() {
  const { lang, navigate } = useApp();
  const [data, setData] = useState<LabData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/strategy-lab", { cache: "no-store" });
        const json = (await res.json()) as LabData;
        if (!res.ok || json.error) throw new Error(json.error ?? `lab ${res.status}`);
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "lab unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {tt(T.errorLoad, lang)} {error ? `— ${error}` : ""}
      </p>
    );
  }

  const s = data.stats;

  return (
    <div className="space-y-5">
      {/* header + charter */}
      <section className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            {tt(T.labTitle, lang)}
          </h1>
          <span className="num text-[11px] text-muted-foreground">
            {tt(T.labAsOf, lang)}: {data.asOf.slice(0, 10)} · {data.strategyRev}
          </span>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">{tt(T.labIntro, lang)}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md bg-secondary/40 p-3">
            <p className="text-[11px] font-semibold text-foreground/80 mb-1">{tt(T.labCharter, lang)}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {lang === "ar" ? (METHOD_AR[data.strategyRev] ?? data.method) : data.method}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(data.params).map(([k, v]) => (
                <span key={k} className="num rounded-sm bg-card border px-1.5 py-0.5 text-[10px]">
                  {lang === "ar" && PARAM_AR[k] ? PARAM_AR[k] : k}: {v}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-md bg-secondary/40 p-3">
            <p className="text-[11px] font-semibold text-foreground/80 mb-1">{tt(T.labUniverse, lang)}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {lang === "ar" ? UNIVERSE_AR : data.universe.selection}
            </p>
            <p className="num text-[10px] text-muted-foreground mt-1">
              {data.universe.size} {lang === "ar" ? "اسماً" : "names"}
            </p>
          </div>
        </div>

        <button
          onClick={() => navigate("signals")}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent/50 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" />
          {tt(T.labOpenSignals, lang)}
        </button>
      </section>

      {/* full-run stats */}
      <section className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-lg font-bold">{tt(T.labStats, lang)}</h2>
          <span className="num text-[11px] text-muted-foreground">
            {s.windows} {tt(T.labWindowsCount, lang)} · {s.trades} {tt(T.labTrades, lang)}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {(
            [
              [T.labHitRate, s.hitRate != null ? `${(s.hitRate * 100).toFixed(1)}%` : "—", null],
              [T.labProfitFactor, s.profitFactor != null ? fmtNum(s.profitFactor, 2) : "—", null],
              [T.labAvgNet, `${fmtNum(s.avgNetPct, 2)}%`, null],
              [T.labCum, `${fmtNum(s.strategyCumPct, 1)}%`, "up"],
              [T.labBenchCum, `${fmtNum(s.benchCumPct, 1)}%`, null],
              [T.labMaxDd, `${fmtNum(s.maxDrawdownPct, 1)}%`, "down"],
              [T.labExcess, `${fmtNum(s.avgExcessPct, 2)}%`, s.avgExcessPct >= 0 ? "up" : "down"],
              [T.labBench, s.beatBenchRate != null ? `${(s.beatBenchRate * 100).toFixed(1)}%` : "—", null],
            ] as [typeof T.labHitRate, string, string | null][]
          ).map(([key, value, tone]) => (
            <div key={key.en} className="rounded-md bg-secondary/40 p-2.5">
              <p className="text-[10px] text-muted-foreground leading-tight">{tt(key, lang)}</p>
              <p
                className={`num text-base font-bold ${
                  tone === "up" ? "text-up" : tone === "down" ? "text-down" : ""
                }`}
              >
                {value}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* equity curve */}
      <section className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
          <h2 className="text-lg font-bold">{tt(T.labEquity, lang)}</h2>
          <span className="num text-[11px] text-muted-foreground">
            {data.curve[0]?.date} → {data.curve[data.curve.length - 1]?.date}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">{tt(T.labEquityNote, lang)}</p>
        <div className="h-72" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.curve} margin={{ top: 8, right: 12, bottom: 0, left: -6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                minTickGap={48}
                tickFormatter={(d: string) => d.slice(2)}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={56}
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => `${fmtNum(v, 0)}%`}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "var(--popover-foreground)",
                }}
                labelStyle={{ color: "var(--muted-foreground)" }}
                formatter={(value: number, key: string) => [
                  `${fmtNum(value, 1)}%`,
                  key === "strategy" ? tt(T.labStrategy, lang) : tt(T.labBenchmark, lang),
                ]}
              />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
              <Line
                type="monotone"
                dataKey="benchmark"
                stroke="var(--c4)"
                strokeWidth={1.8}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="strategy"
                stroke="var(--c3)"
                strokeWidth={2.2}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground" dir="ltr">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-4 rounded-full" style={{ background: "var(--c3)" }} aria-hidden />
            {tt(T.labStrategy, lang)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-4 rounded-full" style={{ background: "var(--c4)" }} aria-hidden />
            {tt(T.labBenchmark, lang)}
          </span>
        </div>
      </section>

      {/* window log */}
      <section className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
          <h2 className="text-lg font-bold">{tt(T.labWindows, lang)}</h2>
          <span className="num text-[11px] text-muted-foreground">
            {data.windows.length} {tt(T.labWindowsCount, lang)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">{tt(T.labWindowsNote, lang)}</p>
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="border-b">
              <tr className="text-[11px] text-muted-foreground">
                <th className="text-start font-medium px-3 py-2">{tt(T.labDate, lang)}</th>
                <th className="text-start font-medium px-3 py-2">{tt(T.labPicks, lang)}</th>
                <th className="text-end font-medium px-3 py-2">{tt(T.labNet, lang)}</th>
                <th className="text-end font-medium px-3 py-2">{tt(T.labBench, lang)}</th>
                <th className="text-end font-medium px-3 py-2">{tt(T.labExcess, lang)}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[...data.windows].reverse().map((w) => {
                const excess = w.netPct - w.benchPct;
                return (
                  <tr key={w.date} className="hover:bg-accent/30 transition-colors">
                    <td className="num px-3 py-2 whitespace-nowrap">{w.date}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {w.picks.length ? (
                          w.picks.map((p) => (
                            <button
                              key={p}
                              onClick={() => navigate("company", { ticker: p })}
                              className="num rounded-sm border bg-secondary/50 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-accent transition-colors"
                            >
                              {p}
                            </button>
                          ))
                        ) : (
                          <span className="text-[10px] text-muted-foreground">{tt(T.labNoPicks, lang)}</span>
                        )}
                      </div>
                    </td>
                    <td className={`num px-3 py-2 text-end font-medium ${directionClass(w.netPct)}`}>
                      {fmtPct(w.netPct)}
                    </td>
                    <td className={`num px-3 py-2 text-end ${directionClass(w.benchPct)}`}>{fmtPct(w.benchPct)}</td>
                    <td className={`num px-3 py-2 text-end font-semibold ${directionClass(excess)}`}>
                      {excess >= 0 ? "+" : ""}
                      {fmtNum(excess, 2)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* model limits */}
      <section className="rounded-lg border bg-card p-4 sm:p-5">
        <h2 className="text-lg font-bold flex items-center gap-2 mb-3">
          <BadgeCheck className="h-4 w-4 text-primary" />
          {tt(T.labNotesTitle, lang)}
        </h2>
        <ul className="space-y-2">
          {data.notes.map((n, i) => (
            <li key={i} className="text-xs text-muted-foreground leading-relaxed flex gap-2">
              <span className="num text-primary font-semibold">{i + 1}.</span>
              <span>{lang === "ar" ? noteAr(n) : n}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[10px] text-muted-foreground leading-relaxed">{tt(T.priceChartNote, lang)}</p>
      </section>
    </div>
  );
}
