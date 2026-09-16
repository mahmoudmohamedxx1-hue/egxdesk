"use client";

/** GCC markets view (T27 — P1-6): Saudi (Tadawul), Dubai (DFM) and Abu Dhabi
 *  (ADX) basics — index cards, one main index chart with range switcher
 *  (TASI has multi-year history on Yahoo, DFMGI ~a year, ADX quote-only and
 *  labeled as such), and top movers by traded value from the same delayed
 *  TradingView scanners the EGX side uses. A regional companion view — EGX
 *  remains the app's home market and every number here is honestly sourced. */

import { useEffect, useState } from "react";
import { useApp } from "../market/app-context";
import { useLiveData } from "../market/use-live-data";
import { T, tt } from "@/lib/i18n";
import { fmtNum, fmtValue, fmtInt, directionClass } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Globe2, LineChart as LineChartIcon } from "lucide-react";
import { ResponsiveContainer, ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

type GccIndex = {
  code: "TASI" | "MT30" | "DFMGI" | "ADI";
  nameAr: string;
  nameEn: string;
  market: "sa" | "ae";
  close: number;
  changePct: number | null;
  changeAbs: number | null;
  perfYTD: number | null;
  perf1M: number | null;
  perfY: number | null;
  currency: string;
  quoteOnly?: boolean;
};

type GccMover = {
  ticker: string;
  exchange: "TADAWUL" | "ADX" | "DFM";
  name: string;
  sector: string | null;
  close: number;
  changePct: number | null;
  volume: number | null;
  valueTraded: number | null;
  marketCap: number | null;
  currency: "SAR" | "AED";
};

type GccData = {
  asOf: string;
  indices: GccIndex[];
  movers: { saudi: GccMover[]; uae: GccMover[] };
  source: string;
};

type ChartData = { points: { date: string; close: number }[]; source: string; quoteOnly: boolean; error?: string };

const RANGES = ["1M", "3M", "6M", "1Y"] as const;

const INDEX_LABELS: Record<string, { ar: string; en: string }> = {
  TASI: { ar: "تاسي (السعودية)", en: "TASI (Saudi)" },
  MT30: { ar: "إم تي ٣٠ (السعودية)", en: "MT30 (Saudi)" },
  DFMGI: { ar: "دبي العام", en: "DFM General (Dubai)" },
  ADI: { ar: "أبوظبي العام", en: "ADX General (Abu Dhabi)" },
};

function IndexCard({ idx, active, onClick }: { idx: GccIndex; active: boolean; onClick: () => void }) {
  const { lang } = useApp();
  const up = (idx.changePct ?? 0) >= 0;
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border bg-card p-3 text-start w-full transition-colors ${
        active ? "border-primary/50 ring-1 ring-primary/30" : "hover:bg-accent/30"
      }`}
      aria-pressed={active}
    >
      <p className="text-[11px] font-semibold flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${idx.market === "sa" ? "bg-chart-2" : "bg-chart-4"}`} aria-hidden />
        {tt(INDEX_LABELS[idx.code] ?? { ar: idx.nameAr, en: idx.nameEn }, lang)}
      </p>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="num text-lg font-bold">{fmtNum(idx.close)}</span>
        {idx.changePct != null && (
          <span className={`num text-xs font-semibold ${directionClass(idx.changePct)}`}>
            {idx.changePct >= 0 ? "+" : ""}
            {idx.changePct.toFixed(2)}%
          </span>
        )}
        <span className="text-[9px] text-muted-foreground num">{idx.currency}</span>
      </div>
      <p className="num text-[10px] text-muted-foreground mt-0.5">
        {idx.perfYTD != null && `YTD ${idx.perfYTD >= 0 ? "+" : ""}${idx.perfYTD.toFixed(1)}% · `}
        {idx.perf1M != null && `1M ${idx.perf1M >= 0 ? "+" : ""}${idx.perf1M.toFixed(1)}% · `}
        {idx.perfY != null && `1Y ${idx.perfY >= 0 ? "+" : ""}${idx.perfY.toFixed(1)}%`}
        {idx.quoteOnly ? (lang === "ar" ? "سعر فقط — لا تاريخ عام" : "quote only — no public history") : ""}
      </p>
    </button>
  );
}

