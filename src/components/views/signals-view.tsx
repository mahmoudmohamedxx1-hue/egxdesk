"use client";

/** Signals tab — "the best signals across the stocks": one ranked table of
 *  the whole EGX universe by the COMPOSITE rating (55% technical +
 *  45% fundamental), with a market-bias summary, the strongest
 *  bullish/bearish call-outs, lens switching (composite / technical /
 *  fundamental), rating filters, search and CSV.
 *  Arabic-first, honest labeling, one tap into the stock's panels. */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/market/app-context";
import { useLiveData } from "@/components/market/use-live-data";
import { bootParam, patchUrlParams } from "@/lib/url-state";
import { T, tt, dn } from "@/lib/i18n";
import { fmtNum, fmtPct, directionClass } from "@/lib/format";
import { downloadCsv, fileStamp } from "@/lib/export";
import { ExportMenu } from "@/components/market/export-xlsx-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { BrainCircuit, TrendingDown, TrendingUp, Search } from "lucide-react";
import type { Rating, SignalRow, SignalsScan } from "@/lib/signals-scan";
import { AiSignalsPanel } from "@/components/views/ai-signals-panel";

type SignalsResponse = SignalsScan & {
  source?: string;
  note?: string;
};

type Lens = "composite" | "tech" | "fund";

const RATING_LABEL: Record<Rating, { ar: string; en: string }> = {
  strongBuy: T.techStrongBuy,
  buy: T.techBuy,
  neutral: T.techNeutral,
  sell: T.techSell,
  strongSell: T.techStrongSell,
};

const RATING_CLS: Record<Rating, string> = {
  strongBuy: "bg-up text-up-foreground",
  buy: "bg-up-soft text-up",
  neutral: "bg-secondary text-muted-foreground",
  sell: "bg-down-soft text-down",
  strongSell: "bg-down text-down-foreground",
};

const RATING_ORDER: Rating[] = ["strongBuy", "buy", "neutral", "sell", "strongSell"];

/** -1…+1 score as a centered diverging bar (LTR canvas). */
function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(Math.abs(score), 1) * 50;
  return (
    <div dir="ltr" className="relative h-2 w-24 rounded-full bg-secondary overflow-hidden" aria-hidden>
      <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
      <span
        className={`absolute inset-y-0 ${score >= 0 ? "bg-up" : "bg-down"}`}
        style={
          score >= 0
            ? { left: "50%", width: `${pct}%` }
            : { right: "50%", width: `${pct}%` }
        }
      />
    </div>
  );
}

function RatingBadgeL({ rating, lang }: { rating: Rating; lang: "ar" | "en" }) {
  return (
    <span className={`inline-block min-w-[3.6rem] rounded-sm px-1.5 py-0.5 text-[10px] font-semibold text-center whitespace-nowrap ${RATING_CLS[rating]}`}>
      {tt(RATING_LABEL[rating], lang)}
    </span>
  );
}

/** Compact colored T/F score cell. */
function ScoreCell({ score }: { score: number | null }) {
  if (score === null) return <span className="num text-[10px] text-muted-foreground">—</span>;
  return (
    <span className={`num text-[10px] font-semibold ${score > 0.1 ? "text-up" : score < -0.1 ? "text-down" : "text-muted-foreground"}`}>
      {fmtNum(score, 2)}
    </span>
  );
}

function driverChips(r: SignalRow, lang: "ar" | "en"): string[] {
  const out: string[] = [];
  if (r.rsi !== null) out.push(`RSI ${fmtNum(r.rsi, 1)}`);
  if (r.macdHist !== null) out.push(`MACD ${r.macdHist > 0 ? "+" : ""}${fmtNum(r.macdHist, 2)}`);
  if (r.sma50Sig !== "neutral") out.push(`${tt(r.sma50Sig === "buy" ? T.signalsAbove : T.signalsBelow, lang)} SMA50`);
  if (r.sma200Sig !== "neutral") out.push(`${tt(r.sma200Sig === "buy" ? T.signalsAbove : T.signalsBelow, lang)} SMA200`);
  if (r.pos52 !== null) out.push(`${fmtNum(r.pos52, 0)}% ${tt(T.signalsCol52, lang)}`);
  if (r.volRatio !== null && r.volRatio >= 2) out.push(`${tt(T.signalsColVol, lang)} ×${fmtNum(r.volRatio, 1)}`);
  return out;
}

