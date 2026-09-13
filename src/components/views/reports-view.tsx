"use client";

/** Market Desk Reports view (Task 22) — the hourly / end-of-day "what could
 *  surge next" briefing. Serves the SHARED reports from /api/reports (one
 *  LLM call + a few web searches per report, cached for every visitor —
 *  free to read, always): the desk's market read, the surge candidates with
 *  evidence-backed reasons and attributed web catalysts, the charter's ATR
 *  levels, today's timeline and the archive of past end-of-day reports.
 *  Deep-linkable via ?view=reports&id=<reportId>. */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/market/app-context";
import { useLiveData } from "@/components/market/use-live-data";
import { T, tt } from "@/lib/i18n";
import { fmtNum } from "@/lib/format";
import { bootParam, patchUrlParams } from "@/lib/url-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ExportXlsxButton } from "@/components/market/export-xlsx-button";
import {
  AlertTriangle, ChevronDown, ChevronUp, Clock, ExternalLink, FileClock, Flame,
  Globe, Newspaper, Sparkles, TrendingUp,
} from "lucide-react";
import type { ReportsResponse, ReportRow, ReportMover } from "@/lib/hourly-report";

type Response = ReportsResponse & { error?: string };

const BIAS_CLS: Record<string, string> = {
  bullish: "bg-up text-up-foreground",
  bearish: "bg-down text-down-foreground",
  neutral: "bg-secondary text-muted-foreground",
};

const POTENTIAL_CLS: Record<string, string> = {
  high: "bg-up-soft text-up",
  medium: "bg-accent text-accent-foreground",
  low: "bg-secondary text-muted-foreground",
};

function Stars({ n }: { n: number }) {
  return (
    <span className="num tracking-tight" dir="ltr" aria-label={`${n}/5`}>
      {"★".repeat(n)}
      <span className="text-muted-foreground/50">{"★".repeat(Math.max(0, 5 - n))}</span>
    </span>
  );
}

function LevelBox({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-md border bg-secondary/30 px-2 py-1.5 text-center min-w-16">
      <p className="text-[9px] text-muted-foreground leading-none mb-1">{label}</p>
      <p className={`num text-xs font-bold leading-none ${cls ?? ""}`}>{value}</p>
    </div>
  );
}

