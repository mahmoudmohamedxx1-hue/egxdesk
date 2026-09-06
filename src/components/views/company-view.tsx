"use client";

import { useEffect, useState } from "react";
import { useApp } from "../market/app-context";
import { T, tt } from "@/lib/i18n";
import { fmtNum, fmtValue, fmtPct, fmtRatio, fmtInt, fmtDateAr, directionClass } from "@/lib/format";
import { WatchStar } from "../market/watch-star";
import { ChangeCell } from "../market/change-cell";
import { PriceChart } from "../market/price-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Volume2, Calculator, TrendingUp, TrendingDown } from "lucide-react";

type CompanyData = {
  authed: boolean;
  company: {
    ticker: string; nameAr: string; nameEn: string; sectorAr: string; sectorEn: string;
    close: number; prevClose: number; changePct: number; week1Pct: number; month1Pct: number;
    volume: number; avgVolume30d: number; trades: number; valueTraded: number; marketCap: number;
    pe: number | null; pe12m: number | null; pb: number | null; eps: number | null; divYield: number | null;
    netProfit: number | null; totalAssets: number | null; roe: number | null; roa: number | null;
    debtToEquity: number | null; cashConversion: number | null; freeFloat: number | null;
    issuedShares: number | null; briefAr: string | null; briefEn: string | null;
    hasFullFinancials: boolean; inEgx30: boolean; inEgx70: boolean; inEgx100: boolean;
  };
  sectorAgg: Record<string, number | null>;
  history: { date: string; close: number }[];
  financials: { label: string; periodType: string; revenue: number | null; netProfit: number | null; totalAssets: number | null; equity: number | null; eps: number | null }[];
  disclosures: { title: string; kind: string; date: string }[];
};

const RANGES = [
  { key: "1W", days: 5 },
  { key: "1M", days: 22 },
  { key: "3M", days: 65 },
  { key: "1Y", days: 250 },
  { key: "5Y", days: 2500 },
] as const;

