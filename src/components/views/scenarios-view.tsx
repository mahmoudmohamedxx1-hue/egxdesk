"use client";

/** T60 — المزيد → مختبر النماذج (the model lab), cloned in STRUCTURE from
 *  the source model's scenarios screen — but running on OUR OWN published
 *  track record: the strategy ensemble this app actually serves, replayed
 *  honestly against the benchmark it claims to beat.
 *
 *  The cloned furniture:
 *   - a disclaimer gate you must acknowledge once per session;
 *   - "each model against the market": every strategy's cumulative return
 *     beside the benchmark's, with hit-rate and drawdown — winners AND
 *     losers printed, never a podium of only the good ones;
 *   - the replay windows: what the ensemble picked each window and what the
 *     market did over the same sessions;
 *   - the honesty notes: past performance validates the RULES, not the
 *     model's future judgment — and the whole lab is "not advice". */

import { useEffect, useState } from "react";
import { useApp } from "../market/app-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { FlaskConical, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

type Strategy = {
  id: string;
  nameAr: string;
  nameEn: string;
  family: string;
  backtested: boolean;
  stats: {
    trades: number;
    hitRate: number;
    avgNetPct: number;
    profitFactor: number;
    strategyCumPct: number;
    benchCumPct: number;
    maxDrawdownPct: number;
  };
};

type Window = { date: string; picks: string[]; netPct: number; benchPct: number };

type Data = {
  asOf: string;
  strategyRev: string;
  ensemble: { size: number; gate: string; description: string };
  method?: string;
  universe?: { tickers: number; description?: string };
  stats: {
    windows: number;
    trades: number;
    hitRate: number;
    avgNetPct: number;
    profitFactor: number;
    beatBenchRate: number;
    strategyCumPct: number;
    benchCumPct: number;
    maxDrawdownPct: number;
    avgExcessPct: number;
  };
  perStrategy: Strategy[];
  windows: Window[];
  notes: string[];
  curve: { date: string; strategy: number; benchmark: number }[];
};

