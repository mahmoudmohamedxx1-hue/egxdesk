"use client";

import { useEffect, useMemo, useState } from "react";
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
import { BadgeCheck, FlaskConical, ArrowLeft, Search, Radar, ExternalLink } from "lucide-react";

/** T26 → T65 — the Strategy Lab. T26 published the walk-forward backtest
 *  and charter (kept whole below — stats, equity curve, window log, notes).
 *
 *  T65 adds the WORKBENCH the reader could actually use (the same rework
 *  the Model Lab got): pick any listed stock and the whole 18-strategy
 *  ensemble runs on IT, live — every strategy's verdict NOW (long / avoid
 *  / silent this session), each beside its own published track record, so
 *  "what does this strategy say about MY stock today" reads next to "what
 *  this strategy actually did over the replay". The consensus gauge, the
 *  stock's context (composite rating, RSI, 52w position, ML forecast,
 *  insider filings) and every evidence code ship with it — the same
 *  deterministic engine the backtest replays, no lookahead, no advice. */

/* ── the live workbench types (mirrors /api/strategy-lab/live) ── */

type LiveStrategy = {
  id: string;
  nameAr: string;
  nameEn: string;
  family: string;
  familyAr: string;
  weight: number;
  oneLineAr: string;
  oneLineEn: string;
  live: { fired: boolean; direction: "long" | "avoid" | null; score: number; evidence: string[] } | null;
  record: { backtested: boolean; cumPct: number | null; benchCumPct: number | null; trades: number | null; hitRate: number | null } | null;
};

type LiveData = {
  asOf: string;
  ticker: string;
  name: string;
  nameAr: string;
  close: number;
  changePct: number;
  composite: number;
  compositeRating: string;
  rsi: number | null;
  pos52: number | null;
  ml: { probUp: number; hitRate: number | null; trainedRows: number; valRows: number } | null;
  insider: { buys: number; sells: number; treasuryBuys: number; treasurySells: number; lastDate: string | null } | null;
  ensemble: { consensus: number; longVotes: number; avoidVotes: number; applicable: number; agreement: number; fired: string[] };
  strategies: LiveStrategy[];
  error?: string;
};

type PickRow = { ticker: string; nameAr: string; nameEn: string };

/* the record types (unchanged) */

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

const consensusColor = (c: number) => (c >= 0.25 ? "#059669" : c <= -0.25 ? "#e11d48" : "#94a3b8");