function MoverTable({ title, rows, market }: { title: string; rows: GccMover[]; market: "sa" | "ae" }) {
  const { lang } = useApp();
  const [limit, setLimit] = useState(8);
  const shown = rows.slice(0, limit);
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b flex items-center justify-between gap-2 flex-wrap">
        <p className="font-semibold text-sm flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${market === "sa" ? "bg-chart-2" : "bg-chart-4"}`} aria-hidden />
          {title}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {tt({ ar: "الأعلى بقيمة التداول (مؤجل ~١٥ دقيقة)", en: "Top by value traded (~15 min delayed)" }, lang)}
        </p>
      </div>
      {shown.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">{tt(T.calendarNoData, lang)}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-muted-foreground text-[10px]">
                <th className="text-start px-3 py-2 font-medium">{tt(T.colTicker, lang)}</th>
                <th className="text-start px-3 py-2 font-medium">{tt({ ar: "الشركة", en: "Company" }, lang)}</th>
                <th className="text-end px-3 py-2 font-medium">{tt(T.close, lang)}</th>
                <th className="text-end px-3 py-2 font-medium">{tt({ ar: "التغير", en: "Change" }, lang)}</th>
                <th className="text-end px-3 py-2 font-medium">{tt(T.volume, lang)}</th>
                <th className="text-end px-3 py-2 font-medium">{tt({ ar: "قيمة التداول", en: "Value" }, lang)}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((m) => (
                <tr key={`${m.exchange}-${m.ticker}`} className="hover:bg-accent/30">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="num font-bold">{m.ticker}</span>
                    <span className="ms-1.5 text-[9px] text-muted-foreground">{m.exchange}</span>
                  </td>
                  <td className="px-3 py-2 max-w-[220px] truncate text-muted-foreground" title={`${m.name}${m.sector ? ` — ${m.sector}` : ""}`}>
                    {m.name}
                    {m.sector && <span className="text-[9px] text-muted-foreground/70 ms-1">{m.sector}</span>}
                  </td>
                  <td className="num text-end px-3 py-2">
                    {fmtNum(m.close)} <span className="text-[9px] text-muted-foreground">{m.currency}</span>
                  </td>
                  <td className={`num text-end px-3 py-2 font-semibold ${m.changePct != null ? directionClass(m.changePct) : ""}`}>
                    {m.changePct != null ? `${m.changePct >= 0 ? "+" : ""}${m.changePct.toFixed(2)}%` : "—"}
                  </td>
                  <td className="num text-end px-3 py-2 text-muted-foreground">{m.volume != null ? fmtInt(m.volume) : "—"}</td>
                  <td className="num text-end px-3 py-2 text-muted-foreground">
                    {m.valueTraded != null ? `${fmtValue(m.valueTraded)} ${m.currency}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown.length && (
        <div className="px-4 py-2 border-t text-center">
          <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => setLimit((l) => l + 8)}>
            {tt(T.viewAll, lang)}
          </Button>
        </div>
      )}
    </div>
  );
}

export function GccView() {
  const { lang } = useApp();
  const { data, error } = useLiveData<GccData>("/api/gcc", 60_000);
  const [chartIdx, setChartIdx] = useState("TASI");
  const [range, setRange] = useState<(typeof RANGES)[number]>("6M");
  const [chart, setChart] = useState<ChartData | null>(null);
  const [chartLoading, setChartLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setChartLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/gcc?index=${encodeURIComponent(chartIdx)}&range=${range}`, { cache: "no-store" });
        const json = (await res.json()) as ChartData;
        if (!cancelled) setChart(json);
      } catch {
        if (!cancelled) setChart({ points: [], source: "", quoteOnly: false, error: "unavailable" });
      } finally {
        if (!cancelled) setChartLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chartIdx, range]);

  if (error && !data) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        {tt({ ar: "تعذّر تحميل بيانات الأسواق الخليجية الآن", en: "GCC market feeds unavailable right now" }, lang)}
      </div>
    );
  }

  const points = chart?.points ?? [];
  const first = points.length ? points[0].close : null;
  const last = points.length ? points[points.length - 1].close : null;
  const chg = first && last ? ((last - first) / first) * 100 : null;
  const up = (chg ?? 0) >= 0;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Globe2 className="h-5 w-5 text-primary" />
          {tt({ ar: "الأسواق الخليجية", en: "GCC Markets" }, lang)}
        </h1>
        {data && (
          <p className="num text-xs text-muted-foreground">
            {tt({ ar: "حُدِّث", en: "updated" }, lang)} {new Date(data.asOf).toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-GB", { hour: "2-digit", minute: "2-digit" })}
          </p>
        )}
      </div>
      <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">
        {tt(
          {
            ar: "نظرة إقليمية تكميلية: السعودية (تاسي وإم تي ٣٠) ودبي وأبوظبي — مؤشرات وأهم الأسهم بقيمة التداول، من نفس المصادر المجانية المؤجلة (~١٥ دقيقة) التي يستخدمها الجانب المصري. السوق المصري يبقى سوقنا الأساسي.",
            en: "A companion regional view: Saudi Arabia (TASI and MT30), Dubai and Abu Dhabi — headline indices and the most-traded names, from the same free delayed (~15 min) feeds the Egyptian side uses. EGX remains our home market.",
          },
          lang,
        )}
      </p>

      {!data ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          {/* index cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {data.indices.map((idx) => (
              <IndexCard
                key={idx.code}
                idx={idx}
                active={chartIdx === idx.code}
                onClick={() => !idx.quoteOnly && setChartIdx(idx.code)}
              />
            ))}
          </div>

          {/* main index chart */}
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <LineChartIcon className="h-4 w-4 text-primary" />
                {tt(INDEX_LABELS[chartIdx] ?? { ar: chartIdx, en: chartIdx }, lang)}
                {chg != null && (
                  <span className={`num text-xs font-semibold ms-2 ${directionClass(chg)}`}>
                    {up ? "+" : ""}
                    {chg.toFixed(2)}% {first != null && last != null ? `(${fmtNum(last, 1)})` : ""}
                  </span>
                )}
              </p>
              <div className="flex items-center gap-1" role="tablist" aria-label={tt(T.chartRange, lang)}>
                {RANGES.map((r) => (
                  <button
                    key={r}
                    role="tab"
                    aria-selected={range === r}
                    onClick={() => setRange(r)}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      range === r ? "bg-secondary font-semibold border-ring" : "text-muted-foreground hover:bg-accent/50"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            {chartLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : chart?.error || points.length < 2 ? (
              <p className="py-12 text-center text-sm text-muted-foreground leading-relaxed">
                {chart?.quoteOnly || chartIdx === "ADI"
                  ? tt(
                      {
                        ar: "لا يوجد تاريخ عام مجاني لمؤشر أبوظبي — بيانات السعر المباشرة فقط في البطاقة أعلاه.",
                        en: "No free public history exists for the ADX index — live quote only in the card above.",
                      },
                      lang,
                    )
                  : tt(T.chartUnavailable, lang)}
              </p>
            ) : (
              <div style={{ height: 240 }} dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -6 }}>
                    <defs>
                      <linearGradient id="gcc-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={up ? "var(--up)" : "var(--down)"} stopOpacity={0.25} />
                        <stop offset="100%" stopColor={up ? "var(--up)" : "var(--down)"} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval="preserveStartEnd" minTickGap={32} />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => fmtNum(v, 0)} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        const v = payload?.find((p) => p.dataKey === "close")?.value as number | undefined;
                        if (!active || v === undefined || !Number.isFinite(v)) return null;
                        return (
                          <div className="rounded-md border bg-card px-3 py-1.5 text-xs shadow-md">
                            <p className="num font-semibold">{label}</p>
                            <p className="num text-muted-foreground">
                              {tt(T.close, lang)}: <b>{fmtNum(v, 1)}</b>
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Area type="monotone" dataKey="close" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth={2} fill="url(#gcc-grad)" isAnimationActive={false} activeDot={{ r: 3.5, strokeWidth: 0 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
            {chart && !chart.error && points.length >= 2 && (
              <p className="text-[10px] text-muted-foreground mt-1.5">{chart.source}</p>
            )}
          </div>

          {/* movers */}
          <MoverTable
            title={tt({ ar: "السعودية — الأنشط بقيمة التداول", en: "Saudi Arabia — most active by value" }, lang)}
            rows={data.movers.saudi}
            market="sa"
          />
          <MoverTable
            title={tt({ ar: "الإمارات — الأنشط بقيمة التداول (أبوظبي ودبي)", en: "UAE — most active by value (ADX + DFM)" }, lang)}
            rows={data.movers.uae}
            market="ae"
          />
        </>
      )}

      {data && (
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          {tt(T.priceChartNote, lang)} — {data.source}
        </p>
      )}
    </div>
  );
}