export function ScenariosView() {
  const { lang, navigate } = useApp();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/strategy-lab")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("x"))))
      .then((d: Data) => setData(d))
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <div className="space-y-3 p-4">
        <h1 className="text-lg font-bold">{lang === "ar" ? "مختبر النماذج" : "Model lab"}</h1>
        <p className="text-sm text-muted-foreground">{lang === "ar" ? "تعذّر التحميل." : "Unavailable."}</p>
      </div>
    );
  }

  const worse = (data?.perStrategy ?? []).filter((s) => s.stats && s.stats.strategyCumPct != null && s.stats.strategyCumPct < s.stats.benchCumPct).length;

  // ── the disclaimer gate ──────────────────────────────────────────────────
  if (!accepted) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-primary" aria-hidden />
          <h1 className="text-lg font-bold">
            {lang === "ar" ? "مختبر النماذج" : "Model lab"}
            <span className="ms-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              {lang === "ar" ? "تجريبي · اقرأ هذا" : "experimental · read this"}
            </span>
          </h1>
        </div>
        <div className="rounded-xl border bg-card p-4 text-sm leading-relaxed">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
            {lang === "ar" ? "هذه قراءة سجل، وليست نصيحة" : "This is a record, not advice"}
          </div>
          <p className="text-muted-foreground">
            {lang === "ar"
              ? "نشغّل مجموعة نماذج ونشرات على بيانات البورصة المصرية العامة وننشر ما حققته في اختبار تاريخي — حتى حين تخفق. السجل المنشور يغطي نوافذ إعادة تشغيل محدودة بعيّنات مختلفة، والاختبار التاريخي ليس أداء استثمار فعليًا، ولا يضمن أداء المستقبل."
              : "We run an ensemble of strategy models on public EGX data and publish what they achieved in a historical replay — including when they fail. The published record covers bounded replay windows with varying samples; a backtest is not actual investment performance and guarantees nothing about the future."}
          </p>
          {data && (
            <p className="mt-2 rounded-lg bg-secondary/60 p-2 text-xs text-muted-foreground">
              {lang === "ar"
                ? `${worse} من ${data.perStrategy.length} استراتيجية مُقيَّمة أنهت الاختبار أقل من السوق المقارن. راجع العيّنة والخسائر، لا المتوسط فقط.`
                : `${worse} of ${data.perStrategy.length} evaluated strategies finished BELOW the comparison market. Review the sample and the losses, not just the average.`}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {lang === "ar"
              ? "أي قرار تتخذه بناءً على هذا قرارك وعلى مسؤوليتك."
              : "Any decision you make on this is yours and your responsibility."}
          </p>
        </div>
        <div className="flex justify-center gap-2">
          <Button onClick={() => setAccepted(true)}>
            {lang === "ar" ? "فهمت — اعرض النماذج" : "Understood — show the models"}
          </Button>
          <Button variant="outline" onClick={() => navigate("home")}>
            {lang === "ar" ? "عُد بي" : "Take me back"}
          </Button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const s = data.stats;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-5 w-5 text-primary" aria-hidden />
        <h1 className="text-lg font-bold">{lang === "ar" ? "مختبر النماذج" : "Model lab"}</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        {lang === "ar"
          ? `سجل محفوظ · ${s.windows} نافذة إعادة تشغيل · ${s.trades} صفقة مقيَّمة · مراجعة ${data.strategyRev}`
          : `Saved record · ${s.windows} replay windows · ${s.trades} evaluated trades · rev ${data.strategyRev}`}
      </p>

      {/* headline stats — the honest ones */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            [lang === "ar" ? "نسبة الإصابة" : "Hit rate", `${(s.hitRate * 100).toFixed(0)}%`],
            [lang === "ar" ? "صافٍ لكل صفقة" : "Avg net / trade", `${s.avgNetPct >= 0 ? "+" : ""}${s.avgNetPct.toFixed(2)}%`],
            [lang === "ar" ? "تراكمي مقابل السوق" : "Cumulative vs market", `${s.strategyCumPct.toFixed(0)}% / ${s.benchCumPct.toFixed(0)}%`],
            [lang === "ar" ? "أسوأ تراجع" : "Worst drawdown", `${s.maxDrawdownPct.toFixed(1)}%`],
          ] as [string, string][]
        ).map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-card p-2.5">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {/* each model against the market */}
      <div className="rounded-xl border bg-card p-3">
        <h2 className="text-sm font-bold">
          {lang === "ar" ? "كل نموذج مقابل السوق" : "Every model against the market"}
        </h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {lang === "ar"
            ? "عمود لكل استراتيجية لها سجل: القيمة الممتلئة ما حققته، والمفرغة السوق خلال النوافذ نفسها."
            : "A row per strategy with a record: the filled value is what it returned, the reference is the market over the same windows."}
        </p>
        <div className="mt-2 space-y-1.5">
          {data.perStrategy
            .filter((st) => st.stats && st.stats.strategyCumPct != null)
            .map((st) => {
            const open = expanded === st.id;
            const beat = st.stats.strategyCumPct >= st.stats.benchCumPct;
            return (
              <div key={st.id}>
                <button
                  onClick={() => setExpanded(open ? null : st.id)}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 text-xs hover:bg-accent/40"
                >
                  <span className="w-36 shrink-0 truncate text-start font-semibold">{lang === "ar" ? st.nameAr : st.nameEn}</span>
                  <span className={`w-20 shrink-0 rounded px-1.5 py-0.5 text-center font-bold tabular-nums ${beat ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/12 text-rose-700 dark:text-rose-300"}`}>
                    {st.stats.strategyCumPct >= 0 ? "+" : ""}
                    {st.stats.strategyCumPct.toFixed(0)}%
                  </span>
                  <span className="w-20 shrink-0 text-center tabular-nums text-muted-foreground">
                    {lang === "ar" ? "السوق" : "market"} {st.stats.benchCumPct >= 0 ? "+" : ""}
                    {st.stats.benchCumPct.toFixed(0)}%
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {st.stats.trades} {lang === "ar" ? "صفقة" : "trades"} ·{" "}
                    {(st.stats.hitRate * 100).toFixed(0)}% {lang === "ar" ? "إصابة" : "hit"}
                  </span>
                  <span className="ms-auto shrink-0 text-muted-foreground">
                    {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
                  </span>
                </button>
                {open && (
                  <div className="mx-2 mb-1.5 grid grid-cols-2 gap-2 rounded-lg bg-secondary/50 p-2.5 text-[11px] sm:grid-cols-4">
                    {(
                      [
                        [lang === "ar" ? "عامل الربح" : "Profit factor", st.stats.profitFactor.toFixed(2)],
                        [lang === "ar" ? "صافٍ/صفقة" : "Avg net", `${st.stats.avgNetPct >= 0 ? "+" : ""}${st.stats.avgNetPct.toFixed(2)}%`],
                        [lang === "ar" ? "أسوأ تراجع" : "Worst DD", `${st.stats.maxDrawdownPct.toFixed(1)}%`],
                        [lang === "ar" ? "العائلة" : "Family", st.family],
                      ] as [string, string][]
                    ).map(([k, v]) => (
                      <div key={k}>
                        <span className="block text-muted-foreground">{k}</span>
                        <b className="tabular-nums">{v}</b>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* replay windows */}
      <div className="rounded-xl border bg-card p-3">
        <h2 className="text-sm font-bold">{lang === "ar" ? "نوافذ إعادة التشغيل" : "Replay windows"}</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {lang === "ar"
            ? "ما اختاره النظام في كل نافذة، وما فعله السوق في الجلسات نفسها — الصفحات الفارغة نوافذ بلا إشارة (لا التزام باختيار شيء)."
            : "What the system picked each window, and what the market did over the same sessions — empty rows are no-signal windows (no obligation to pick something)."}
        </p>
        <div className="mt-2 max-h-80 space-y-1 overflow-y-auto pe-1">
          {data.windows.map((w) => (
            <div key={w.date} className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-accent/40">
              <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{w.date}</span>
              <span className="min-w-0 flex-1">
                {w.picks.length === 0 ? (
                  <span className="text-muted-foreground/60">{lang === "ar" ? "— بلا إشارة" : "— no signal"}</span>
                ) : (
                  w.picks.map((p) => (
                    <button
                      key={p}
                      onClick={() => navigate("company", { ticker: p })}
                      className="me-1 rounded-full border border-ring/40 bg-secondary/60 px-1.5 py-0.5 text-[10px] font-bold hover:bg-accent"
                    >
                      {p}
                    </button>
                  ))
                )}
              </span>
              <span className={`w-16 shrink-0 text-end tabular-nums font-semibold ${w.netPct >= w.benchPct ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                {w.netPct >= 0 ? "+" : ""}
                {w.netPct.toFixed(2)}%
              </span>
              <span className="w-16 shrink-0 text-end tabular-nums text-muted-foreground">
                {w.benchPct >= 0 ? "+" : ""}
                {w.benchPct.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* honesty notes */}
      <div className="rounded-xl border bg-card/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
        {data.notes.map((n, i) => (
          <p key={i} className="mt-1 first:mt-0">
            · {lang === "ar" ? (n.includes("NOT a guarantee") ? "الأداء السابق ليس ضمانًا — الاختبار يتحقق من القواعد على التاريخ، ولا يستطيع التحقق من حكم النموذج في المستقبل." : n) : n}
          </p>
        ))}
      </div>
    </div>
  );
}
