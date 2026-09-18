"use client";

/** T45 — the visible AUTONOMOUS AGENT + LIVE FEED layer of the AI Signals tab.
 *
 *  AutonomousAgentSection: the hermes agent's face — weekday schedule + next
 *  run countdown, the latest run's picks/journal/vision reads, the live
 *  self-learning state (per-strategy weights from the published record), the
 *  lessons journal, the run history (successes AND failures) and the guarded
 *  manual trigger.
 *
 *  LiveFeedSection: the per-signal notification stream (Task 44's backend,
 *  finally with its client): every new pick, market read, resolved outcome
 *  and agent brief lands here within a minute, and — with the reader's
 *  permission — fires a REAL browser notification while the tab is open
 *  (installed PWAs additionally get web-push when the app is closed). */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/market/app-context";
import { T, tt } from "@/lib/i18n";
import { fmtNum } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Bell,
  BellOff,
  BellRing,
  Bot,
  BrainCircuit,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Clock,
  Cloud,
  CloudOff,
  Eye,
  FileText,
  GraduationCap,
  Layers,
  Lightbulb,
  NotebookPen,
  PlayCircle,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

// ── shared types (mirror the API payloads) ──

type VisionRead = {
  ticker: string;
  pattern: "uptrend" | "downtrend" | "range" | "breakout" | "reversal" | "unclear";
  verdict: "confirm" | "neutral" | "warn";
  noteAr: string;
  noteEn: string;
  ms: number;
};

type AgentExtras = {
  runKind: string;
  model: string;
  visionModel: string | null;
  startedAt: string;
  skills: string[];
  vision: VisionRead[];
  journalAr: string;
  journalEn: string;
  /** T46 — the model's actual THINKING stream (verbatim, trimmed). */
  thinking?: string | null;
  /** T46 — the supermemory entries recalled before this run. */
  memoryRecall?: { kind: string; text: string; score: number }[];
  /** T46 — memory totals for this run. */
  memory?: { totalBefore: number; stored: number };
  /** T46 — durable file ledger state at run time. */
  archive?: { ledgerRuns: number };
  learning: {
    episodesClosed: number;
    minN: number;
    since: string | null;
    weights: { id: string; nameAr: string; nameEn: string; multiplier: number; decided: number; hitRate: number | null }[];
    noteAr: string;
    noteEn: string;
  };
  memoryLessons: number;
};

type AgentStateResponse = {
  ok: boolean;
  models: { brain: string; vision: string };
  latest: {
    run: { id: string; kind: string; session: string; startedAt: string; status: string; model: string; visionModel: string | null; llmMs: number; visionMs: number; error: string | null };
    payload: { marketBias: { direction: string; conviction: number; summaryAr: string; summaryEn: string }; picks: { ticker: string; stance: string; conviction: number }[]; agent: AgentExtras };
  } | null;
  learning: {
    computedAt: string;
    since: string | null;
    episodesClosed: number;
    minN: number;
    noteAr: string;
    noteEn: string;
    strategies: { id: string; nameAr: string; nameEn: string; multiplier: number; decided: number; hitRate: number | null; closed: number }[];
  };
  lessons: { id: string; kind: string; textAr: string; textEn: string; createdAt: string }[];
  runs: { id: string; kind: string; session: string; startedAt: string; status: string; model: string; llmMs: number; visionMs: number; error: string | null }[];
  schedule?: { next: { kind: string; at: string; inMs: number; labelAr: string; labelEn: string }; slots: { kind: string; labelAr: string; labelEn: string }[] };
  /** T46 — the supermemory / durable-files / supabase state. */
  memory?: { total: number; byKind: { kind: string; count: number }[]; cloud: { configured: boolean; state: string; mirrored: number; lastError: string | null }; oldest: string | null };
  archive?: { signalsFile: boolean; worklogFile: boolean; runs: number; dir: string };
  supabase?: { configured: boolean; url: string | null; state: string; mirrored: number; lastError: string | null };
};

// ── small helpers ──

const RUN_KIND_AR: Record<string, string> = {
  "pre-open": "قبل الافتتاح",
  midday: "منتصف الجلسة",
  "post-close": "بعد الإغلاق",
  manual: "يدوي",
};
const RUN_KIND_EN: Record<string, string> = {
  "pre-open": "pre-open",
  midday: "midday",
  "post-close": "post-close",
  manual: "manual",
};

