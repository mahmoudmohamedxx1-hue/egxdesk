"use client";

/** AI Signals panel (Task 20 → T42 multi-strategy) — the AI section inside
 *  the Signals tab. Serves the SHARED signal set from /api/ai-signals (one
 *  LLM call per cycle for all users — free and unlimited to read) with the
 *  12-strategy ensemble's market read, consensus-ranked trade ideas carrying
 *  the fired-strategy chips and agreement meter, fixed ATR risk levels, the
 *  walk-forward backtest evidence (ensemble + per-strategy), and the full
 *  strategy charter. */

import { useMemo, useState } from "react";
import { useApp } from "@/components/market/app-context";
import { useLiveData } from "@/components/market/use-live-data";
import { T, tt } from "@/lib/i18n";
import { fmtNum } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ExportXlsxButton } from "@/components/market/export-xlsx-button";
import { BrainCircuit, Calculator, ChevronDown, ChevronUp, History, Layers, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import type { AiSignalsResponse, AiPick } from "@/lib/ai-signals";
import type { TrackRecord, TrackedSignal } from "@/lib/signal-track";
import { STRATEGY_REGISTRY, strategyById } from "@/lib/strategies";

type Response = AiSignalsResponse & { error?: string };

/** One row of the per-strategy standalone backtest (backtest.json perStrategy). */
type PerStrategyRow = {
  id: string;
  nameAr: string;
  nameEn: string;
  family: string;
  backtested: boolean;
  note?: string;
  stats?: {
    trades: number;
    hitRate: number;
    avgNetPct: number;
    profitFactor: number | null;
    strategyCumPct: number;
    benchCumPct: number;
    maxDrawdownPct: number;
    medianNetPct: number;
  };
};

const BIAS_CLS: Record<string, string> = {
  bullish: "bg-up text-up-foreground",
  bearish: "bg-down text-down-foreground",
  neutral: "bg-secondary text-muted-foreground",
};

const RISK_CLS: Record<string, string> = {
  low: "bg-up-soft text-up",
  medium: "bg-secondary text-muted-foreground",
  high: "bg-down-soft text-down",
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

/** Agreement meter — how many of the counted strategies vote for the pick's
 *  stance. 12 segments; filled = supporting votes, dimmed = the rest. */
function AgreementMeter({ long, total, stance, lang }: { long: number; total: number; stance: "long" | "avoid"; lang: "ar" | "en" }) {
  const n = Math.max(0, Math.min(12, total));
  const votes = Math.max(0, Math.min(n, long));
  return (
    <span className="inline-flex items-center gap-1.5" dir="ltr" title={`${votes}/${n} ${tt(T.aiSignalsVotes, lang)}`}>
      <span className="inline-flex gap-[2px]" aria-hidden>
        {Array.from({ length: n }, (_, i) => (
          <span
            key={i}
            className={`h-2.5 w-[5px] rounded-[1px] ${
              i < votes ? (stance === "long" ? "bg-up" : "bg-down") : "bg-secondary"
            }`}
          />
        ))}
      </span>
      <span className="num text-[10px] font-semibold text-muted-foreground">
        {votes}/{n}
      </span>
    </span>
  );
}

/** The fired-strategy chips — each chip is one of the 12 strategies whose
 *  trigger fired in the pick's stance direction (deterministic, machine-built). */
function StrategyChips({ ids, lang, stance }: { ids: string[]; lang: "ar" | "en"; stance: "long" | "avoid" }) {
  if (!ids.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => {
        const s = strategyById(id);
        if (!s) return null;
        return (
          <span
            key={id}
            title={`${tt(T.aiSignalsStrategiesFired, lang)} · ${lang === "ar" ? s.oneLineAr : s.oneLineEn}`}
            className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[9px] font-medium ${
              stance === "long" ? "bg-up-soft/70 text-up" : "bg-down-soft/70 text-down"
            }`}
          >
            {lang === "ar" ? s.nameAr : s.nameEn}
          </span>
        );
      })}
    </div>
  );
}

function PickCard({ p, lang, onOpen }: { p: AiPick; lang: "ar" | "en"; onOpen: () => void }) {
  const thesis = lang === "ar" ? p.thesisAr : p.thesisEn;
  const riskLabel =
    p.riskLevel === "low" ? T.aiSignalsRiskLow : p.riskLevel === "high" ? T.aiSignalsRiskHigh : T.aiSignalsRiskMedium;
  const votes = p.stance === "long" ? p.longVotes : p.avoidVotes;
  return (
    <button
      onClick={onOpen}
      className="text-start rounded-lg border bg-card p-4 space-y-2.5 hover:bg-accent/40 transition-colors w-full"
    >
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-base font-bold">
          <span className="num">{p.ticker}</span>{" "}
          <span className="text-xs font-medium text-muted-foreground">{p.nameAr && lang === "ar" ? p.nameAr : p.nameEn}</span>
        </p>
        <span
          className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[10px] font-semibold ${
            p.stance === "long" ? "bg-up-soft text-up" : "bg-down-soft text-down"
          }`}
        >
          {p.stance === "long" ? <TrendingUp className="h-3 w-3" aria-hidden /> : <TrendingDown className="h-3 w-3" aria-hidden />}
          {tt(p.stance === "long" ? T.aiSignalsStanceLong : T.aiSignalsStanceAvoid, lang)}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap text-[11px]">
        <span className="num text-muted-foreground">
          {tt(T.aiSignalsConviction, lang)} <Stars n={p.conviction} />
        </span>
        <span className="num text-muted-foreground">
          {tt(T.aiSignalsCharterScore, lang)} <span className={p.charterScore !== null && p.charterScore >= 0 ? "text-up" : "text-down"}>{p.charterScore !== null ? fmtNum(p.charterScore, 2) : "—"}</span>
        </span>
        <span className={`num rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${RISK_CLS[p.riskLevel]}`}>
          {tt(riskLabel, lang)}
        </span>
      </div>

      {/* T42 — ensemble agreement + the fired-strategy chips */}
      {p.applicable > 0 && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[10px] text-muted-foreground flex items-center gap-1.5">
            <Layers className="h-3 w-3" aria-hidden />
            {tt(T.aiSignalsAgreement, lang)}
            <AgreementMeter long={votes} total={p.applicable} stance={p.stance} lang={lang} />
          </span>
        </div>
      )}
      <StrategyChips ids={p.strategies ?? []} lang={lang} stance={p.stance} />

      {p.stance === "long" && p.entry !== null && (
        <div className="space-y-1.5">
          {/* T43 — the executable plan: limit-order zone, stop with its risk %,
              and the T1/T2/T3 scale-out ladder (legacy sets fall back to the
              flat entry/target pair they were persisted with) */}
          <div className="flex items-stretch gap-1.5 flex-wrap">
            {p.plan ? (
              <LevelBox label={tt(T.aiSignalsPlanZone, lang)} value={`${fmtNum(p.plan.zoneLo)}–${fmtNum(p.plan.zoneHi)}`} />
            ) : (
              <LevelBox label={tt(T.aiSignalsEntry, lang)} value={fmtNum(p.entry)} />
            )}
            <LevelBox label={tt(T.aiSignalsStop, lang)} value={fmtNum(p.stop)} cls="text-down" />
            {p.plan ? (
              <>
                <LevelBox label={tt(T.aiSignalsPlanT1, lang)} value={fmtNum(p.plan.t1)} cls="text-up" />
                <LevelBox label={tt(T.aiSignalsPlanT2, lang)} value={fmtNum(p.plan.t2)} cls="text-up" />
                <LevelBox label={tt(T.aiSignalsPlanT3, lang)} value={fmtNum(p.plan.t3)} cls="text-up" />
                <LevelBox label={tt(T.aiSignalsPlanRiskPct, lang)} value={`${fmtNum(p.plan.riskPct, 1)}%`} cls="text-down" />
              </>
            ) : (
              <>
                <LevelBox label={tt(T.aiSignalsTarget, lang)} value={fmtNum(p.target)} cls="text-up" />
                {p.rr !== null && <LevelBox label={tt(T.aiSignalsRr, lang)} value={`1:${fmtNum(p.rr, 1)}`} />}
              </>
            )}
          </div>
          {p.plan && (
            <p className="text-[10px] text-muted-foreground/80 leading-relaxed">{tt(T.aiSignalsPlanScaleOut, lang)}</p>
          )}
        </div>
      )}

      <p className="num text-[11px] text-muted-foreground">
        {fmtNum(p.close)} EGP · {tt(T.aiSignalsHorizon, lang)} {p.horizonSessions}
        {p.earningsRisk && (
          <span className="ms-1.5 rounded-sm bg-down-soft/60 text-down px-1 py-0.5 text-[9px]" title={tt(T.aiSignalsEarningsRisk, lang)}>
            {tt(T.aiSignalsEarningsRisk, lang)} {p.earningsRisk}
          </span>
        )}
      </p>

      <div className="flex flex-wrap gap-1">
        {p.evidence.slice(0, 6).map((e, i) => (
          <span key={i} className="num rounded-sm bg-secondary/70 px-1.5 py-0.5 text-[9px] text-muted-foreground" dir="ltr">
            {e}
          </span>
        ))}
      </div>

      <p className="text-xs leading-relaxed border-t border-border/60 pt-2">{thesis}</p>
    </button>
  );
}

function StatTile({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-md border bg-secondary/30 px-2.5 py-2 text-center">
      <p className="text-[9px] text-muted-foreground leading-none mb-1">{label}</p>
      <p className={`num text-sm font-bold leading-none ${cls ?? ""}`}>{value}</p>
    </div>
  );
}

// ── T43: position size calculator — turns a pick's plan into "how many
//    shares" for the reader's own account and risk budget. Pure client math
//    on the pick's served levels (entry/stop), persisted locally. ──

const SIZER_ACCOUNT_KEY = "egx-sizer-account";
const SIZER_RISK_KEY = "egx-sizer-risk";

function loadNum(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function PositionSizer({ picks, lang }: { picks: AiPick[]; lang: "ar" | "en" }) {
  const longs = useMemo(() => picks.filter((p) => p.stance === "long" && p.entry !== null && p.stop !== null), [picks]);
  const [account, setAccount] = useState<number>(() => loadNum(SIZER_ACCOUNT_KEY, 50_000));
  const [riskPct, setRiskPct] = useState<number>(() => loadNum(SIZER_RISK_KEY, 1));
  const [ticker, setTicker] = useState<string>(() => longs[0]?.ticker ?? "");
  const pick = longs.find((p) => p.ticker === ticker) ?? longs[0];

  const persist = (key: string, v: number) => {
    try {
      window.localStorage.setItem(key, String(v));
    } catch {
      /* private mode — calculator still works for this session */
    }
  };

  if (!longs.length || !pick || pick.entry === null || pick.stop === null) return null;
  const entry = pick.entry;
  const stop = pick.stop;
  const t2 = pick.plan?.t2 ?? pick.target ?? entry + 2 * (entry - stop);
  const riskBudget = (account * riskPct) / 100;
  const perShareRisk = entry - stop;
  let shares = perShareRisk > 0 ? Math.floor(riskBudget / perShareRisk) : 0;
  let capped = false;
  if (shares > 0 && shares * entry > account) {
    // the account can't fund the full risk-based size — trim to affordability
    shares = Math.floor(account / entry);
    capped = true;
  }
  const cost = shares * entry;
  const lossIfStopped = shares * perShareRisk;
  const gainAtT2 = shares * (t2 - entry);

  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <p className="text-sm font-semibold flex items-center gap-1.5">
        <Calculator className="h-4 w-4 text-primary" aria-hidden />
        {tt(T.aiSignalsSizerTitle, lang)}
      </p>
      <p className="text-[11px] text-muted-foreground leading-relaxed">{tt(T.aiSignalsSizerNote, lang)}</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
        <label className="space-y-1">
          <span className="text-[10px] text-muted-foreground">{tt(T.aiSignalsSizerAccount, lang)}</span>
          <input
            type="number"
            min={100}
            step={1000}
            value={account}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v > 0) {
                setAccount(v);
                persist(SIZER_ACCOUNT_KEY, v);
              }
            }}
            className="num w-full rounded-md border bg-background px-2 py-1.5 text-xs"
            dir="ltr"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-muted-foreground">
            {tt(T.aiSignalsSizerRiskPct, lang)} ({fmtNum(riskPct, 2)}%)
          </span>
          <input
            type="range"
            min={0.25}
            max={5}
            step={0.25}
            value={riskPct}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) {
                setRiskPct(v);
                persist(SIZER_RISK_KEY, v);
              }
            }}
            className="w-full accent-primary"
            dir="ltr"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-muted-foreground">{tt(T.aiSignalsSizerPick, lang)}</span>
          <select
            value={pick.ticker}
            onChange={(e) => setTicker(e.target.value)}
            className="num w-full rounded-md border bg-background px-2 py-1.5 text-xs"
          >
            {longs.map((p) => (
              <option key={p.ticker} value={p.ticker}>
                {p.ticker} · {fmtNum(p.entry)} → {fmtNum(p.stop)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
        <StatTile label={tt(T.aiSignalsSizerShares, lang)} value={fmtNum(shares, 0)} />
        <StatTile label={tt(T.aiSignalsSizerCost, lang)} value={`${fmtNum(cost, 0)}`} />
        <StatTile label={tt(T.aiSignalsSizerLoss, lang)} value={`${fmtNum(lossIfStopped, 0)}`} cls="text-down" />
        <StatTile label={tt(T.aiSignalsSizerUpside, lang)} value={`${fmtNum(gainAtT2, 0)}`} cls="text-up" />
      </div>
      {capped && (
        <p className="text-[10px] text-down-soft text-down leading-relaxed">{tt(T.aiSignalsSizerCapped, lang)}</p>
      )}
      <p className="num text-[10px] text-muted-foreground/70">
        {pick.ticker} · {tt(T.aiSignalsStop, lang)} {fmtNum(stop)} · {tt(T.aiSignalsPlanT2, lang)} {fmtNum(t2)}
      </p>
    </section>
  );
}

// ── T43: the published-signal track record — every past pick replayed
//    against the candles that followed it (target / stopped / expired /
//    open), with the honest "record grows from day one" note. ──

const STATUS_CLS: Record<TrackedSignal["status"], string> = {
  target: "bg-up-soft text-up",
  stopped: "bg-down-soft text-down",
  expired: "bg-secondary text-muted-foreground",
  open: "bg-primary/10 text-primary",
};

function statusLabel(s: TrackedSignal["status"], lang: "ar" | "en"): string {
  return tt(
    s === "target"
      ? T.aiSignalsTrackStatusTarget
      : s === "stopped"
        ? T.aiSignalsTrackStatusStopped
        : s === "expired"
          ? T.aiSignalsTrackStatusExpired
          : T.aiSignalsTrackStatusOpen,
    lang
  );
}

function TrackRecordSection({ tr, lang }: { tr: TrackRecord; lang: "ar" | "en" }) {
  const sinceLabel = useMemo(() => {
    if (!tr.since) return "";
    return new Date(tr.since).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }, [tr.since, lang]);
  const s = tr.summary;
  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <History className="h-4 w-4 text-primary" aria-hidden />
          {tt(T.aiSignalsTrackTitle, lang)}
        </p>
        {sinceLabel && (
          <span className="num text-[11px] text-muted-foreground">
            {tt(T.aiSignalsTrackSince, lang)} {sinceLabel}
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">{tt(T.aiSignalsTrackNote, lang)}</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
        <StatTile label={tt(T.aiSignalsTrackTracked, lang)} value={`${s.tracked}`} />
        <StatTile
          label={tt(T.aiSignalsTrackHitRate, lang)}
          value={s.hitRate !== null ? `${fmtNum(s.hitRate * 100, 0)}%` : "—"}
        />
        <StatTile
          label={tt(T.aiSignalsTrackAvgClosed, lang)}
          value={s.avgRetPct !== null ? `${s.avgRetPct > 0 ? "+" : ""}${fmtNum(s.avgRetPct, 2)}%` : "—"}
          cls={s.avgRetPct !== null && s.avgRetPct > 0 ? "text-up" : s.avgRetPct !== null ? "text-down" : undefined}
        />
        <StatTile
          label={tt(T.aiSignalsTrackAvgOpen, lang)}
          value={s.avgOpenRetPct !== null ? `${s.avgOpenRetPct > 0 ? "+" : ""}${fmtNum(s.avgOpenRetPct, 2)}%` : "—"}
          cls={s.avgOpenRetPct !== null && s.avgOpenRetPct > 0 ? "text-up" : undefined}
        />
      </div>
      {tr.signals.length > 0 ? (
        <div className="overflow-x-auto thin-scroll -mx-1 px-1">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-muted-foreground border-b border-border/60">
                <th className="text-start font-medium py-1 pe-2">{tt(T.aiSignalsTrackColIssue, lang)}</th>
                <th className="text-start font-medium px-1.5">{tt(T.aiSignalsTrackColTicker, lang)}</th>
                <th className="text-end font-medium px-1.5">{tt(T.aiSignalsTrackColEntry, lang)}</th>
                <th className="text-end font-medium px-1.5">{tt(T.aiSignalsTrackColLast, lang)}</th>
                <th className="text-end font-medium px-1.5">{tt(T.aiSignalsTrackColRet, lang)}</th>
                <th className="text-center font-medium px-1.5">{tt(T.aiSignalsTrackColStatus, lang)}</th>
                <th className="text-end font-medium ps-1.5">{tt(T.aiSignalsTrackColSessions, lang)}</th>
              </tr>
            </thead>
            <tbody>
              {tr.signals.map((t) => (
                <tr key={`${t.ticker}-${t.issuedAt}`} className="border-b border-border/30 last:border-0">
                  <td className="num py-1 pe-2 whitespace-nowrap">{t.issuedDate}</td>
                  <td className="px-1.5 font-medium">
                    <span className="num">{t.ticker}</span>
                  </td>
                  <td className="num text-end px-1.5">{fmtNum(t.entry)}</td>
                  <td className="num text-end px-1.5">{fmtNum(t.lastClose)}</td>
                  <td className={`num text-end px-1.5 ${t.retPct > 0 ? "text-up" : t.retPct < 0 ? "text-down" : ""}`}>
                    {t.retPct > 0 ? "+" : ""}
                    {fmtNum(t.retPct, 2)}%
                  </td>
                  <td className="text-center px-1.5">
                    <span
                      className={`inline-block rounded-sm px-1.5 py-0.5 text-[9px] font-semibold whitespace-nowrap ${STATUS_CLS[t.status]}`}
                      title={t.partialT1 ? tt(T.aiSignalsTrackPartial, lang) : undefined}
                    >
                      {statusLabel(t.status, lang)}
                      {t.partialT1 && t.status !== "target" ? " ·T1" : ""}
                    </span>
                  </td>
                  <td className="num text-end ps-1.5">{t.sessionsElapsed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {s.pending > 0 ? tt(T.aiSignalsTrackPending, lang) : tt(T.aiSignalsWarming, lang)}
        </p>
      )}
      {s.pending > 0 && tr.signals.length > 0 && (
        <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
          {s.pending} {tt(T.aiSignalsTrackPending, lang)}
        </p>
      )}
      {s.skipped > 0 && (
        <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
          {s.skipped} {tt(T.aiSignalsTrackSkipped, lang)}
        </p>
      )}
    </section>
  );
}

export function AiSignalsPanel() {
  const { lang, navigate } = useApp();
  const { data, error, loading, refresh } = useLiveData<Response>("/api/ai-signals?wait=75", 5 * 60_000);
  const [howOpen, setHowOpen] = useState(false);

  const bt = data?.backtest;
  const stats = bt?.stats;
  const perStrategy = (bt as { perStrategy?: PerStrategyRow[] } | undefined)?.perStrategy ?? [];
  const set = data?.set;
  const stale = data?.status === "stale";
  const generatedAt = set?.generatedAt ?? null;

  const asOfLabel = useMemo(() => {
    if (!generatedAt) return "";
    return new Date(generatedAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [generatedAt, lang]);

  if (loading && !data) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">{tt(T.aiSignalsWarming, lang)}</p>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <section className="rounded-lg border bg-card p-6 text-center space-y-3">
        <p className="text-sm font-medium">{tt(T.signalsError, lang)}</p>
        <Button size="sm" variant="outline" onClick={() => void refresh()}>
          {tt(T.signalsRetry, lang)}
        </Button>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {/* header */}
      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <BrainCircuit className="h-4.5 w-4.5 text-primary" aria-hidden />
            {tt(T.aiSignalsTitle, lang)}
          </h2>
          <div className="flex items-center gap-2">
            {/* 21-b — picks + bias + backtest evidence as a branded Excel report */}
            <ExportXlsxButton report="ai-signals" />
            {asOfLabel && (
              <span className="num text-[11px] text-muted-foreground">
                {tt(T.aiSignalsAsOf, lang)} {asOfLabel}
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl">{tt(T.aiSignalsNote, lang)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            <Sparkles className="h-3 w-3" aria-hidden />
            {tt(T.agentModelBadge, lang)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            <Layers className="h-3 w-3" aria-hidden />
            {tt(T.aiSignalsEnsembleBadge, lang)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border bg-secondary/60 px-2 py-0.5 text-[10px] text-muted-foreground">
            {tt(T.aiSignalsSharedNote, lang)}
          </span>
          {stale && (
            <span className="inline-flex items-center gap-1 rounded-full border bg-up-soft/40 px-2 py-0.5 text-[10px] text-up">
              {tt(T.aiSignalsStale, lang)}
            </span>
          )}
        </div>
      </section>

      {set ? (
        <>
          {/* market bias */}
          <section className="rounded-lg border bg-card p-4 space-y-2">
            <p className="text-sm font-semibold">{tt(T.aiSignalsBiasTitle, lang)}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-block rounded-sm px-2.5 py-1 text-xs font-bold ${BIAS_CLS[set.marketBias.direction] ?? BIAS_CLS.neutral}`}>
                {tt(
                  set.marketBias.direction === "bullish"
                    ? T.signalsBiasBull
                    : set.marketBias.direction === "bearish"
                      ? T.signalsBiasBear
                      : T.signalsBiasNeutral,
                  lang
                )}
              </span>
              <span className="num text-xs text-muted-foreground">
                {tt(T.aiSignalsConviction, lang)} <Stars n={set.marketBias.conviction} />
              </span>
            </div>
            <p className="text-xs leading-relaxed">{lang === "ar" ? set.marketBias.summaryAr : set.marketBias.summaryEn}</p>
          </section>

          {/* picks */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">{tt(T.aiSignalsPicksTitle, lang)}</p>
              <span className="num text-[11px] text-muted-foreground">
                {set.picks.length} · {set.scanned} {tt(T.signalsScanCount, lang)}
              </span>
            </div>
            {set.picks.length === 0 ? (
              <p className="rounded-lg border bg-card p-4 text-xs text-muted-foreground leading-relaxed">
                {tt(T.aiSignalsEmpty, lang)}
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {set.picks.map((p) => (
                  <PickCard
                    key={p.ticker}
                    p={p}
                    lang={lang}
                    onOpen={() => navigate("company", { ticker: p.ticker, panel: "technical" })}
                  />
                ))}
              </div>
            )}
            {/* T43 fix — the engine note is generated Arabic-only (notesAr);
                rendering it inside the EN view leaked Arabic script into the
                English page (live case: "الأسواق الحدودية…"). The note is a
                bonus AR commentary — EN readers keep the EN bias summary and
                theses, so it renders in the AR view only. */}
            {lang === "ar" && set.notesAr && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <span className="font-medium">{tt(T.aiSignalsNotes, lang)}: </span>
                {set.notesAr}
              </p>
            )}
          </section>

          {/* T43 — the "so what do I DO" layer: pick a signal, size it to the
              reader's own account and risk budget (pure client math) */}
          <PositionSizer picks={set.picks} lang={lang} />
        </>
      ) : (
        <p className="rounded-lg border bg-card p-4 text-xs text-muted-foreground leading-relaxed">
          {tt(T.aiSignalsWarming, lang)}
        </p>
      )}

      {/* T43 — the proof layer: every published signal replayed against the
          real candles that followed it */}
      {data?.trackRecord && <TrackRecordSection tr={data.trackRecord} lang={lang} />}

      {/* backtest evidence */}
      {stats && (
        <section className="rounded-lg border bg-card p-4 space-y-3">
          <p className="text-sm font-semibold">{tt(T.aiSignalsBacktestTitle, lang)}</p>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-1.5">
            <StatTile label={tt(T.aiSignalsBacktestHit, lang)} value={`${fmtNum(stats.hitRate * 100, 1)}%`} />
            <StatTile
              label={tt(T.aiSignalsBacktestExpectancy, lang)}
              value={`${stats.avgNetPct > 0 ? "+" : ""}${fmtNum(stats.avgNetPct, 2)}%`}
              cls={stats.avgNetPct > 0 ? "text-up" : "text-down"}
            />
            <StatTile label={tt(T.aiSignalsBacktestPf, lang)} value={stats.profitFactor !== null ? fmtNum(stats.profitFactor, 2) : "—"} />
            <StatTile
              label={tt(T.aiSignalsBacktestVsBench, lang)}
              value={`${fmtNum(stats.strategyCumPct, 0)}% / ${fmtNum(stats.benchCumPct, 0)}%`}
            />
            <StatTile label={tt(T.aiSignalsBacktestMaxDd, lang)} value={`${fmtNum(stats.maxDrawdownPct, 1)}%`} cls="text-down" />
            <StatTile
              label={`${stats.trades} ${tt(T.aiSignalsBacktestTrades, lang)} · ${stats.windows} ${tt(T.aiSignalsBacktestWindows, lang)}`}
              value={`${fmtNum(stats.medianNetPct, 2)}%`}
            />
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{tt(T.aiSignalsBacktestMethod, lang)}</p>
          <ul className="text-[10px] text-muted-foreground/80 leading-relaxed list-disc ps-4 space-y-0.5">
            {(bt?.notes ?? []).map((n, i) => (
              <li key={i} dir="ltr" className="text-start">
                {n}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-muted-foreground leading-relaxed border-t border-border/60 pt-2">
            {tt(T.aiSignalsDisclaimer, lang)}
          </p>
        </section>
      )}

      {/* T42 — per-strategy standalone backtest (each strategy's own picks,
          same walk-forward methodology) */}
      {perStrategy.length > 0 && (
        <section className="rounded-lg border bg-card p-4 space-y-2">
          <p className="text-sm font-semibold">{tt(T.aiSignalsPerStrategyTitle, lang)}</p>
          <div className="overflow-x-auto thin-scroll -mx-1 px-1">
            <table className="w-full text-[10px]" dir="ltr">
              <thead>
                <tr className="text-muted-foreground border-b border-border/60">
                  <th className="text-start font-medium py-1 pe-2">{lang === "ar" ? "الاستراتيجية" : "Strategy"}</th>
                  <th className="text-end font-medium px-1.5">{tt(T.aiSignalsBacktestTrades, lang)}</th>
                  <th className="text-end font-medium px-1.5">{tt(T.aiSignalsBacktestHit, lang)}</th>
                  <th className="text-end font-medium px-1.5">{tt(T.aiSignalsBacktestExpectancy, lang)}</th>
                  <th className="text-end font-medium px-1.5">{tt(T.aiSignalsBacktestPf, lang)}</th>
                  <th className="text-end font-medium ps-1.5">3y</th>
                </tr>
              </thead>
              <tbody>
                {perStrategy.map((s) => {
                  const meta = strategyById(s.id);
                  return (
                    <tr key={s.id} className="border-b border-border/30 last:border-0">
                      <td className="py-1 pe-2 whitespace-nowrap" title={meta ? (lang === "ar" ? meta.oneLineAr : meta.oneLineEn) : undefined}>
                        <span className="font-medium">{lang === "ar" ? s.nameAr : s.nameEn}</span>
                        <span className="ms-1 text-muted-foreground/60">{s.family}</span>
                      </td>
                      {s.backtested && s.stats ? (
                        <>
                          <td className="num text-end px-1.5">{s.stats.trades}</td>
                          <td className="num text-end px-1.5">{(s.stats.hitRate * 100).toFixed(1)}%</td>
                          <td className={`num text-end px-1.5 ${s.stats.avgNetPct > 0 ? "text-up" : "text-down"}`}>
                            {s.stats.avgNetPct > 0 ? "+" : ""}
                            {s.stats.avgNetPct.toFixed(2)}%
                          </td>
                          <td className="num text-end px-1.5">{s.stats.profitFactor !== null ? s.stats.profitFactor.toFixed(2) : "—"}</td>
                          <td className={`num text-end ps-1.5 ${s.stats.strategyCumPct >= s.stats.benchCumPct ? "text-up" : "text-muted-foreground"}`}>
                            {s.stats.strategyCumPct.toFixed(0)}%
                          </td>
                        </>
                      ) : (
                        <td colSpan={5} className="text-end px-1.5 text-muted-foreground/70 whitespace-nowrap" dir="auto">
                          {tt(T.aiSignalsStrategyNotBacktested, lang)}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* how it works — the tested charter */}
      <section className="rounded-lg border bg-card overflow-hidden">
        <button
          onClick={() => setHowOpen((o) => !o)}
          className="w-full flex items-center justify-between px-4 py-3 text-start hover:bg-accent/40 transition-colors"
          aria-expanded={howOpen}
        >
          <span className="text-sm font-semibold">{tt(T.aiSignalsHowTitle, lang)}</span>
          {howOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>
        {howOpen && data?.meta && (
          <div className="px-4 pb-4 space-y-3">
            {/* T42 — the twelve strategies, one line each */}
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-muted-foreground">{tt(T.aiSignalsStrategiesTitle, lang)}</p>
              <ul className="space-y-1">
                {STRATEGY_REGISTRY.map((s) => (
                  <li key={s.id} className="flex items-baseline gap-2 text-[10px] leading-relaxed">
                    <span className={`shrink-0 rounded-sm px-1.5 py-0.5 font-medium ${s.family === "news" || s.family === "fundamental" ? "bg-secondary/70 text-muted-foreground" : "bg-primary/10 text-primary"}`}>
                      {lang === "ar" ? s.nameAr : s.nameEn}
                    </span>
                    <span className="text-muted-foreground">{lang === "ar" ? s.oneLineAr : s.oneLineEn}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{tt(T.aiSignalsCharterLabel, lang)}</p>
            <pre dir="ltr" className="text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap font-mono bg-secondary/30 rounded-md p-3 max-h-80 overflow-y-auto thin-scroll">
              {data.meta.charter}
            </pre>
            <p className="num text-[10px] text-muted-foreground/70">
              rev {data.meta.strategyRev} · backtest {data.meta.backtestRev}
              {data.meta.backtestStale ? " ⚠ rerun scripts/backtest-signals.ts" : ""} · {data.set?.llmMs ? `${data.set.llmMs}ms` : ""} · {data.set?.model}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