/** Fundamental pillar chips (V/Q/I) — colored by pillar score, tooltip = the
 *  exact reason lines computed from real scanner fields. */
function pillarChips(r: SignalRow, lang: "ar" | "en") {
  const pillars: { letter: string; score: number | null; label: string }[] = [
    { letter: "V", score: r.valuation, label: tt(T.signalsPillarValuation, lang) },
    { letter: "Q", score: r.quality, label: tt(T.signalsPillarQuality, lang) },
    { letter: "I", score: r.income, label: tt(T.signalsPillarIncome, lang) },
  ];
  return pillars.map((p) => (
    <span
      key={p.letter}
      title={`${p.label}: ${fmtNum(p.score ?? 0, 2)}`}
      className={`num inline-flex h-4 w-4 items-center justify-center rounded-sm text-[9px] font-bold ${
        p.score === null
          ? "bg-secondary text-muted-foreground/60"
          : p.score > 0.1
            ? "bg-up-soft text-up"
            : p.score < -0.1
              ? "bg-down-soft text-down"
              : "bg-secondary text-muted-foreground"
      }`}
    >
      {p.letter}
    </span>
  ));
}

function HighlightCard({
  r,
  kind,
  lang,
  onOpen,
}: {
  r: SignalRow;
  kind: "bull" | "bear";
  lang: "ar" | "en";
  onOpen: () => void;
}) {
  const fundReasons = (lang === "ar" ? r.fundReasonsAr : r.fundReasons) ?? [];
  return (
    <button
      onClick={onOpen}
      className="text-start rounded-lg border bg-card p-4 space-y-2 hover:bg-accent/40 transition-colors w-full"
    >
      <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
        {kind === "bull" ? (
          <TrendingUp className="h-3.5 w-3.5 text-up" aria-hidden />
        ) : (
          <TrendingDown className="h-3.5 w-3.5 text-down" aria-hidden />
        )}
        {tt(kind === "bull" ? T.signalsBullTop : T.signalsBearTop, lang)}
      </p>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-base font-bold">
          <span className="num">{r.ticker}</span>{" "}
          <span className="text-sm font-medium text-muted-foreground">{dn(r, lang)}</span>
        </p>
        <RatingBadgeL rating={r.compositeRating} lang={lang} />
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        {driverChips(r, lang).slice(0, 4).map((c) => (
          <span key={c} className="num rounded-sm bg-secondary/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {c}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        {pillarChips(r, lang)}
        {fundReasons.slice(0, 3).map((c) => (
          <span key={c} className="num rounded-sm bg-secondary/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {c}
          </span>
        ))}
      </div>
      <p className="num text-xs text-muted-foreground">
        {fmtNum(r.close)} EGP · <span className={directionClass(r.changePct)}>{fmtPct(r.changePct)}</span> ·{" "}
        {tt(T.signalsColScore, lang)} {fmtNum(r.composite, 2)}{" "}
        <span className="text-muted-foreground/70">
          (T {fmtNum(r.score, 2)} · F {r.fundScore !== null ? fmtNum(r.fundScore, 2) : "—"})
        </span>
      </p>
    </button>
  );
}

export function SignalsView() {
  const { lang, navigate, toast } = useApp();
  const { data, error, loading } = useLiveData<SignalsResponse>("/api/signals", 5 * 60_000);
  const [mode, setMode] = useState<"tech" | "ai">("tech");
  const [lens, setLens] = useState<Lens>("composite");
  const [dir, setDir] = useState<"bull" | "bear">("bull");
  const [filter, setFilter] = useState<Rating | "all">("all");
  const [q, setQ] = useState("");

  // 21-c — shareable state: ?view=signals&mode=ai&lens=fund&dir=bear&rating=buy
  useEffect(() => {
    const m = bootParam("mode");
    if (m === "tech" || m === "ai") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode(m);
    }
    const l = bootParam("lens");
    if (l === "composite" || l === "tech" || l === "fund") setLens(l);
    const d = bootParam("dir");
    if (d === "bull" || d === "bear") setDir(d);
    const r = bootParam("rating");
    if (r && (RATING_ORDER as string[]).includes(r)) setFilter(r as Rating);
  }, []);
  useEffect(() => {
    patchUrlParams({
      mode: mode === "tech" ? null : mode,
      lens: lens === "composite" ? null : lens,
      dir: dir === "bull" ? null : dir,
      rating: filter === "all" ? null : filter,
    });
  }, [mode, lens, dir, filter]);

  const stats = useMemo(() => {
    if (!data?.rows) return null;
    const counts: Record<Rating, number> = { strongBuy: 0, buy: 0, neutral: 0, sell: 0, strongSell: 0 };
    let sum = 0;
    let fundCovered = 0;
    for (const r of data.rows) {
      counts[r.compositeRating]++;
      sum += r.composite;
      if (r.fundScore !== null) fundCovered++;
    }
    const avg = data.rows.length ? sum / data.rows.length : 0;
    const bull = counts.strongBuy + counts.buy;
    const bear = counts.strongSell + counts.sell;
    return { counts, avg, bull, bear, total: data.rows.length, fundCovered };
  }, [data]);

  const rows = useMemo(() => {
    if (!data?.rows) return [];
    let list = data.rows;
    if (filter !== "all") list = list.filter((r) => r.compositeRating === filter);
    const needle = q.trim().toLowerCase();
    if (needle) {
      const ar = /[\u0600-\u06FF]/.test(needle);
      list = list.filter(
        (r) =>
          r.ticker.toLowerCase().includes(needle) ||
          r.name.toLowerCase().includes(needle) ||
          (ar && r.nameAr.includes(q.trim()))
      );
    }
    const key = (r: SignalRow) => (lens === "tech" ? r.score : lens === "fund" ? (r.fundScore ?? -2) : r.composite);
    return [...list].sort((a, b) => (dir === "bull" ? key(b) - key(a) : key(a) - key(b)));
  }, [data, filter, q, dir, lens]);

  const exportCsv = () => {
    if (!data?.rows.length) return;
    const headers = [
      "#", "ticker", "name (ar)", "sector (ar)", "close EGP", "day %",
      "composite rating", "composite score", "technical score", "fundamental score",
      "valuation", "quality", "income", "fundamental coverage",
      "P/E", "P/B", "ROE %", "net margin %", "D/E", "div yield %",
      "buy", "neutral", "sell", "RSI", "MACD hist", "SMA50", "SMA200",
      "above SMA50", "above SMA200", "52w position %", "vol x avg", "perf 1M %", "perf 6M %", "perf YTD %", "next earnings",
      "fundamental reasons",
    ];
    downloadCsv(`egx-signals-${fileStamp()}`, headers, data.rows.map((r, i) => [
      i + 1, r.ticker, r.nameAr, r.sectorAr, r.close, r.changePct,
      r.compositeRating, r.composite, r.score, r.fundScore ?? "",
      r.valuation ?? "", r.quality ?? "", r.income ?? "", r.fundCoverage,
      r.pe ?? "", r.pb ?? "", r.roe ?? "", r.netMarginTTM ?? "", r.debtToEquity ?? "", r.divYield ?? "",
      r.buy, r.neutral, r.sell, r.rsi, r.macdHist, r.sma50, r.sma200,
      r.sma50Sig === "buy" ? 1 : 0, r.sma200Sig === "buy" ? 1 : 0, r.pos52, r.volRatio,
      r.perf1M, r.perf6M, r.perfYTD, r.nextEarnings ?? "",
      (r.fundReasons ?? []).join(" | "),
    ]));
    toast(tt(T.signalsCsvDone, lang));
  };

  if (loading && !data && mode === "tech") {
    return (
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">{tt(T.signalsWarming, lang)}</p>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error && !data && mode === "tech") {
    return (
      <section className="rounded-lg border bg-card p-6 text-center space-y-3">
        <p className="text-sm font-medium">{tt(T.signalsError, lang)}</p>
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
          {tt(T.signalsRetry, lang)}
        </Button>
      </section>
    );
  }

  const lensScore = (r: SignalRow): number | null =>
    lens === "tech" ? r.score : lens === "fund" ? r.fundScore : r.composite;

  return (
    <div className="space-y-5">
      {/* header + mode switch (composite scan | AI signals) */}
      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
          <h1 className="text-lg font-bold">{tt(mode === "ai" ? T.aiSignalsTitle : T.signalsTabTitle, lang)}</h1>
          <div className="flex items-center gap-2">
            {mode === "tech" && data && (
              <span className="num text-[11px] text-muted-foreground">
                {data.scanned} {tt(T.signalsScanCount, lang)} · {tt(T.signalsScanAsOf, lang)}{" "}
                {new Date(data.asOf).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
            {mode === "tech" && (
              <ExportMenu report="signals" onCsv={exportCsv} title={tt(T.csvExportHint, lang)} />
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl">
          {tt(mode === "ai" ? T.aiSignalsNote : T.signalsTabNote, lang)}
        </p>
        {mode === "tech" && (
          <p className="text-[10px] text-muted-foreground/80 leading-relaxed max-w-3xl mt-1">
            {tt(T.signalsFundLegend, lang)}
          </p>
        )}
        <div className="mt-3 flex rounded-md border overflow-hidden w-fit" role="tablist">
          <button
            role="tab"
            aria-selected={mode === "tech"}
            onClick={() => setMode("tech")}
            className={`px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-1.5 ${
              mode === "tech" ? "bg-primary text-primary-foreground" : "hover:bg-accent/50"
            }`}
          >
            <TrendingUp className="h-3 w-3" aria-hidden />
            {tt(T.aiSignalsModeTech, lang)}
          </button>
          <button
            role="tab"
            aria-selected={mode === "ai"}
            onClick={() => setMode("ai")}
            className={`px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-1.5 ${
              mode === "ai" ? "bg-primary text-primary-foreground" : "hover:bg-accent/50"
            }`}
          >
            <BrainCircuit className="h-3 w-3" aria-hidden />
            {tt(T.aiSignalsModeAi, lang)}
          </button>
        </div>
      </section>

      {mode === "ai" && <AiSignalsPanel />}

      {mode === "tech" && (
        <>
      {stats && data && (
        <>
          {/* market bias + rating distribution */}
          <section className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm font-semibold">{tt(T.signalsBias, lang)}</p>
              <p
                className={`text-sm font-bold ${
                  stats.avg > 0.1 ? "text-up" : stats.avg < -0.1 ? "text-down" : "text-muted-foreground"
                }`}
              >
                {stats.avg > 0.1
                  ? tt(T.signalsBiasBull, lang)
                  : stats.avg < -0.1
                    ? tt(T.signalsBiasBear, lang)
                    : tt(T.signalsBiasNeutral, lang)}{" "}
                <span className="num text-xs font-medium">({fmtNum(stats.avg, 2)})</span>
              </p>
            </div>
            {/* diverging distribution bar: bear | bull */}
            <div dir="ltr" className="flex h-7 w-full overflow-hidden rounded-md border text-[10px] font-semibold">
              <div
                className="flex items-center justify-center bg-down-soft text-down"
                style={{ width: `${(stats.bear / stats.total) * 100}%` }}
                title={`${stats.bear}`}
              >
                {stats.bear > stats.total * 0.08 ? stats.bear : ""}
              </div>
              <div
                className="flex items-center justify-center bg-secondary text-muted-foreground"
                style={{ width: `${(stats.counts.neutral / stats.total) * 100}%` }}
                title={`${stats.counts.neutral}`}
              >
                {stats.counts.neutral > stats.total * 0.12 ? stats.counts.neutral : ""}
              </div>
              <div
                className="flex items-center justify-center bg-up-soft text-up"
                style={{ width: `${(stats.bull / stats.total) * 100}%` }}
                title={`${stats.bull}`}
              >
                {stats.bull > stats.total * 0.08 ? stats.bull : ""}
              </div>
            </div>
            {/* rating filter chips */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setFilter("all")}
                className={`rounded-sm px-2 py-1 text-[11px] font-medium border transition-colors ${
                  filter === "all" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent/50"
                }`}
              >
                {tt(T.signalsFilterAll, lang)} <span className="num">{stats.total}</span>
              </button>
              {RATING_ORDER.map((r) => (
                <button
                  key={r}
                  onClick={() => setFilter(filter === r ? "all" : r)}
                  className={`rounded-sm px-2 py-1 text-[11px] font-medium border transition-colors ${
                    filter === r ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent/50"
                  }`}
                >
                  {tt(RATING_LABEL[r], lang)} <span className="num">{stats.counts[r]}</span>
                </button>
              ))}
              <span className="num text-[10px] text-muted-foreground/80 ms-1">
                {stats.fundCovered}/{stats.total} {tt(T.signalsColFund, lang)}
              </span>
            </div>
          </section>

          {/* strongest calls */}
          <div className="grid gap-3 md:grid-cols-2">
            {data.rows[0] && (
              <HighlightCard
                r={data.rows[0]}
                kind="bull"
                lang={lang}
                onOpen={() => navigate("company", { ticker: data.rows[0].ticker, panel: "technical" })}
              />
            )}
            {data.rows[data.rows.length - 1] && (
              <HighlightCard
                r={data.rows[data.rows.length - 1]}
                kind="bear"
                lang={lang}
                onOpen={() =>
                  navigate("company", {
                    ticker: data.rows[data.rows.length - 1].ticker,
                    panel: "technical",
                  })
                }
              />
            )}
          </div>
        </>
      )}

      {/* controls: lens + direction + search */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-md border overflow-hidden" title={tt(T.signalsLensHint, lang)}>
          {([
            ["composite", T.signalsLensComposite],
            ["tech", T.signalsLensTech],
            ["fund", T.signalsLensFund],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setLens(key)}
              className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                lens === key ? "bg-primary text-primary-foreground" : "hover:bg-accent/50"
              }`}
            >
              {tt(label, lang)}
            </button>
          ))}
        </div>
        <div className="flex rounded-md border overflow-hidden">
          <button
            onClick={() => setDir("bull")}
            className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
              dir === "bull" ? "bg-primary text-primary-foreground" : "hover:bg-accent/50"
            }`}
          >
            {tt(T.signalsBullTop, lang)}
          </button>
          <button
            onClick={() => setDir("bear")}
            className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
              dir === "bear" ? "bg-primary text-primary-foreground" : "hover:bg-accent/50"
            }`}
          >
            {tt(T.signalsBearTop, lang)}
          </button>
        </div>
        <div className="relative flex-1 min-w-40 max-w-64">
          <Search className="absolute inset-y-0 start-2 my-auto h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tt(T.signalsSearchPh, lang)}
            className="h-8 w-full rounded-md border bg-card ps-7 pe-2 text-xs"
            aria-label={tt(T.signalsSearchPh, lang)}
          />
        </div>
      </div>

      {/* ranked table */}
      <section className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full text-xs min-w-[1040px]">
            <thead className="border-b bg-secondary/40">
              <tr className="text-[11px] text-muted-foreground">
                <th className="text-start font-medium px-2 py-2 w-8">{tt(T.signalsRank, lang)}</th>
                <th className="text-start font-medium px-2 py-2">{tt(T.colTicker, lang)}</th>
                <th className="text-end font-medium px-2 py-2">{tt(T.techColValue, lang)}</th>
                <th className="text-end font-medium px-2 py-2">%</th>
                <th className="text-center font-medium px-2 py-2">{tt(T.techColSignal, lang)}</th>
                <th className="text-start font-medium px-2 py-2">{tt(T.signalsColScore, lang)}</th>
                <th className="text-end font-medium px-2 py-2" title={tt(T.signalsLensTech, lang)}>T</th>
                <th className="text-end font-medium px-2 py-2" title={tt(T.signalsLensFund, lang)}>F</th>
                <th className="text-end font-medium px-2 py-2">{tt(T.signalsColPe, lang)}</th>
                <th className="text-end font-medium px-2 py-2">{tt(T.signalsColRoe, lang)}</th>
                <th className="text-end font-medium px-2 py-2 hidden lg:table-cell">{tt(T.signalsColDiv, lang)}</th>
                <th className="text-end font-medium px-2 py-2">{tt(T.signalsColRsi, lang)}</th>
                <th className="text-end font-medium px-2 py-2">52w</th>
                <th className="text-end font-medium px-2 py-2 hidden xl:table-cell">1M</th>
                <th className="text-end font-medium px-2 py-2 hidden xl:table-cell">{tt(T.signalsColEarnings, lang)}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r, i) => {
                const s = lensScore(r);
                return (
                <tr
                  key={r.ticker}
                  className="hover:bg-accent/30 transition-colors cursor-pointer"
                  onClick={() => navigate("company", { ticker: r.ticker, panel: "technical" })}
                >
                  <td className="num px-2 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-2">
                    <span className="num font-bold">{r.ticker}</span>
                    <span className="block text-[10px] text-muted-foreground truncate max-w-36">{dn(r, lang)}</span>
                  </td>
                  <td className="num px-2 py-2 text-end font-medium">{fmtNum(r.close)}</td>
                  <td className={`num px-2 py-2 text-end ${directionClass(r.changePct)}`}>{fmtPct(r.changePct)}</td>
                  <td className="px-2 py-2 text-center">
                    <RatingBadgeL rating={r.compositeRating} lang={lang} />
                  </td>
                  <td className="px-2 py-2">
                    {s === null ? (
                      <span className="num text-[10px] text-muted-foreground">—</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <ScoreBar score={s} />
                        <span className="num text-[10px] text-muted-foreground">{fmtNum(s, 2)}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-end"><ScoreCell score={r.score} /></td>
                  <td className="px-2 py-2 text-end"><ScoreCell score={r.fundScore} /></td>
                  <td
                    className={`num px-2 py-2 text-end ${
                      r.pe === null ? "text-muted-foreground" : r.pe <= 0 ? "text-down" : ""
                    }`}
                  >
                    {r.pe !== null ? (r.pe > 0 ? fmtNum(r.pe, 1) : "×") : "—"}
                  </td>
                  <td
                    className={`num px-2 py-2 text-end ${
                      r.roe === null ? "text-muted-foreground" : r.roe > 15 ? "text-up" : r.roe < 5 ? "text-down" : ""
                    }`}
                  >
                    {r.roe !== null ? `${fmtNum(r.roe, 0)}%` : "—"}
                  </td>
                  <td className="num px-2 py-2 text-end hidden lg:table-cell text-muted-foreground">
                    {r.divYield !== null && r.divYield > 0 ? `${fmtNum(r.divYield, 1)}%` : "—"}
                  </td>
                  <td
                    className={`num px-2 py-2 text-end ${
                      r.rsi === null ? "text-muted-foreground" : r.rsi < 30 ? "text-up" : r.rsi > 70 ? "text-down" : ""
                    }`}
                  >
                    {r.rsi !== null ? fmtNum(r.rsi, 1) : "—"}
                  </td>
                  <td className="num px-2 py-2 text-end text-muted-foreground">
                    {r.pos52 !== null ? `${fmtNum(r.pos52, 0)}%` : "—"}
                  </td>
                  <td className={`num px-2 py-2 text-end hidden xl:table-cell ${directionClass(r.perf1M ?? 0)}`}>
                    {r.perf1M !== null ? fmtPct(r.perf1M) : "—"}
                  </td>
                  <td className="num px-2 py-2 text-end hidden xl:table-cell text-muted-foreground">
                    {r.nextEarnings ?? "—"}
                  </td>
                </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={15} className="px-3 py-6 text-center text-muted-foreground">
                    {tt(T.signalsEmptyFilter, lang)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
        </>
      )}
    </div>
  );
}