function relTime(iso: string, lang: "ar" | "en"): string {
  const d = Date.parse(iso);
  if (!Number.isFinite(d)) return "";
  const s = Math.max(0, Math.floor((Date.now() - d) / 1000));
  if (s < 60) return tt(T.agentJustNow, lang);
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} ${tt(T.agentMinutesAgo, lang)}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ${tt(T.agentHoursAgo, lang)}`;
  const days = Math.floor(h / 24);
  return `${days} ${tt(T.agentDaysAgo, lang)}`;
}

function fmtCountdown(ms: number, lang: "ar" | "en"): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}${lang === "ar" ? "س " : "h "}${m}${lang === "ar" ? "د" : "m"}`;
  if (m > 0) return `${m}${lang === "ar" ? " دقيقة" : " min"}`;
  return tt(T.agentAnyMoment, lang);
}

// ── the LIVE FEED ──

type EventRow = {
  id: string;
  createdAt: string;
  kind: "new-pick" | "bias" | "outcome" | "self-check" | "agent";
  ticker: string | null;
  stance: string | null;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  score: number | null;
};

const KIND_CLS: Record<EventRow["kind"], string> = {
  "new-pick": "bg-up-soft/70 text-up",
  bias: "bg-secondary/70 text-muted-foreground",
  outcome: "bg-primary/10 text-primary",
  "self-check": "bg-secondary/70 text-muted-foreground",
  agent: "bg-up-soft/70 text-up",
};

function EventIcon({ kind }: { kind: EventRow["kind"] }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  if (kind === "new-pick") return <TrendingUp className={cls} aria-hidden />;
  if (kind === "outcome") return <Target className={cls} aria-hidden />;
  if (kind === "agent") return <Bot className={cls} aria-hidden />;
  if (kind === "bias") return <BrainCircuit className={cls} aria-hidden />;
  return <NotebookPen className={cls} aria-hidden />;
}

function kindLabel(kind: EventRow["kind"], lang: "ar" | "en"): string {
  const map: Record<EventRow["kind"], { ar: string; en: string }> = {
    "new-pick": { ar: "إشارة", en: "pick" },
    bias: { ar: "قراءة سوق", en: "market read" },
    outcome: { ar: "نتيجة", en: "outcome" },
    "self-check": { ar: "مراجعة ذاتية", en: "self-check" },
    agent: { ar: "الوكيل", en: "agent" },
  };
  return lang === "ar" ? map[kind].ar : map[kind].en;
}