export function StrategyLabView({ ticker: urlTicker }: { ticker?: string }) {
  const { lang, navigate } = useApp();
  const ar = lang === "ar";

  /* ── the workbench state ── */
  const [picked, setPicked] = useState<string | null>(() => {
    if (urlTicker) return urlTicker;
    if (typeof window !== "undefined") {
      try {
        return window.localStorage.getItem("sl-ticker");
      } catch {
        /* private mode */
      }
    }
    return null;
  });
  const [q, setQ] = useState("");
  const [live, setLive] = useState<LiveData | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  // the picker's type-ahead — the app's own live search route (bilingual,
  // ticker or name, with fresh closes); empty query = no dropdown
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 1) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(needle)}`, { signal: ctrl.signal, cache: "no-store" });
        const json = (await res.json()) as { results?: PickRow[] };
        setMatches((json.results ?? []).slice(0, 8));
      } catch {
        /* aborted or offline — dropdown just stays empty */
      }
    }, 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);
  const [matches, setMatches] = useState<PickRow[]>([]);

  // the live run — every time the picked ticker changes
  useEffect(() => {
    if (!picked) {
      setLive(null);
      setLiveError(null);
      return;
    }
    let cancelled = false;
    setLiveLoading(true);
    setLiveError(null);
    (async () => {
      try {
        const res = await fetch(`/api/strategy-lab/live?ticker=${encodeURIComponent(picked)}`, { cache: "no-store" });
        const json = (await res.json()) as LiveData;
        if (!res.ok || json.error) throw new Error(json.error ?? `live ${res.status}`);
        if (!cancelled) setLive(json);
      } catch (e) {
        if (!cancelled) {
          setLive(null);
          setLiveError(e instanceof Error ? e.message : "live read unavailable");
        }
      } finally {
        if (!cancelled) setLiveLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [picked]);

  const pickTicker = (t: string) => {
    setPicked(t);
    setQ("");
    setMatches([]);
    try {
      window.localStorage.setItem("sl-ticker", t);
    } catch {
      /* private mode */
    }
  };

  // fired strategies first, then the quiet ones — by strength inside each
  const ordered = useMemo(() => {
    if (!live) return [];
    return [...live.strategies].sort((a, b) => {
      const fa = a.live?.fired ? 1 : 0;
      const fb = b.live?.fired ? 1 : 0;
      if (fa !== fb) return fb - fa;
      const sa = a.live?.score ?? 0;
      const sb = b.live?.score ?? 0;
      return sb - sa;
    });
  }, [live]);

  /* ── the record state (unchanged T26 record) ── */
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
      {/* ══ THE WORKBENCH — apply the ensemble to a stock you pick ══ */}
      <section className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            {tt(T.labTitle, lang)}
          </h1>
          <span className="num text-[11px] text-muted-foreground">
            {tt(T.labAsOf, lang)}: {data.asOf.slice(0, 10)} · {data.strategyRev}
          </span>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">{tt(T.labIntro, lang)}</p>

        {/* the picker */}
        <div className="relative mt-4 max-w-md">
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={ar ? "اختر سهمًا لتشغيل الاستراتيجيات الثماني عشرة عليه…" : "pick a stock to run the 18 strategies on…"}
              className="h-9 w-full rounded-lg border bg-background ps-8 pe-3 text-sm outline-none focus:ring-1 focus:ring-ring"
              aria-label={ar ? "اختر سهمًا" : "pick a stock"}
            />
          </div>
          {q && (
            <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-popover shadow-lg">
              {matches.map((m) => (
                <button
                  key={m.ticker}
                  onClick={() => pickTicker(m.ticker)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-start text-xs hover:bg-accent"
                >
                  <b className="w-12 shrink-0">{m.ticker}</b>
                  <span className="min-w-0 flex-1 truncate">{ar ? m.nameAr : m.nameEn}</span>
                </button>
              ))}
              {!matches.length && <p className="px-2.5 py-2 text-xs text-muted-foreground">{ar ? "لا نتائج" : "no matches"}</p>}
            </div>
          )}
        </div>

        {/* the live readout */}
        {liveLoading && (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
            <p className="text-[11px] text-muted-foreground">{ar ? "تشغيل الاستراتيجيات على شموع السهم الحية…" : "running the strategies on the stock's live tape…"}</p>
          </div>
        )}
        {liveError && !liveLoading && (
          <p className="mt-4 rounded-lg border border-dashed bg-background/60 px-3 py-3 text-sm text-muted-foreground">
            {ar ? `تعذّر تشغيل الاستراتيجيات على ${picked ?? ""} — ` : `could not run the strategies on ${picked ?? ""} — `}
            {liveError}
          </p>
        )}
        {!picked && !liveLoading && (
          <p className="mt-4 rounded-lg border border-dashed bg-background/60 px-3 py-4 text-center text-sm text-muted-foreground">
            {ar
              ? "هذا هو الجزء العملي: اختر أي سهم أعلاه وستقرأ الاستراتيجيات الثماني عشرة شريطه الحالي فورًا — كل واحدة بحكمها الآن وبجانبه سجلها المنشور."
              : "This is the usable part: pick any stock above and the eighteen strategies read its live tape instantly — each with its verdict NOW beside its published record."}
          </p>
        )}

        {live && !liveLoading && (
          <div className="mt-4 space-y-3">
            {/* consensus header */}
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-secondary/40 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <b className="text-lg font-bold">{live.ticker}</b>
                  <button onClick={() => navigate("company", { ticker: live.ticker })} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                    {ar ? "صفحة الشركة" : "company page"} <ExternalLink className="h-3 w-3" aria-hidden />
                  </button>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {ar ? live.nameAr : live.name} · {live.close.toFixed(2)} EGP ({fmtPct(live.changePct)})
                </p>
              </div>
              <div className="ms-auto flex items-center gap-4">
                <div className="text-end">
                  <p className="text-[10px] text-muted-foreground">{ar ? "إجماع الاستراتيجيات" : "strategy consensus"}</p>
                  <p className="text-2xl font-bold tabular-nums" style={{ color: consensusColor(live.ensemble.consensus) }}>
                    {live.ensemble.consensus >= 0 ? "+" : ""}
                    {live.ensemble.consensus.toFixed(2)}
                  </p>
                </div>
                <div className="w-40">
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary" dir="ltr" aria-hidden>
                    {/* −1..+1 mapped onto the bar; mid marker at 50% */}
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, Math.max(4, ((live.ensemble.consensus + 1) / 2) * 100))}%`,
                        backgroundColor: consensusColor(live.ensemble.consensus),
                        opacity: 0.8,
                      }}
                    />
                  </div>
                  <p className="num mt-0.5 text-[10px] text-muted-foreground text-center">
                    {live.ensemble.longVotes} {ar ? "شراء" : "long"} · {live.ensemble.avoidVotes} {ar ? "تجنّب" : "avoid"} ·{" "}
                    {live.ensemble.applicable}/{live.strategies.length} {ar ? "قابلة للتطبيق" : "applicable"}
                  </p>
                </div>
              </div>
            </div>

            {/* context chips */}
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <span className="num rounded-md border bg-card px-2 py-0.5">
                {ar ? "التقييم المركّب" : "composite"} <b>{(live.composite * 100).toFixed(0)}</b> ({live.compositeRating})
              </span>
              {live.rsi != null && (
                <span className="num rounded-md border bg-card px-2 py-0.5">
                  RSI <b>{live.rsi.toFixed(0)}</b>
                </span>
              )}
              {live.pos52 != null && (
                <span className="num rounded-md border bg-card px-2 py-0.5">
                  52w <b>{live.pos52.toFixed(0)}%</b>
                </span>
              )}
              {live.ml && (
                <span className="num rounded-md border bg-card px-2 py-0.5" title={ar ? "نموذج لوجستي مدرّب على شموع السهم نفسه" : "logistic model trained on this stock's own candles"}>
                  {ar ? "توقع ML" : "ML"} <b>{(live.ml.probUp * 100).toFixed(0)}%</b>
                  {live.ml.hitRate != null ? ` (${(live.ml.hitRate * 100).toFixed(0)}%)` : ""}
                </span>
              )}
              {live.insider && (live.insider.buys > 0 || live.insider.sells > 0) && (
                <span className="num rounded-md border bg-card px-2 py-0.5" title={ar ? "إفصاحات رسمية خلال ٩٠ يومًا" : "official EGX filings, last 90 days"}>
                  {ar ? "إفصاحات المطلعين" : "insider filings"}{" "}
                  <b className={live.insider.buys > live.insider.sells ? "text-up" : "text-down"}>
                    {live.insider.buys}↑ / {live.insider.sells}↓
                  </b>
                </span>
              )}
              <span className="num rounded-md border bg-card px-2 py-0.5 text-muted-foreground">
                {ar ? "آخر شمعة" : "last candle"} {live.asOf}
              </span>
            </div>

            {/* the 18 strategies — live verdict beside the record */}
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm min-w-[680px]">
                <thead className="border-b">
                  <tr className="text-[11px] text-muted-foreground">
                    <th className="text-start font-medium px-2 py-2">{ar ? "الاستراتيجية" : "Strategy"}</th>
                    <th className="text-start font-medium px-2 py-2">{ar ? "قاعدتها" : "Its rule"}</th>
                    <th className="text-center font-medium px-2 py-2">{ar ? "حكمها الآن" : "Verdict now"}</th>
                    <th className="text-end font-medium px-2 py-2">{ar ? "سجلها المنشور" : "Published record"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {ordered.map((st) => {
                    const fired = st.live?.fired === true;
                    const dir = st.live?.direction ?? null;
                    return (
                      <tr key={st.id} className={`transition-colors ${fired ? "bg-accent/25" : ""}`}>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <b className="text-xs">{ar ? st.nameAr : st.nameEn}</b>
                            <span className="rounded-sm bg-secondary/60 px-1 py-0.5 text-[9px] text-muted-foreground">{ar ? st.familyAr : st.family}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2 max-w-[260px]">
                          <p className="text-[11px] leading-snug text-muted-foreground">{ar ? st.oneLineAr : st.oneLineEn}</p>
                          {fired && st.live && st.live.evidence.length > 0 && (
                            <p className="num mt-0.5 text-[9px] text-muted-foreground/70" dir="ltr">
                              {st.live.evidence.slice(0, 4).join(" · ")}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-2 text-center whitespace-nowrap">
                          {!st.live ? (
                            <span className="text-[10px] text-muted-foreground">{ar ? "لا بيانات" : "no data"}</span>
                          ) : fired && dir === "long" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-up/15 px-2 py-0.5 text-[11px] font-bold text-up">
                              ▲ {ar ? "شراء الآن" : "long now"}
                              <span className="num font-normal opacity-70">{(st.live.score * 100).toFixed(0)}%</span>
                            </span>
                          ) : fired && dir === "avoid" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-down/15 px-2 py-0.5 text-[11px] font-bold text-down">
                              ▼ {ar ? "تجنّب الآن" : "avoid now"}
                              <span className="num font-normal opacity-70">{(st.live.score * 100).toFixed(0)}%</span>
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">{ar ? "صامتة هذا الأسبوع" : "silent this session"}</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-end whitespace-nowrap">
                          {!st.record?.backtested ? (
                            <span className="text-[10px] text-muted-foreground">{ar ? "حية فقط — بلا سجل" : "live-only — no replay"}</span>
                          ) : (
                            <span className="num text-[11px]">
                              <b className={directionClass(st.record.cumPct ?? 0)}>{fmtNum(st.record.cumPct ?? 0, 1)}%</b>
                              <span className="text-muted-foreground">
                                {" "}
                                · {st.record.trades ?? 0} {ar ? "صفقة" : "trades"}
                                {st.record.hitRate != null ? ` · ${(st.record.hitRate * 100).toFixed(0)}%` : ""}
                              </span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {ar
                ? "كل حكم محسوب آليًا من شموع آخر جلسة وبيانات الماسح الحية بنفس المحرك الحتمي الذي يعيد اختبار المشي-للأمام — بلا اطلاع مسبق، وبلا توصية. الأسطر المضاءة هي التي اشتعلت شرطها الآن؛ الصامتة لم يتحقق شرطها هذا الأسبوع (وهذا جزء من قواعدها لا نقص في البيانات)."
                : "Every verdict is machine-computed from the last session's candles and live scanner fields by the same deterministic engine the walk-forward backtest replays — no lookahead, no advice. Highlighted rows fired their rule NOW; silent rows simply did not meet their trigger this session (that is their rule working, not missing data)."}
            </p>
          </div>
        )}
      </section>

      {/* ══ THE RECORD — the published backtest evidence (T26, kept whole) ══ */}
      <section className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Radar className="h-4 w-4 text-primary" />
            {ar ? "السجل المنشور — الدليل القابل للتدقيق" : "The published record — auditable evidence"}
          </h2>
        </div>

        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md bg-secondary/40 p-3">
            <p className="text-[11px] font-semibold text-foreground/80 mb-1">{tt(T.labCharter, lang)}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {ar ? (METHOD_AR[data.strategyRev] ?? data.method) : data.method}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(data.params).map(([k, v]) => (
                <span key={k} className="num rounded-sm bg-card border px-1.5 py-0.5 text-[10px]">
                  {ar && PARAM_AR[k] ? PARAM_AR[k] : k}: {v}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-md bg-secondary/40 p-3">
            <p className="text-[11px] font-semibold text-foreground/80 mb-1">{tt(T.labUniverse, lang)}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {ar ? UNIVERSE_AR : data.universe.selection}
            </p>
            <p className="num text-[10px] text-muted-foreground mt-1">
              {data.universe.size} {ar ? "اسماً" : "names"}
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
                              onClick={() => pickTicker(p)}
                              className="num rounded-sm border bg-secondary/50 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-accent transition-colors"
                              title={ar ? "شغّل الاستراتيجيات على هذا السهم" : "run the strategies on this stock"}
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
              <span>{ar ? noteAr(n) : n}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[10px] text-muted-foreground leading-relaxed">{tt(T.priceChartNote, lang)}</p>
      </section>
    </div>
  );
}