export function CompanyView({ ticker, panel }: { ticker: string; panel: string }) {
  const { lang, navigate, auth } = useApp();
  const [data, setData] = useState<CompanyData | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("1Y");
  const [activePanel, setActivePanel] = useState(panel);
  const [speaking, setSpeaking] = useState(false);
  const key = `${ticker}|${panel}|${auth.email}`;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/company/${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoadedKey(key);
          setActivePanel(panel);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setLoadedKey(key);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ticker, panel, key, auth.email]);

  const loading = loadedKey !== key;

  if (loading || !data || !data.company) {
    if (data && !data.company) {
      return (
        <div className="py-16 text-center space-y-2">
          <p className="text-lg font-semibold">{lang === "ar" ? "لا توجد شركة بهذا الرمز" : "No such company"}</p>
          <button onClick={() => navigate("market")} className="text-sm text-primary hover:underline">
            {tt(T.browseMarket, lang)}
          </button>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const c = data.company;
  const rangeDays = RANGES.find((r) => r.key === range)!.days;
  const history = data.history.slice(-rangeDays);
  const hi = history.length ? Math.max(...history.map((h) => h.close)) : null;
  const lo = history.length ? Math.min(...history.map((h) => h.close)) : null;

  function speakBrief() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    const text = (lang === "ar" ? c.briefAr : c.briefEn) ?? c.nameAr;
    const u = new SpeechSynthesisUtterance(`${c.ticker}. ${text}`);
    u.lang = lang === "ar" ? "ar-EG" : "en-US";
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
    setSpeaking(true);
  }

  const panels = [
    { key: "overview", t: T.panelOverview },
    { key: "activity", t: T.panelActivity },
    { key: "financials", t: T.panelFinancials },
    { key: "disclosures", t: T.panelDisclosures },
  ];

  return (
    <div className="space-y-5">
      {/* ticker row */}
      <div className="flex items-center flex-wrap gap-2">
        <span className="num text-lg font-bold">{c.ticker}</span>
        <WatchStar ticker={c.ticker} />
        <button
          onClick={speakBrief}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent/50 transition-colors"
        >
          <Volume2 className={`h-3.5 w-3.5 ${speaking ? "animate-pulse" : ""}`} />
          {tt(T.listenBrief, lang)}
        </button>
        <button
          onClick={() => navigate("tools")}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent/50 transition-colors"
        >
          <Calculator className="h-3.5 w-3.5" />
          {lang === "ar" ? "احسب عائد الكوبون" : "Compute coupon return"}
        </button>
      </div>

      {/* identity + quote */}
      <div className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-xs text-muted-foreground">{c.sectorAr} · EGX{(c.inEgx30 ? " 30" : c.inEgx70 ? " 70" : c.inEgx100 ? " 100" : "")}</p>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{lang === "ar" ? c.nameAr : c.nameEn}</h1>
            <p className="text-xs text-muted-foreground">{lang === "ar" ? c.nameEn : c.nameAr}</p>
          </div>
          <div className="text-end space-y-0.5">
            <p className="text-xs text-muted-foreground">{tt(T.lastClose, lang)}</p>
            <p className="num text-3xl font-bold tracking-tight">{fmtNum(c.close)}</p>
            <p className={`num text-sm font-semibold ${directionClass(c.changePct)} flex items-center gap-1.5 justify-end`}>
              {c.changePct >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {c.changePct >= 0 ? "+" : ""}{fmtNum(c.close - c.prevClose)} ({fmtPct(c.changePct)})
            </p>
            <p className="num text-[10px] text-muted-foreground">2026-09-06</p>
          </div>
        </div>

        {/* stat strip */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-3 border-t pt-4">
          <Stat label={tt(T.marketCap, lang)} value={`EGP ${fmtValue(c.marketCap)}`} />
          <Stat label={tt(T.week, lang)} value={fmtPct(c.week1Pct)} cls={directionClass(c.week1Pct)} />
          <Stat label={tt(T.month, lang)} value={fmtPct(c.month1Pct)} cls={directionClass(c.month1Pct)} />
          <Stat label={tt(T.volume, lang)} value={fmtInt(c.volume)} sub={`${tt(T.inSession, lang)} · ${tt(T.avg30, lang)} ${fmtInt(c.avgVolume30d)}`} />
          <Stat label={tt(T.trades, lang)} value={fmtInt(c.trades)} sub={tt(T.inSession, lang)} />
          <Stat label="P/E" value={c.pe ? fmtNum(c.pe, 1) : "—"} sub={c.eps ? `EPS ${fmtNum(c.eps)}` : undefined} />
        </div>
      </div>

      {/* panel tabs */}
      <div className="flex items-center gap-1 overflow-x-auto thin-scroll border-b" role="tablist">
        {panels.map((p) => (
          <button
            key={p.key}
            role="tab"
            aria-selected={activePanel === p.key}
            onClick={() => setActivePanel(p.key)}
            className={`whitespace-nowrap px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${
              activePanel === p.key ? "border-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tt(p.t, lang)}
            {p.key === "financials" && data.financials.length > 0 && (
              <span className="num ms-1.5 text-xs text-muted-foreground">{data.financials.length}</span>
            )}
            {p.key === "disclosures" && data.disclosures.length > 0 && (
              <span className="num ms-1.5 text-xs text-muted-foreground">{data.disclosures.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {activePanel === "overview" && (
        <div className="space-y-5">
          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h2 className="font-bold">{tt(T.priceHistory, lang)}</h2>
              <div className="flex items-center gap-1">
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setRange(r.key)}
                    className={`num rounded-md px-2 py-1 text-xs transition-colors ${range === r.key ? "bg-secondary font-semibold" : "hover:bg-accent/50 text-muted-foreground"}`}
                  >
                    {r.key}
                  </button>
                ))}
              </div>
            </div>
            <PriceChart data={history} />
            {hi !== null && lo !== null && (
              <p className="num mt-1 text-[11px] text-muted-foreground">
                {fmtNum(hi)} / {fmtNum(lo)} · {history.length} {lang === "ar" ? "جلسة" : "sessions"} · {history[0]?.date} → {history[history.length - 1]?.date}
              </p>
            )}
          </section>

          {c.briefAr && (
            <section className="rounded-lg border bg-card p-4">
              <h2 className="font-bold mb-2">{tt(T.companyBrief, lang)}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{lang === "ar" ? c.briefAr : c.briefEn}</p>
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 border-t pt-3">
                <Stat label={tt(T.issuedShares, lang)} value={c.issuedShares ? fmtInt(c.issuedShares) : "—"} />
                <Stat label={tt(T.freeFloat, lang)} value={c.freeFloat !== null ? `${fmtNum(c.freeFloat, 1)}%` : "—"} />
                <Stat label={lang === "ar" ? "عائد التوزيعات" : "Dividend yield"} value={c.divYield !== null ? `${fmtNum(c.divYield, 1)}%` : "—"} />
              </div>
            </section>
          )}
        </div>
      )}

      {/* ACTIVITY */}
      {activePanel === "activity" && (
        <section className="rounded-lg border bg-card p-4 space-y-4">
          <h2 className="font-bold">{tt(T.panelActivity, lang)}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label={tt(T.volume, lang)} value={fmtInt(c.volume)} sub={tt(T.inSession, lang)} />
            <Stat label={tt(T.avg30, lang)} value={fmtInt(c.avgVolume30d)} />
            <Stat label={tt(T.valueTraded, lang)} value={`EGP ${fmtValue(c.valueTraded)}`} sub={tt(T.inSession, lang)} />
            <Stat label={tt(T.trades, lang)} value={fmtInt(c.trades)} sub={tt(T.inSession, lang)} />
          </div>
          <div className="rounded-md bg-secondary/70 p-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{lang === "ar" ? "الحجم ÷ المعتاد" : "Volume ÷ usual"}</span>
            <span className="num text-lg font-bold text-primary">
              {c.avgVolume30d ? fmtNum(c.volume / c.avgVolume30d, 1) + "×" : "—"}
            </span>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1 text-xs">
              <span className="text-muted-foreground">{lang === "ar" ? "مقابل متوسط ٣٠ يوماً" : "vs 30-day average"}</span>
              <span className="num">{fmtInt(c.volume)} / {fmtInt(c.avgVolume30d)}</span>
            </div>
            <div className="h-2 rounded-full bg-secondary overflow-hidden" dir="ltr">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min((c.volume / Math.max(c.avgVolume30d, 1)) * 50, 100)}%` }} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">{tt(T.unusualNote, lang)}</p>
        </section>
      )}

      {/* FINANCIALS */}
      {activePanel === "financials" && (
        <div className="space-y-4">
          {/* vs sector */}
          <section className="rounded-lg border bg-card p-4">
            <h2 className="font-bold mb-1">{lang === "ar" ? "الرقم مقابل القطاع" : "The figure vs its sector"}</h2>
            <p className="text-xs text-muted-foreground mb-3">
              {lang === "ar" ? "الأعلى/الأدنى من وسيط القطاع — لا توصية." : "Above/below the sector median — not advice."}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
              <VsSector label="P/E" value={c.pe} agg={data.sectorAgg.pe} fmt={(v) => fmtNum(v, 1)} />
              <VsSector label="P/B" value={c.pb} agg={data.sectorAgg.pb} fmt={(v) => fmtRatio(v)} />
              <VsSector label={lang === "ar" ? "عائد التوزيعات" : "Div yield"} value={c.divYield} agg={data.sectorAgg.divYield} fmt={(v) => `${fmtNum(v, 1)}%`} higherBetter />
              <VsSector label={lang === "ar" ? "صافي الربح" : "Net profit"} value={c.netProfit} agg={data.sectorAgg.netProfit} fmt={(v) => fmtValue(v * 1e6)} higherBetter />
              <VsSector label="EPS" value={c.eps} agg={data.sectorAgg.eps} fmt={(v) => fmtNum(v)} higherBetter />
              <VsSector label={lang === "ar" ? "إجمالي الأصول" : "Assets"} value={c.totalAssets} agg={data.sectorAgg.totalAssets} fmt={(v) => fmtValue(v * 1e6)} higherBetter />
              <VsSector label="ROE" value={c.roe} agg={data.sectorAgg.roe} fmt={(v) => `${fmtNum(v, 1)}%`} higherBetter />
              <VsSector label="ROA" value={c.roa} agg={data.sectorAgg.roa} fmt={(v) => `${fmtNum(v, 1)}%`} higherBetter />
              <VsSector label={lang === "ar" ? "الدين / الملكية" : "D/E"} value={c.debtToEquity} agg={data.sectorAgg.debtToEquity} fmt={(v) => fmtRatio(v)} />
            </div>
          </section>

          {/* statements table */}
          <section className="rounded-lg border bg-card overflow-hidden">
            <div className="border-b px-4 py-3">
              <h2 className="font-bold">{lang === "ar" ? "القوائم كما وردت" : "Statements as filed"}</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {lang === "ar"
                  ? "بملايين الجنيهات ما لم يُذكر غيره · الفترات تراكمية كما تُقدّمها البورصة · الخانة الفارغة رقم غير مُعلن"
                  : "In EGP millions unless stated · periods are cumulative as filed · an empty cell is an unreported figure"}
              </p>
            </div>
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm">
                <thead className="border-b bg-card">
                  <tr className="text-[11px] text-muted-foreground">
                    <th className="text-start font-medium px-3 py-2">{lang === "ar" ? "الفترة" : "Period"}</th>
                    <th className="text-end font-medium px-3 py-2">{lang === "ar" ? "الإيرادات" : "Revenue"}</th>
                    <th className="text-end font-medium px-3 py-2">{lang === "ar" ? "صافي الربح" : "Net profit"}</th>
                    <th className="text-end font-medium px-3 py-2 hidden sm:table-cell">{lang === "ar" ? "إجمالي الأصول" : "Assets"}</th>
                    <th className="text-end font-medium px-3 py-2 hidden md:table-cell">{lang === "ar" ? "حقوق الملكية" : "Equity"}</th>
                    <th className="text-end font-medium px-3 py-2">EPS</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.financials.map((f) => (
                    <tr key={f.label} className="hover:bg-accent/30 transition-colors">
                      <td className="num px-3 py-2.5 font-medium">{f.label}</td>
                      <td className="num px-3 py-2.5 text-end">{f.revenue !== null ? fmtInt(f.revenue) : "—"}</td>
                      <td className="num px-3 py-2.5 text-end">{f.netProfit !== null ? fmtInt(f.netProfit) : "—"}</td>
                      <td className="num px-3 py-2.5 text-end hidden sm:table-cell">{f.totalAssets !== null ? fmtInt(f.totalAssets) : "—"}</td>
                      <td className="num px-3 py-2.5 text-end hidden md:table-cell">{f.equity !== null ? fmtInt(f.equity) : "—"}</td>
                      <td className="num px-3 py-2.5 text-end">{f.eps !== null ? fmtNum(f.eps) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <p className="text-[11px] text-muted-foreground">
            {data.financials.filter((f) => f.revenue !== null).length} {lang === "ar" ? "فترة تحمل قائمة كاملة، والباقي إعلانات ربح فقط." : "periods carry full statements; the rest are earnings-only announcements."}
          </p>
        </div>
      )}

      {/* DISCLOSURES */}
      {activePanel === "disclosures" && (
        <section className="rounded-lg border bg-card divide-y">
          <div className="px-4 py-3">
            <h2 className="font-bold">{tt(T.panelDisclosures, lang)}</h2>
          </div>
          {data.disclosures.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {lang === "ar" ? "لا إفصاحات مسجلة" : "No filings on record"}
            </p>
          )}
          {data.disclosures.map((d, i) => (
            <article key={i} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] font-medium">{d.kind}</span>
                <span className="num text-[11px] text-muted-foreground">{fmtDateAr(d.date)}</span>
              </div>
              <p className="text-sm leading-snug">{d.title}</p>
            </article>
          ))}
        </section>
      )}

      <p className="text-[10px] text-muted-foreground">
        {lang === "ar"
          ? "الشرطتان تعنيان غياب البيانات. لا نعرض مقياساً دون بيانات تدعمه. الأرقام لهذا العرض التجريبي."
          : "Em-dashes mean missing data. No metric is shown without supporting data. Figures are demo data."}
      </p>
    </div>
  );
}

// comparison vs sector median
function VsSector({ label, value, agg, fmt, higherBetter }: {
  label: string; value: number | null | undefined; agg: number | null | undefined;
  fmt: (v: number) => string; higherBetter?: boolean;
}) {
  const has = typeof value === "number" && typeof agg === "number";
  let better: boolean | null = null;
  if (has) {
    better = higherBetter ? value > agg : value < agg;
  }
  return (
    <div className="border-b border-dotted pb-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="num text-sm font-semibold">{value !== null && value !== undefined ? fmt(value) : "—"}</span>
        {has && (
          <span className={`num text-[10px] px-1 rounded ${better ? "text-up bg-up-soft" : "text-down bg-down-soft"}`}>
            {better ? "▲" : "▼"} {fmt(agg!)}
          </span>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
      <p className={`num text-sm font-semibold ${cls ?? ""}`}>{value}</p>
      {sub && <p className="num text-[10px] text-muted-foreground leading-tight">{sub}</p>}
    </div>
  );
}