export function LiveFeedSection() {
  const { lang } = useApp();
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [error, setError] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const notifiedRef = useRef<Set<string>>(new Set());
  const bootRef = useRef(false);

  useEffect(() => {
    if (typeof Notification !== "undefined") setPerm(Notification.permission);
    else setPerm("unsupported");
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/signals/events?limit=40", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { ok: boolean; events: EventRow[] };
      if (!json.ok || !Array.isArray(json.events)) throw new Error("bad payload");
      setEvents(json.events);
      setError(false);
      // browser notifications for events that arrived AFTER mount (the
      // historical backlog never notifies — only live arrivals do)
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        let fired = 0;
        for (const e of json.events) {
          if (bootRef.current && !notifiedRef.current.has(e.id) && fired < 4) {
            fired++;
            try {
              new Notification(lang === "ar" ? e.titleAr : e.titleEn, {
                body: (lang === "ar" ? e.bodyAr : e.bodyEn).slice(0, 160),
                tag: e.id,
                icon: "/icon-192.png",
              });
            } catch {
              /* some browsers restrict the constructor — the feed still shows it */
            }
          }
          notifiedRef.current.add(e.id);
        }
      }
      bootRef.current = true;
    } catch {
      setError(true);
    }
  }, [lang]);

  useEffect(() => {
    void poll();
    const t = setInterval(() => void poll(), 45_000);
    return () => clearInterval(t);
  }, [poll]);

  const enableNotifications = async () => {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setPerm(p);
    if (p === "granted") {
      try {
        new Notification(tt(T.liveNotifEnabledTitle, lang), {
          body: tt(T.liveNotifEnabledBody, lang),
          icon: "/icon-192.png",
        });
      } catch {
        /* granted is what matters */
      }
    }
  };

  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <BellRing className="h-4 w-4 text-primary" aria-hidden />
          {tt(T.liveFeedTitle, lang)}
        </p>
        <div className="flex items-center gap-2">
          {perm === "granted" ? (
            <span className="inline-flex items-center gap-1 rounded-full border bg-up-soft/40 px-2 py-0.5 text-[10px] text-up">
              <Bell className="h-3 w-3" aria-hidden />
              {tt(T.liveNotifEnabled, lang)}
            </span>
          ) : perm === "denied" ? (
            <span className="inline-flex items-center gap-1 rounded-full border bg-secondary/60 px-2 py-0.5 text-[10px] text-muted-foreground">
              <BellOff className="h-3 w-3" aria-hidden />
              {tt(T.liveNotifBlocked, lang)}
            </span>
          ) : perm === "unsupported" ? (
            <span className="inline-flex items-center gap-1 rounded-full border bg-secondary/60 px-2 py-0.5 text-[10px] text-muted-foreground">
              {tt(T.liveNotifUnsupported, lang)}
            </span>
          ) : (
            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => void enableNotifications()}>
              <Bell className="h-3 w-3 me-1" aria-hidden />
              {tt(T.liveNotifEnable, lang)}
            </Button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">{tt(T.liveFeedNote, lang)}</p>

      {events === null && !error ? (
        <div className="space-y-1.5">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : error && (events === null || events.length === 0) ? (
        <p className="text-[11px] text-muted-foreground">{tt(T.liveFeedError, lang)}</p>
      ) : !events || events.length === 0 ? (
        <p className="text-[11px] text-muted-foreground leading-relaxed">{tt(T.liveFeedEmpty, lang)}</p>
      ) : (
        <ul className="max-h-80 overflow-y-auto thin-scroll space-y-1 pe-1" role="feed" aria-label={tt(T.liveFeedTitle, lang)}>
          {events.map((e) => (
            <li key={e.id} className="rounded-md border bg-secondary/25 px-2.5 py-2 flex gap-2 items-start">
              <span className={`mt-0.5 inline-flex items-center justify-center rounded-sm p-1 ${KIND_CLS[e.kind] ?? KIND_CLS.bias}`}>
                <EventIcon kind={e.kind} />
              </span>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <p className="text-[11px] font-medium leading-snug" dir="auto">
                    {lang === "ar" ? e.titleAr : e.titleEn}
                  </p>
                  <span className="num text-[9px] text-muted-foreground/80 whitespace-nowrap">{relTime(e.createdAt, lang)}</span>
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed" dir="auto">
                  {lang === "ar" ? e.bodyAr : e.bodyEn}
                </p>
              </div>
              <span className="shrink-0 rounded-sm bg-secondary/60 px-1 py-0.5 text-[8px] font-medium text-muted-foreground/80 whitespace-nowrap">
                {kindLabel(e.kind, lang)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── the AUTONOMOUS AGENT section ──

const VERDICT_CLS: Record<VisionRead["verdict"], string> = {
  confirm: "bg-up-soft/70 text-up",
  neutral: "bg-secondary/70 text-muted-foreground",
  warn: "bg-down-soft/70 text-down",
};

const PATTERN_AR: Record<VisionRead["pattern"], string> = {
  uptrend: "ترند صاعد",
  downtrend: "ترند هابط",
  range: "نطاق عرضي",
  breakout: "اختراق",
  reversal: "انعكاس",
  unclear: "غير واضح",
};
const PATTERN_EN: Record<VisionRead["pattern"], string> = {
  uptrend: "uptrend",
  downtrend: "downtrend",
  range: "range",
  breakout: "breakout",
  reversal: "reversal",
  unclear: "unclear",
};

function WeightBadge({ multiplier }: { multiplier: number }) {
  const cls =
    multiplier > 1.001 ? "bg-up-soft/70 text-up" : multiplier < 0.999 ? "bg-down-soft/70 text-down" : "bg-secondary/60 text-muted-foreground";
  return (
    <span className={`num rounded-sm px-1 py-0.5 text-[9px] font-semibold ${cls}`} dir="ltr">
      ×{multiplier.toFixed(2)}
    </span>
  );
}

function memKindLabel(kind: string, lang: "ar" | "en"): string {
  const map: Record<string, { ar: string; en: string }> = {
    reflection: { ar: "تأمل", en: "reflection" },
    pick: { ar: "اختيار", en: "pick" },
    bias: { ar: "قراءة سوق", en: "market read" },
    vision: { ar: "رؤية", en: "vision" },
    lesson: { ar: "درس", en: "lesson" },
    milestone: { ar: "محطة", en: "milestone" },
  };
  const m = map[kind] ?? { ar: "ذاكرة", en: "memory" };
  return lang === "ar" ? m.ar : m.en;
}

export function AutonomousAgentSection() {
  const { lang } = useApp();
  const [state, setState] = useState<AgentStateResponse | null>(null);
  const [error, setError] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState<"started" | "cooldown" | "error" | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-signals", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as AgentStateResponse;
      if (!json.ok) throw new Error("bad payload");
      setState(json);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void poll();
    const t = setInterval(() => void poll(), 60_000);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(t);
      clearInterval(clock);
    };
  }, [poll]);

  // after a manual trigger: poll fast (10s) for ~3 minutes so the user SEES
  // the run land, then the normal cadence takes over
  useEffect(() => {
    if (triggerMsg !== "started") return;
    const t = setInterval(() => void poll(), 10_000);
    const stop = setTimeout(() => clearInterval(t), 3 * 60_000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [triggerMsg, poll]);

  const trigger = async () => {
    setTriggering(true);
    setTriggerMsg(null);
    try {
      const res = await fetch("/api/agent-signals", { method: "POST" });
      if (res.status === 429) setTriggerMsg("cooldown");
      else if (res.ok) setTriggerMsg("started");
      else setTriggerMsg("error");
    } catch {
      setTriggerMsg("error");
    } finally {
      setTriggering(false);
    }
  };

  const latest = state?.latest ?? null;
  const agent = latest?.payload.agent ?? null;
  const learning = state?.learning ?? null;
  const nextRun = state?.schedule?.next ?? null;
  const movedStrategies = useMemo(
    () => (learning?.strategies ?? []).filter((s) => s.multiplier > 1.001 || s.multiplier < 0.999),
    [learning]
  );

  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      {/* header */}
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <Bot className="h-4 w-4 text-primary" aria-hidden />
          {tt(T.agentHermesTitle, lang)}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="num inline-flex items-center gap-1 rounded-full border bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            <BrainCircuit className="h-3 w-3" aria-hidden />
            {state?.models.brain ?? "GLM-4.7-Flash"}
          </span>
          <span className="num inline-flex items-center gap-1 rounded-full border bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            <Lightbulb className="h-3 w-3" aria-hidden />
            {tt(T.agentThinkingBadge, lang)}
          </span>
          <span className="num inline-flex items-center gap-1 rounded-full border bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            <Eye className="h-3 w-3" aria-hidden />
            {state?.models.vision ?? "GLM-4.6V-Flash"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border bg-secondary/60 px-2 py-0.5 text-[10px] text-muted-foreground">
            <CalendarDays className="h-3 w-3" aria-hidden />
            {tt(T.agentWeekBadge, lang)}
          </span>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed max-w-3xl">{tt(T.agentHermesNote, lang)}</p>

      {/* schedule + trigger */}
      <div className="flex items-center justify-between gap-2 flex-wrap rounded-md border bg-secondary/25 px-3 py-2">
        <p className="text-[11px] flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          {nextRun ? (
            <>
              <span className="text-muted-foreground">{tt(T.agentNextRun, lang)}:</span>{" "}
              <span className="font-medium">{lang === "ar" ? nextRun.labelAr : nextRun.labelEn}</span>
              <span className="num text-muted-foreground">· {fmtCountdown(nextRun.at ? Date.parse(nextRun.at) - now : 0, lang)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">{tt(T.agentScheduleLoading, lang)}</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {triggerMsg === "started" && <span className="text-[10px] text-up font-medium">{tt(T.agentTriggerStarted, lang)}</span>}
          {triggerMsg === "cooldown" && <span className="text-[10px] text-muted-foreground">{tt(T.agentTriggerCooldown, lang)}</span>}
          {triggerMsg === "error" && <span className="text-[10px] text-down">{tt(T.agentTriggerError, lang)}</span>}
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => void trigger()} disabled={triggering}>
            <PlayCircle className="h-3.5 w-3.5 me-1" aria-hidden />
            {triggering ? tt(T.agentTriggerBusy, lang) : tt(T.agentTriggerBtn, lang)}
          </Button>
        </div>
      </div>

      {/* latest run */}
      {state === null && !error ? (
        <Skeleton className="h-28 w-full" />
      ) : error && !latest ? (
        <p className="text-[11px] text-muted-foreground">{tt(T.agentStateError, lang)}</p>
      ) : !latest ? (
        <p className="rounded-md border bg-secondary/25 px-3 py-2.5 text-[11px] text-muted-foreground leading-relaxed">
          {tt(T.agentNoRunYet, lang)}
        </p>
      ) : (
        <div className="rounded-md border bg-secondary/25 p-3 space-y-2.5">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <p className="text-[11px] font-medium flex items-center gap-1.5">
              <span className="rounded-sm bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-semibold">
                {lang === "ar" ? (RUN_KIND_AR[latest.run.kind] ?? latest.run.kind) : (RUN_KIND_EN[latest.run.kind] ?? latest.run.kind)}
              </span>
              {tt(T.agentLatestRun, lang)} · <span className="num">{relTime(latest.run.startedAt, lang)}</span>
            </p>
            <span className="num text-[10px] text-muted-foreground" dir="ltr">
              {latest.run.model} · {latest.run.llmMs}ms{latest.run.visionMs > 0 ? ` · vision ${latest.run.visionMs}ms` : ""}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed">
            <span className="text-muted-foreground">{tt(T.agentBiasLine, lang)} </span>
            <span className={`font-semibold ${latest.payload.marketBias.direction === "bullish" ? "text-up" : latest.payload.marketBias.direction === "bearish" ? "text-down" : ""}`}>
              {lang === "ar"
                ? latest.payload.marketBias.direction === "bullish"
                  ? "صعودي"
                  : latest.payload.marketBias.direction === "bearish"
                    ? "هبوطي"
                    : "محايد"
                : latest.payload.marketBias.direction}
            </span>
            <span className="num text-muted-foreground"> ({latest.payload.marketBias.conviction}/5) · </span>
            <span className="num">
              {latest.payload.picks.filter((p) => p.stance === "long").length} {tt(T.aiSignalsStanceLong, lang)} ·{" "}
              {latest.payload.picks.filter((p) => p.stance === "avoid").length} {tt(T.aiSignalsStanceAvoid, lang)}
            </span>
            {latest.payload.picks.length > 0 && (
              <span className="num text-muted-foreground"> · {latest.payload.picks.map((p) => p.ticker).join(lang === "ar" ? "، " : ", ")}</span>
            )}
          </p>
          {agent && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                <NotebookPen className="h-3 w-3" aria-hidden />
                {tt(T.agentJournal, lang)}
              </p>
              <p className="text-[11px] leading-relaxed border-s-2 border-primary/30 ps-2.5">{lang === "ar" ? agent.journalAr : agent.journalEn}</p>
            </div>
          )}

          {/* T46 — the agent's THINKING stream, verbatim */}
          {agent && (
            <div className="rounded-md border overflow-hidden">
              <button
                onClick={() => setThinkingOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-start hover:bg-accent/40 transition-colors"
                aria-expanded={thinkingOpen}
              >
                <span className="text-[11px] font-medium flex items-center gap-1.5 min-w-0">
                  <Lightbulb className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden />
                  <span className="truncate">{tt(T.agentThinkingTitle, lang)}</span>
                  {agent.thinking ? (
                    <span className="num shrink-0 rounded-full border bg-up-soft/60 px-1.5 py-0.5 text-[9px] font-semibold text-up" dir="ltr">
                      {tt(T.agentThinkingBadge, lang)}
                    </span>
                  ) : null}
                </span>
                {thinkingOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              </button>
              {thinkingOpen && (
                <div className="px-3 pb-3 space-y-1.5">
                  <p className="text-[10px] text-muted-foreground leading-relaxed">{tt(T.agentThinkingNote, lang)}</p>
                  {agent.thinking ? (
                    <pre
                      className="max-h-64 overflow-y-auto thin-scroll whitespace-pre-wrap break-words rounded-md border bg-secondary/25 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground"
                      dir="auto"
                    >
                      {agent.thinking}
                    </pre>
                  ) : (
                    <p className="text-[10px] text-muted-foreground/80 leading-relaxed">{tt(T.agentThinkingHidden, lang)}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* vision reads */}
      {agent && agent.vision.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
            <Eye className="h-3 w-3" aria-hidden />
            {tt(T.agentVisionTitle, lang)}
          </p>
          <div className="grid gap-1.5 md:grid-cols-3">
            {agent.vision.map((v) => (
              <div key={v.ticker} className="rounded-md border bg-secondary/25 px-2.5 py-2 space-y-1">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="num text-[11px] font-bold">{v.ticker}</span>
                  <span className={`rounded-sm px-1.5 py-0.5 text-[9px] font-semibold ${VERDICT_CLS[v.verdict]}`}>
                    {v.verdict === "confirm" ? tt(T.agentVisionConfirm, lang) : v.verdict === "warn" ? tt(T.agentVisionWarn, lang) : tt(T.agentVisionNeutral, lang)}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed" dir="auto">
                  {lang === "ar" ? v.noteAr : v.noteEn}
                </p>
                <p className="num text-[9px] text-muted-foreground/70" dir="ltr">
                  {lang === "ar" ? PATTERN_AR[v.pattern] : PATTERN_EN[v.pattern]} · {(v.ms / 1000).toFixed(1)}s
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* self-learning */}
      {learning && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
            <GraduationCap className="h-3 w-3" aria-hidden />
            {tt(T.agentLearningTitle, lang)}
            <span className="num font-normal text-muted-foreground/70">
              · {learning.episodesClosed} {tt(T.agentLearningEpisodes, lang)}
              {learning.since ? ` (${tt(T.agentSince, lang)} ${learning.since})` : ""}
            </span>
          </p>
          {movedStrategies.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {movedStrategies.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1 rounded-sm border bg-secondary/40 px-1.5 py-0.5 text-[10px]"
                  title={`${tt(T.agentLearningDecided, lang)}: ${s.decided}${s.hitRate !== null ? ` · ${tt(T.aiSignalsBacktestHit, lang)}: ${(s.hitRate * 100).toFixed(0)}%` : ""}`}
                >
                  <span className="font-medium">{lang === "ar" ? s.nameAr : s.nameEn}</span>
                  <WeightBadge multiplier={s.multiplier} />
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground/80 leading-relaxed">{tt(T.agentLearningNone, lang)}</p>
          )}
          <p className="text-[10px] text-muted-foreground/80 leading-relaxed">{lang === "ar" ? learning.noteAr : learning.noteEn}</p>
        </div>
      )}

      {/* T46 — SUPERMEMORY: the unlimited memory + the durable files + supabase */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-medium text-muted-foreground flex items-center gap-1.5 flex-wrap">
          <Layers className="h-3 w-3 text-primary" aria-hidden />
          {tt(T.agentMemoryTitle, lang)}
          <span className="num font-normal text-muted-foreground/70">
            · {state?.memory?.total ?? 0} {tt(T.agentMemoryCount, lang)}
            {agent?.memory && agent.memory.stored > 0 ? ` (+${agent.memory.stored} ${tt(T.agentMemoryStoredRun, lang)})` : ""}
          </span>
          {state?.archive?.signalsFile ? (
            <span className="inline-flex items-center gap-1 rounded-full border bg-up-soft/40 px-1.5 py-0.5 text-[9px] font-medium text-up" title="data/agent/signals.jsonl + worklog.md">
              <FileText className="h-2.5 w-2.5" aria-hidden />
              {tt(T.agentArchiveBadge, lang)}
            </span>
          ) : null}
          {state?.memory?.cloud?.configured ? (
            state.memory.cloud.state === "ok" ? (
              <span className="inline-flex items-center gap-1 rounded-full border bg-up-soft/40 px-1.5 py-0.5 text-[9px] font-medium text-up">
                <Cloud className="h-2.5 w-2.5" aria-hidden />
                {tt(T.agentMemoryCloudOk, lang)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border bg-down-soft/40 px-1.5 py-0.5 text-[9px] font-medium text-down" title={state.memory.cloud.lastError ?? undefined}>
                <CloudOff className="h-2.5 w-2.5" aria-hidden />
                {tt(T.agentMemoryCloudErr, lang)}
              </span>
            )
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border bg-secondary/60 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
              <CloudOff className="h-2.5 w-2.5" aria-hidden />
              {tt(T.agentMemoryLocal, lang)}
            </span>
          )}
        </p>

        {/* what the agent RECALLED before this run — the connectedness made visible */}
        {agent && agent.memoryRecall && agent.memoryRecall.length > 0 ? (
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground/80">{tt(T.agentMemoryRecallTitle, lang)}:</p>
            <ul className="space-y-1 max-h-40 overflow-y-auto thin-scroll pe-1">
              {agent.memoryRecall.slice(0, 6).map((m, i) => (
                <li key={i} className="text-[10px] leading-relaxed flex gap-1.5 items-start">
                  <span className="shrink-0 rounded-sm bg-primary/10 text-primary px-1 py-0.5 text-[8px] font-semibold">{memKindLabel(m.kind, lang)}</span>
                  <span className="text-muted-foreground min-w-0 flex-1" dir="auto">
                    {m.text}
                  </span>
                  <span className="num shrink-0 text-[8px] text-muted-foreground/60" dir="ltr">
                    {Math.round(m.score * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground/80 leading-relaxed">{tt(T.agentMemoryRecallNone, lang)}</p>
        )}
        <p className="text-[10px] text-muted-foreground/80 leading-relaxed">{tt(T.agentMemoryNote, lang)}</p>
        {state?.supabase && (
          <p className="text-[10px] leading-relaxed flex items-center gap-1">
            {state.supabase.configured ? (
              state.supabase.state === "ok" ? (
                <>
                  <Cloud className="h-3 w-3 text-up shrink-0" aria-hidden />
                  <span className="text-up font-medium">{tt(T.agentSupabaseOk, lang)}</span>
                  <span className="num text-muted-foreground/70" dir="ltr">
                    ({state.supabase.mirrored})
                  </span>
                </>
              ) : (
                <>
                  <CloudOff className="h-3 w-3 text-down shrink-0" aria-hidden />
                  <span className="text-down font-medium">{tt(T.agentSupabaseErr, lang)}</span>
                </>
              )
            ) : (
              <>
                <CloudOff className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden />
                <span className="text-muted-foreground">{tt(T.agentSupabaseOff, lang)}</span>
              </>
            )}
          </p>
        )}
      </div>

      {/* lessons journal */}
      {state?.lessons && state.lessons.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
            <NotebookPen className="h-3 w-3" aria-hidden />
            {tt(T.agentLessonsTitle, lang)}
          </p>
          <ul className="space-y-1 max-h-44 overflow-y-auto thin-scroll pe-1">
            {state.lessons.slice(0, 6).map((l) => (
              <li key={l.id} className="text-[10px] leading-relaxed flex gap-1.5 items-start">
                <span
                  className={`shrink-0 rounded-sm px-1 py-0.5 text-[8px] font-semibold ${
                    l.kind === "weight-change" ? "bg-primary/10 text-primary" : l.kind === "milestone" ? "bg-up-soft/70 text-up" : "bg-secondary/70 text-muted-foreground"
                  }`}
                >
                  {l.kind === "weight-change"
                    ? tt(T.agentLessonWeight, lang)
                    : l.kind === "milestone"
                      ? tt(T.agentLessonMilestone, lang)
                      : tt(T.agentLessonReflection, lang)}
                </span>
                <span className="text-muted-foreground" dir="auto">
                  {lang === "ar" ? l.textAr : l.textEn}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* run history */}
      {state?.runs && state.runs.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground">{tt(T.agentRunsTitle, lang)}</p>
          <div className="flex flex-wrap gap-1">
            {state.runs.slice(0, 10).map((r) => (
              <span
                key={r.id}
                className={`num inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[9px] ${
                  r.status === "ok" ? "bg-up-soft/40 text-up" : "bg-down-soft/40 text-down"
                }`}
                title={`${r.kind} · ${r.session} · ${r.model}${r.error ? ` · ${r.error.slice(0, 120)}` : ""}`}
                dir="ltr"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${r.status === "ok" ? "bg-up" : "bg-down"}`} aria-hidden />
                {lang === "ar" ? (RUN_KIND_AR[r.kind] ?? r.kind) : (RUN_KIND_EN[r.kind] ?? r.kind)} · {new Date(r.startedAt).toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-GB", { hour: "2-digit", minute: "2-digit" })}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* skills — collapsible */}
      <div className="rounded-md border overflow-hidden">
        <button
          onClick={() => setSkillsOpen((o) => !o)}
          className="w-full flex items-center justify-between px-3 py-2 text-start hover:bg-accent/40 transition-colors"
          aria-expanded={skillsOpen}
        >
          <span className="text-[11px] font-medium">{tt(T.agentSkillsTitle, lang)}</span>
          {skillsOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>
        {skillsOpen && (
          <ul className="px-3 pb-3 space-y-1">
            {AGENT_SKILLS_UI.map((s) => (
              <li key={s.id} className="flex items-baseline gap-2 text-[10px] leading-relaxed">
                <span className="shrink-0 rounded-sm bg-primary/10 text-primary px-1.5 py-0.5 font-medium">{lang === "ar" ? s.nameAr : s.nameEn}</span>
                <span className="text-muted-foreground">{lang === "ar" ? s.oneLineAr : s.oneLineEn}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// the skills registry, duplicated PURE (data-only) so this client component
// never imports the server-only hermes-agent module (the key lives there)
const AGENT_SKILLS_UI = [
  { id: "ensemble", nameAr: "قراءة المحرك", nameEn: "Ensemble read", oneLineAr: "تصويت محرك الـ18 استراتيجية على كل مرشح مع الإجماع والأدلة", oneLineEn: "The 18-strategy engine's per-candidate vote, consensus and evidence" },
  { id: "technicals", nameAr: "التحليل الفني", nameEn: "Technical charter", oneLineAr: "ميزات الميثاق: الترند والزخم والحجم والموضع ومسار ATR للمخاطر", oneLineEn: "Charter features: trend, momentum, volume, 52w position, ATR risk spine" },
  { id: "ml-forecast", nameAr: "توقع تعلم الآلة", nameEn: "ML forecast", oneLineAr: "نموذج لوجستي لكل سهم باحتمال صعود مع دقة عينة احتجاز مقاسة", oneLineEn: "Per-ticker logistic model, P(up) with a measured holdout hit rate" },
  { id: "news-tone", nameAr: "نبرة الصحافة", nameEn: "Press tone", oneLineAr: "معجم عربي يقيس انحياز تغطية 14 يومًا لكل شركة", oneLineEn: "Arabic lexicon scoring each company's 14-day press coverage" },
  { id: "whale-radar", nameAr: "رادار الحيتان", nameEn: "Whale radar", oneLineAr: "تدفقات المؤسسات الأجنبية الحقيقية من سجل البورصة الرسمي", oneLineEn: "Real foreign-institution flows from the exchange's own record" },
  { id: "insider-filings", nameAr: "إفصاحات المطلعين", nameEn: "Insider filings", oneLineAr: "نماذج تداول المتصلين وأسهم الخزينة المودعة رسميًا", oneLineEn: "Officially filed insider / treasury-share dealings" },
  { id: "vision", nameAr: "قراءة الشارت بالرؤية", nameEn: "Vision chart read", oneLineAr: "نموذج رؤية مجاني يقرأ شارت الشموع الحقيقي لكل مرشح رئيسي", oneLineEn: "A free vision model reads each top candidate's real candlestick chart" },
  { id: "learning-memory", nameAr: "ذاكرة التعلّم", nameEn: "Learning memory", oneLineAr: "سجل النتائج المنشور يعدّل وزن كل استراتيجية (±25٪) ويغذّي اليوميات", oneLineEn: "The published record bends each strategy's weight (±25%) and feeds the journal" },
  { id: "risk-guard", nameAr: "حارس المخاطر", nameEn: "Risk guard", oneLineAr: "بوابات الإجماع والقناعة وحاجز ATR ومخاطر الإفصاح المالي داخل الأفق", oneLineEn: "Consensus gate, conviction caps, ATR guard, earnings-inside-horizon flags" },
  { id: "portfolio", nameAr: "توزيع المحفظة", nameEn: "Portfolio allocation", oneLineAr: "محسّن الحد الأقصى لشارب على الأفكار الفائزة بتغاير حقيقي", oneLineEn: "Max-Sharpe optimizer over the winning ideas on real covariance" },
];