function CatalystChip({ c, lang }: { c: ReportMover["catalysts"][number]; lang: "ar" | "en" }) {
  const text = lang === "ar" ? (c.textAr ?? c.text) : c.text;
  const inner = (
    <>
      <Newspaper className="h-3 w-3 shrink-0" aria-hidden />
      <span className="flex-1 leading-snug">{text}</span>
      {c.source && <span className="shrink-0 rounded-sm bg-secondary/80 px-1 py-0.5 text-[9px] num" dir="ltr">{c.source}</span>}
    </>
  );
  return c.url ? (
    <a
      href={c.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-1.5 rounded-md border bg-card px-2 py-1.5 text-[10px] hover:bg-accent/40 transition-colors"
      title={c.date ? `${c.source} · ${c.date}` : c.source}
    >
      {inner}
      <ExternalLink className="h-2.5 w-2.5 shrink-0 text-muted-foreground" aria-hidden />
    </a>
  ) : (
    <div className="flex items-start gap-1.5 rounded-md border bg-card px-2 py-1.5 text-[10px]" title={c.date ? `${c.source} · ${c.date}` : c.source}>
      {inner}
    </div>
  );
}

function MoverCard({ m, lang, onOpen }: { m: ReportMover; lang: "ar" | "en"; onOpen: () => void }) {
  const reasons = (lang === "ar" ? m.reasonsAr : m.reasonsEn).filter(Boolean);
  const potentialLabel =
    m.surgePotential === "high" ? T.reportsPotentialHigh : m.surgePotential === "low" ? T.reportsPotentialLow : T.reportsPotentialMedium;
  return (
    <article className="rounded-lg border bg-card overflow-hidden">
      {/* header band — potential-colored stripe */}
      <div className={`h-1 ${m.surgePotential === "high" ? "bg-up" : m.surgePotential === "medium" ? "bg-accent" : "bg-secondary"}`} aria-hidden />
      <div className="p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <button onClick={onOpen} className="text-start text-base font-bold hover:text-primary transition-colors">
            <span className="num">{m.ticker}</span>{" "}
            <span className="text-xs font-medium text-muted-foreground">{lang === "ar" ? m.nameAr : m.nameEn}</span>
          </button>
          <span className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[10px] font-semibold ${POTENTIAL_CLS[m.surgePotential]}`}>
            {m.surgePotential === "high" ? <Flame className="h-3 w-3" aria-hidden /> : <TrendingUp className="h-3 w-3" aria-hidden />}
            {tt(T.reportsPotential, lang)}: {tt(potentialLabel, lang)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap text-[11px] text-muted-foreground">
          <span className="num">
            {fmtNum(m.close)} EGP · <span className={m.changePct >= 0 ? "text-up" : "text-down"}>{m.changePct >= 0 ? "+" : ""}{fmtNum(m.changePct)}%</span>
          </span>
          <span className="num">{tt(T.reportsConviction, lang)} <Stars n={m.conviction} /></span>
          <span className="num">
            {tt(T.reportsCharterScore, lang)}{" "}
            <span className={m.charterScore !== null && m.charterScore >= 0 ? "text-up" : "text-down"}>
              {m.charterScore !== null ? fmtNum(m.charterScore, 2) : "—"}
            </span>
          </span>
          <span className="num">{tt(T.reportsHorizon, lang)} {m.horizonSessions}</span>
        </div>

        {m.entry !== null && (
          <div className="flex items-stretch gap-1.5 flex-wrap">
            <LevelBox label={tt(T.reportsEntry, lang)} value={fmtNum(m.entry)} />
            <LevelBox label={tt(T.reportsStop, lang)} value={fmtNum(m.stop)} cls="text-down" />
            <LevelBox label={tt(T.reportsTarget, lang)} value={fmtNum(m.target)} cls="text-up" />
            {m.rr !== null && <LevelBox label={tt(T.reportsRr, lang)} value={`1:${fmtNum(m.rr, 1)}`} />}
          </div>
        )}

        {reasons.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground">{tt(T.reportsReasons, lang)}</p>
            <ol className="space-y-1">
              {reasons.map((r, i) => (
                <li key={i} className="flex gap-1.5 text-xs leading-relaxed">
                  <span className="num shrink-0 mt-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-secondary text-[9px] font-semibold text-muted-foreground" aria-hidden>
                    {i + 1}
                  </span>
                  <span>{r}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {m.catalysts.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground">{tt(T.reportsCatalysts, lang)}</p>
            <div className="grid gap-1.5">
              {m.catalysts.map((c, i) => (
                <CatalystChip key={i} c={c} lang={lang} />
              ))}
            </div>
          </div>
        )}

        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground border-t border-border/60 pt-2">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-down/80" aria-hidden />
          <span><span className="font-medium">{tt(T.reportsRiskLine, lang)}: </span>{lang === "ar" ? m.riskAr : m.riskEn}</span>
        </p>
      </div>
    </article>
  );
}

export function ReportsView() {
  const { lang, navigate, status } = useApp();
  const { data, error, loading, refresh } = useLiveData<Response>("/api/reports?wait=0", 90_000);
  const [archived, setArchived] = useState<ReportRow | null>(null);
  const [archivedId, setArchivedId] = useState<string | null>(null);
  const [archLoading, setArchLoading] = useState(false);
  const [howOpen, setHowOpen] = useState(false);

  // restore a deep-linked archived report (?id=) once on mount — a one-time
  // boot restore of a shared link's state (same pattern as the agent's ?q=)
  useEffect(() => {
    const id = bootParam("id");
    if (id) setArchivedId(id.slice(0, 64));
  }, []);

  // fetch the archived report when an id is selected (async → setState only
  // in callbacks; clearing the id simply makes `archived` irrelevant)
  useEffect(() => {
    if (!archivedId) return;
    let cancelled = false;
    void (async () => {
      setArchLoading(true);
      try {
        const res = await fetch(`/api/reports?id=${encodeURIComponent(archivedId)}`);
        const json = res.ok ? ((await res.json()) as { report?: ReportRow }) : null;
        if (!cancelled) setArchived(json?.report ?? null);
      } catch {
        // keep whatever we had — the pill can be re-tapped to retry
      } finally {
        if (!cancelled) setArchLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [archivedId]);

  const selectReport = (id: string | null) => {
    setArchivedId(id);
    patchUrlParams({ id });
  };

  const latest = data?.latest ?? null;
  // an archived report is shown ONLY while an id is selected — going "back
  // to latest" simply drops the id, the fetched row becomes irrelevant
  const report = archivedId ? archived : latest;
  const isArchived = !!archivedId;

  const asOfLabel = useMemo(() => {
    const iso = report?.generatedAt;
    if (!iso) return "";
    return new Date(iso).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [report?.generatedAt, lang]);

  // timeline: today's reports (hourlies + the eod) chronological, then past EODs
  const history = data?.history ?? [];
  const sessionLabel = status?.lastSession ?? report?.session ?? "";
  const todays = history
    .filter((h) => h.session === sessionLabel)
    .sort((a, b) => (a.kind === "eod" ? 1 : b.kind === "eod" ? -1 : a.hourLabel < b.hourLabel ? -1 : 1));
  const pastEod = history.filter((h) => h.kind === "eod" && h.session !== sessionLabel);

  if (loading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <section className="rounded-lg border bg-card p-6 text-center space-y-3">
        <p className="text-sm font-medium">{tt(T.reportsError, lang)}</p>
        <Button size="sm" variant="outline" onClick={() => void refresh()}>
          {tt(T.retry, lang)}
        </Button>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {/* header */}
      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <FileClock className="h-4.5 w-4.5 text-primary" aria-hidden />
            {tt(T.reportsTitle, lang)}
          </h1>
          <div className="flex items-center gap-2">
            {report && <ExportXlsxButton report="hourly" payload={{ id: report.id }} />}
            {asOfLabel && (
              <span className="num text-[11px] text-muted-foreground">
                {tt(T.reportsAsOf, lang)} {asOfLabel}
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl">{tt(T.reportsSubtitle, lang)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {report && (
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${report.kind === "eod" ? "bg-up-soft text-up" : "bg-primary/10 text-primary"}`}>
              <Clock className="h-3 w-3" aria-hidden />
              {report.kind === "eod" ? tt(T.reportsEodBadge, lang) : `${tt(T.reportsHourlyBadge, lang)}${report.hourLabel ? ` · ${report.hourLabel}` : ""}`}
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full border bg-secondary/60 px-2 py-0.5 text-[10px] text-muted-foreground">
            <Sparkles className="h-3 w-3" aria-hidden />
            {tt(T.agentModelBadge, lang)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border bg-secondary/60 px-2 py-0.5 text-[10px] text-muted-foreground">
            <Globe className="h-3 w-3" aria-hidden />
            {tt(T.aiSignalsSharedNote, lang)}
          </span>
          <span className={`num inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${status?.open ? "text-up bg-up-soft/50" : "text-muted-foreground bg-secondary"}`}>
            {status?.open ? tt(T.reportsNextWhileOpen, lang) : tt(T.reportsNextAfterClose, lang)}
          </span>
        </div>
      </section>

      {report ? (
        <>
          {/* archived banner */}
          {isArchived && (
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-secondary/40 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">
                {tt(T.reportsViewing, lang)} · <span className="num">{report.session}{report.hourLabel ? ` · ${report.hourLabel}` : ""}</span>
              </p>
              <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => selectReport(null)}>
                {tt(T.reportsBackLatest, lang)}
              </Button>
            </div>
          )}

          {/* market read */}
          <section className="rounded-lg border bg-card p-4 space-y-2">
            <p className="text-sm font-semibold">{tt(T.reportsMarketRead, lang)}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-block rounded-sm px-2.5 py-1 text-xs font-bold ${BIAS_CLS[report.marketBias.direction] ?? BIAS_CLS.neutral}`}>
                {tt(
                  report.marketBias.direction === "bullish"
                    ? T.signalsBiasBull
                    : report.marketBias.direction === "bearish"
                      ? T.signalsBiasBear
                      : T.signalsBiasNeutral,
                  lang
                )}
              </span>
              <span className="num text-xs text-muted-foreground">
                {tt(T.reportsConviction, lang)} <Stars n={report.marketBias.conviction} />
              </span>
              <span className="num text-[11px] text-muted-foreground">{report.scanned} {tt(T.signalsScanCount, lang)}</span>
            </div>
            <p className="text-xs leading-relaxed">{lang === "ar" ? report.marketBias.summaryAr : report.marketBias.summaryEn}</p>
            {(lang === "ar" ? report.webNotesAr : report.webNotesEn) && (
              <p className="flex items-start gap-1.5 rounded-md border bg-accent/20 px-2.5 py-2 text-[11px] leading-relaxed">
                <Globe className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
                <span><span className="font-semibold">{tt(T.reportsWebNotes, lang)}: </span>{lang === "ar" ? report.webNotesAr : report.webNotesEn}</span>
              </p>
            )}
          </section>

          {/* movers */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <p className="text-sm font-semibold">{tt(T.reportsMoversTitle, lang)}</p>
              <span className="text-[11px] text-muted-foreground">{tt(T.reportsMoversNote, lang)}</span>
            </div>
            {report.movers.length === 0 ? (
              <p className="rounded-lg border bg-card p-4 text-xs text-muted-foreground leading-relaxed">
                {tt(T.reportsEmptyMovers, lang)}
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {report.movers.map((m) => (
                  <MoverCard key={m.ticker} m={m} lang={lang} onOpen={() => navigate("company", { ticker: m.ticker, panel: "technical" })} />
                ))}
              </div>
            )}
            {report.sources.length > 0 && (
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                <span className="font-medium">{tt(T.reportsSources, lang)}: </span>
                <span className="num" dir="ltr">{report.sources.join(" · ")}</span>
              </p>
            )}
          </section>

          {/* today's timeline + past EOD archive */}
          {(todays.length > 0 || pastEod.length > 0) && (
            <section className="rounded-lg border bg-card p-4 space-y-3">
              {todays.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <p className="text-sm font-semibold">{tt(T.reportsTimeline, lang)} <span className="num text-[11px] font-normal text-muted-foreground">{sessionLabel}</span></p>
                    <span className="text-[10px] text-muted-foreground">{tt(T.reportsTimelineNote, lang)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {todays.map((h) => {
                      const active = (isArchived ? archivedId : latest?.id) === h.id;
                      return (
                        <button
                          key={h.id}
                          onClick={() => selectReport(h.id)}
                          className={`num inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                            active ? "border-primary bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:bg-accent/40"
                          }`}
                          aria-pressed={active}
                        >
                          {h.kind === "eod" ? tt(T.reportsEodBadge, lang) : h.hourLabel}
                          <span className="text-[9px] opacity-70">{h.movers}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {pastEod.length > 0 && (
                <div className="space-y-1.5 border-t border-border/60 pt-3">
                  <p className="text-xs font-semibold text-muted-foreground">{tt(T.reportsPastEod, lang)}</p>
                  <ul className="max-h-40 overflow-y-auto thin-scroll">
                    {pastEod.map((h) => {
                      const active = (isArchived ? archivedId : latest?.id) === h.id;
                      return (
                        <li key={h.id}>
                          <button
                            onClick={() => selectReport(h.id)}
                            className={`num w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors ${
                              active ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:bg-accent/40"
                            }`}
                          >
                            <span>{new Date(h.createdAt).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short" })} · {h.session}</span>
                            <span className="text-[9px] opacity-70">{h.movers}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </section>
          )}

          {/* how it works */}
          <section className="rounded-lg border bg-card overflow-hidden">
            <button
              onClick={() => setHowOpen((o) => !o)}
              className="w-full flex items-center justify-between px-4 py-3 text-start hover:bg-accent/40 transition-colors"
              aria-expanded={howOpen}
            >
              <span className="text-sm font-semibold">{tt(T.reportsHowTitle, lang)}</span>
              {howOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {howOpen && (
              <div className="px-4 pb-4 space-y-2">
                <p className="text-[11px] text-muted-foreground leading-relaxed">{tt(T.reportsHowNote, lang)}</p>
                {data?.meta && (
                  <pre dir="ltr" className="text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap font-mono bg-secondary/30 rounded-md p-3 max-h-80 overflow-y-auto thin-scroll">
                    {data.meta.charter}
                  </pre>
                )}
                <p className="num text-[10px] text-muted-foreground/70">
                  rev {data?.meta?.reportRev} · {report.llmMs}ms · {report.webSearches} searches · {report.model}
                </p>
              </div>
            )}
          </section>

          <p className="text-[10px] text-muted-foreground leading-relaxed">{tt(T.reportsDisclaimer, lang)}</p>
        </>
      ) : archLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <section className="rounded-lg border bg-card p-6 text-center space-y-3">
          <p className="text-sm text-muted-foreground leading-relaxed">{tt(T.reportsWarming, lang)}</p>
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            {tt(T.updated, lang)}
          </Button>
        </section>
      )}
    </div>
  );
}
