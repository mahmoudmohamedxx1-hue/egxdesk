"use client";

/** Signals tab — "the best signals across the stocks": one ranked table of
 *  the whole EGX universe by the 13-indicator technical rating (the same
 *  engine as the company Technical Panel), with a market-bias summary, the
 *  strongest bullish/bearish call-outs, rating filters, search and CSV.
 *  Arabic-first, honest labeling, one tap into the stock's technical panel. */

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
        <RatingBadgeL rating={r.rating} lang={lang} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {driverChips(r, lang).map((c) => (
          <span key={c} className="num rounded-sm bg-secondary/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {c}
          </span>
        ))}
      </div>
      <p className="num text-xs text-muted-foreground">
        {fmtNum(r.close)} EGP · <span className={directionClass(r.changePct)}>{fmtPct(r.changePct)}</span> ·{" "}
        {tt(T.signalsColScore, lang)} {fmtNum(r.score, 2)}
      </p>
    </button>
  );
}

export function SignalsView() {
  const { lang, navigate, toast } = useApp();
  const { data, error, loading } = useLiveData<SignalsResponse>("/api/signals", 5 * 60_000);
  const [mode, setMode] = useState<"tech" | "ai">("tech");
  const [dir, setDir] = useState<"bull" | "bear">("bull");
  const [filter, setFilter] = useState<Rating | "all">("all");
  const [q, setQ] = useState("");

  // 21-c — shareable state: ?view=signals&mode=ai&dir=bear&rating=buy
  useEffect(() => {
    const m = bootParam("mode");
    if (m === "tech" || m === "ai") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode(m);
    }
    const d = bootParam("dir");
    if (d === "bull" || d === "bear") setDir(d);
    const r = bootParam("rating");
    if (r && (RATING_ORDER as string[]).includes(r)) setFilter(r as Rating);
  }, []);
  useEffect(() => {
    patchUrlParams({
      mode: mode === "tech" ? null : mode,
      dir: dir === "bull" ? null : dir,
      rating: filter === "all" ? null : filter,
    });
  }, [mode, dir, filter]);

  const stats = useMemo(() => {
    if (!data?.rows) return null;
    const counts: Record<Rating, number> = { strongBuy: 0, buy: 0, neutral: 0, sell: 0, strongSell: 0 };
    let sum = 0;
    for (const r of data.rows) {
      counts[r.rating]++;
      sum += r.score;
    }
    const avg = data.rows.length ? sum / data.rows.length : 0;
    const bull = counts.strongBuy + counts.buy;
    const bear = counts.strongSell + counts.sell;
    return { counts, avg, bull, bear, total: data.rows.length };
  }, [data]);

  const rows = useMemo(() => {
    if (!data?.rows) return [];
    let list = data.rows;
    if (filter !== "all") list = list.filter((r) => r.rating === filter);
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
    return dir === "bull" ? list : [...list].reverse();
  }, [data, filter, q, dir]);

  const exportCsv = () => {
    if (!data?.rows.length) return;
    const headers = [
      "#", "ticker", "name (ar)", "sector (ar)", "close EGP", "day %", "rating", "score",
      "buy", "neutral", "sell", "RSI", "MACD hist", "SMA50", "SMA200",
      "above SMA50", "above SMA200", "52w position %", "vol x avg", "perf 1M %", "perf 6M %", "perf YTD %", "next earnings",
    ];
    downloadCsv(`egx-signals-${fileStamp()}`, headers, data.rows.map((r, i) => [
      i + 1, r.ticker, r.nameAr, r.sectorAr, r.close, r.changePct, r.rating, r.score,
      r.buy, r.neutral, r.sell, r.rsi, r.macdHist, r.sma50, r.sma200,
      r.sma50Sig === "buy" ? 1 : 0, r.sma200Sig === "buy" ? 1 : 0, r.pos52, r.volRatio,
      r.perf1M, r.perf6M, r.perfYTD, r.nextEarnings ?? "",
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

  return (
    <div className="space-y-5">
      {/* header + mode switch (technical scan | AI signals) */}
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

      {/* controls */}
      <div className="flex items-center gap-2 flex-wrap">
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
          <table className="w-full text-xs min-w-[860px]">
            <thead className="border-b bg-secondary/40">
              <tr className="text-[11px] text-muted-foreground">
                <th className="text-start font-medium px-2 py-2 w-8">{tt(T.signalsRank, lang)}</th>
                <th className="text-start font-medium px-2 py-2">{tt(T.colTicker, lang)}</th>
                <th className="text-end font-medium px-2 py-2">{tt(T.techColValue, lang)}</th>
                <th className="text-end font-medium px-2 py-2">%</th>
                <th className="text-center font-medium px-2 py-2">{tt(T.techColSignal, lang)}</th>
                <th className="text-start font-medium px-2 py-2">{tt(T.signalsColScore, lang)}</th>
                <th className="text-end font-medium px-2 py-2">{tt(T.signalsColRsi, lang)}</th>
                <th className="text-end font-medium px-2 py-2">{tt(T.signalsColMacd, lang)}</th>
                <th className="text-center font-medium px-2 py-2">{tt(T.signalsColSma, lang)}</th>
                <th className="text-end font-medium px-2 py-2">52w</th>
                <th className="text-end font-medium px-2 py-2 hidden lg:table-cell">{tt(T.signalsColVol, lang)}</th>
                <th className="text-end font-medium px-2 py-2 hidden lg:table-cell">1M</th>
                <th className="text-end font-medium px-2 py-2 hidden xl:table-cell">{tt(T.signalsColEarnings, lang)}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r, i) => (
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
                    <RatingBadgeL rating={r.rating} lang={lang} />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <ScoreBar score={r.score} />
                      <span className="num text-[10px] text-muted-foreground">{fmtNum(r.score, 2)}</span>
                    </div>
                  </td>
                  <td
                    className={`num px-2 py-2 text-end ${
                      r.rsi === null ? "text-muted-foreground" : r.rsi < 30 ? "text-up" : r.rsi > 70 ? "text-down" : ""
                    }`}
                  >
                    {r.rsi !== null ? fmtNum(r.rsi, 1) : "—"}
                  </td>
                  <td
                    className={`num px-2 py-2 text-end ${
                      r.macdHist === null ? "text-muted-foreground" : r.macdHist > 0 ? "text-up" : "text-down"
                    }`}
                  >
                    {r.macdHist !== null ? fmtNum(r.macdHist, 2) : "—"}
                  </td>
                  <td className="px-2 py-2 text-center text-[10px] whitespace-nowrap">
                    <span className={r.sma50Sig === "buy" ? "text-up" : r.sma50Sig === "sell" ? "text-down" : "text-muted-foreground"}>
                      50{r.sma50Sig === "buy" ? "↑" : r.sma50Sig === "sell" ? "↓" : "·"}
                    </span>
                    <span className="mx-1 text-muted-foreground">/</span>
                    <span className={r.sma200Sig === "buy" ? "text-up" : r.sma200Sig === "sell" ? "text-down" : "text-muted-foreground"}>
                      200{r.sma200Sig === "buy" ? "↑" : r.sma200Sig === "sell" ? "↓" : "·"}
                    </span>
                  </td>
                  <td className="num px-2 py-2 text-end text-muted-foreground">
                    {r.pos52 !== null ? `${fmtNum(r.pos52, 0)}%` : "—"}
                  </td>
                  <td className="num px-2 py-2 text-end hidden lg:table-cell text-muted-foreground">
                    {r.volRatio !== null ? `×${fmtNum(r.volRatio, 1)}` : "—"}
                  </td>
                  <td className={`num px-2 py-2 text-end hidden lg:table-cell ${directionClass(r.perf1M ?? 0)}`}>
                    {r.perf1M !== null ? fmtPct(r.perf1M) : "—"}
                  </td>
                  <td className="num px-2 py-2 text-end hidden xl:table-cell text-muted-foreground">
                    {r.nextEarnings ?? "—"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-6 text-center text-muted-foreground">
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
