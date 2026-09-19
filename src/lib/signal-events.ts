/** T44 — LIVE SIGNAL EVENTS: the per-signal notification stream.
 *
 *  Every time the shared AI-signals cycle publishes a NEW set, every time a
 *  PUBLISHED pick actually resolves against the real tape (target / stop /
 *  expiry — the track record's job), and once per Cairo day when the
 *  self-validation check compares the live record to the backtest baseline
 *  (the ASTP-style review loop), an event lands here:
 *
 *    - the AI-signals panel's LIVE FEED renders it,
 *    - an open tab fires a browser Notification for it,
 *    - opted-in installed PWAs receive it as a real push notification even
 *      when the app is closed (lib/push.ts signals tick).
 *
 *  Emission is IDEMPOTENT: pick/bias events carry the AiSignalSet id
 *  (setRef), outcome events carry the episode key (ticker:issuedAtMs) and
 *  are only written when no event exists for that key yet — a crashed loop
 *  re-run can never double-notify. Every event carries its own AR + EN
 *  title/body so the push layer can serve either language with zero extra
 *  LLM cost. Nothing here is ever generated from thin air: the numbers in
 *  the bodies come from the payloads themselves. */

import { db } from "@/lib/db";
import type { AiSetPayload, AiPick } from "@/lib/ai-signals";
import type { TrackRecord, TrackedSignal } from "@/lib/signal-track";
import backtestJson from "@/data/backtest.json";

export type SignalEventRow = {
  id: string;
  createdAt: string; // ISO
  kind: "new-pick" | "bias" | "outcome" | "self-check" | "agent";
  ticker: string | null;
  stance: string | null;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  score: number | null;
};

const MAX_EVENTS = 400; // retention — one prune per emission batch

// ── emission ──

/** Emit pick + bias events for a freshly PERSISTED set (called with the
 *  row id AFTER db.aiSignalSet.create). Idempotent on setRef. */
export async function emitSetEvents(setRef: string, payload: AiSetPayload): Promise<number> {
  try {
    const existing = await db.signalEvent.count({ where: { setRef } });
    if (existing > 0) return 0; // already emitted for this set
  } catch {
    return 0;
  }
  const rows: Parameters<typeof db.signalEvent.create>[0]["data"][] = [];

  const b = payload.marketBias;
  const biasAr = b.direction === "bullish" ? "صعودي" : b.direction === "bearish" ? "هبوطي" : "محايد";
  const biasEn = b.direction;
  rows.push({
    kind: "bias",
    ticker: null,
    stance: null,
    setRef,
    episodeKey: null,
    titleAr: `قراءة السوق: ${biasAr} (قناعة ${b.conviction}/5)`,
    titleEn: `Market read: ${biasEn} (conviction ${b.conviction}/5)`,
    bodyAr: b.summaryAr.slice(0, 240),
    bodyEn: b.summaryEn.slice(0, 240),
    score: null,
  });

  for (const p of payload.picks) {
    rows.push(pickEvent(setRef, p));
  }
  return writeEvents(rows);
}

function pickEvent(setRef: string, p: AiPick) {
  const stanceAr = p.stance === "long" ? "فكرة شراء" : "تجنُّب";
  const stanceEn = p.stance === "long" ? "LONG idea" : "AVOID";
  const votes = p.applicable > 0 ? `${p.stance === "long" ? p.longVotes : p.avoidVotes}/${p.applicable}` : "";
  const bodyAr =
    p.stance === "long" && p.plan
      ? `إجماع ${p.charterScore !== null ? p.charterScore.toFixed(2) : "—"} · أصوات ${votes} · دخول ${p.plan.zoneLo}-${p.plan.zoneHi} · وقف ${p.stop ?? "—"} · هدف ٢ ${p.plan.t2}`
      : `إجماع ${p.charterScore !== null ? p.charterScore.toFixed(2) : "—"} · أصوات ${votes}`;
  const bodyEn =
    p.stance === "long" && p.plan
      ? `consensus ${p.charterScore !== null ? p.charterScore.toFixed(2) : "—"} · votes ${votes} · entry ${p.plan.zoneLo}-${p.plan.zoneHi} · stop ${p.stop ?? "—"} · T2 ${p.plan.t2}`
      : `consensus ${p.charterScore !== null ? p.charterScore.toFixed(2) : "—"} · votes ${votes}`;
  return {
    kind: "new-pick" as const,
    ticker: p.ticker,
    stance: p.stance,
    setRef,
    episodeKey: null,
    titleAr: `${p.ticker} — ${stanceAr} (قناعة ${p.conviction}/5)`,
    titleEn: `${p.ticker} — ${stanceEn} (conviction ${p.conviction}/5)`,
    bodyAr,
    bodyEn,
    score: p.charterScore,
  };
}

/** T45 — ONE summary event per autonomous agent run (the per-pick events
 *  already landed via emitSetEvents above). Idempotent on setRef+kind —
 *  safe to call from any retry path. */
export async function emitAgentEvent(
  setRef: string,
  payload: AiSetPayload & { agent?: { runKind: string; vision?: unknown[]; model: string } }
): Promise<number> {
  try {
    const dup = await db.signalEvent.findFirst({ where: { kind: "agent", setRef } });
    if (dup) return 0;
  } catch {
    return 0;
  }
  const runKind = payload.agent?.runKind ?? "manual";
  const kindAr: Record<string, string> = {
    "pre-open": "تعقيب ما قبل الافتتاح",
    midday: "مسح منتصف الجلسة",
    "post-close": "مراجعة ما بعد الإغلاق",
    manual: "تشغيل يدوي",
  };
  const kindEn: Record<string, string> = {
    "pre-open": "pre-open brief",
    midday: "midday scan",
    "post-close": "post-close review",
    manual: "manual run",
  };
  const longs = payload.picks.filter((p) => p.stance === "long").length;
  const avoids = payload.picks.length - longs;
  const visionN = Array.isArray(payload.agent?.vision) ? (payload.agent?.vision as unknown[]).length : 0;
  const biasAr = payload.marketBias.direction === "bullish" ? "صعودي" : payload.marketBias.direction === "bearish" ? "هبوطي" : "محايد";
  return writeEvents([
    {
      kind: "agent",
      ticker: null,
      stance: null,
      setRef,
      episodeKey: null,
      titleAr: `الوكيل المستقل — ${kindAr[runKind] ?? kindAr.manual}: ${payload.picks.length} فكرة (${longs} شراء${avoids > 0 ? ` و${avoids} تجنب` : ""})`,
      titleEn: `Autonomous agent — ${kindEn[runKind] ?? kindEn.manual}: ${payload.picks.length} idea(s) (${longs} long${avoids > 0 ? `, ${avoids} avoid` : ""})`,
      bodyAr: `قراءة السوق ${biasAr} (قناعة ${payload.marketBias.conviction}/5) · ${visionN > 0 ? `قرأ ${visionN} شارتًا بنموذج الرؤية · ` : ""}${payload.agent?.model ?? "glm-4.7-flash"} · السجل يتغذى بالتعلّم الذاتي`,
      bodyEn: `Market read ${payload.marketBias.direction} (conviction ${payload.marketBias.conviction}/5) · ${visionN > 0 ? `read ${visionN} chart(s) with the vision model · ` : ""}${payload.agent?.model ?? "glm-4.7-flash"} · the record feeds its self-learning`,
      score: null,
    },
  ]);
}

/** Emit OUTCOME events for tracked episodes that RESOLVED (target /
 *  stopped / expired). Idempotent on episodeKey — only the FIRST outcome
 *  event per episode ever lands. */
export async function emitOutcomeEvents(record: TrackRecord): Promise<number> {
  const resolved = record.signals.filter((s) => s.status !== "open");
  if (!resolved.length) return 0;
  const keys = resolved.map((s) => episodeKeyOf(s));
  let existing: Set<string>;
  try {
    const rows = await db.signalEvent.findMany({
      where: { kind: "outcome", episodeKey: { in: keys } },
      select: { episodeKey: true },
    });
    existing = new Set(rows.map((r) => r.episodeKey ?? ""));
  } catch {
    return 0;
  }
  const rows = resolved
    .filter((s) => !existing.has(episodeKeyOf(s)))
    .map((s) => outcomeEvent(s));
  return writeEvents(rows);
}

function episodeKeyOf(s: TrackedSignal): string {
  return `${s.ticker}:${Date.parse(s.issuedAt)}`;
}

function outcomeEvent(s: TrackedSignal) {
  const statusAr =
    s.status === "target" ? "حقق الهدف 🎯" : s.status === "stopped" ? "ضرب الوقف" : "انتهت دون حل";
  const statusEn =
    s.status === "target" ? "hit target 🎯" : s.status === "stopped" ? "stopped out" : "expired flat";
  const ret = s.retPct > 0 ? `+${s.retPct.toFixed(2)}%` : `${s.retPct.toFixed(2)}%`;
  return {
    kind: "outcome" as const,
    ticker: s.ticker,
    stance: "long",
    setRef: null,
    episodeKey: episodeKeyOf(s),
    titleAr: `${s.ticker} — ${statusAr} (${ret})`,
    titleEn: `${s.ticker} — ${statusEn} (${ret})`,
    bodyAr: `إصدار ${s.issuedDate} من ${s.entry} — آخر إغلاق ${s.lastClose} بعد ${s.sessionsElapsed} جلسة${s.partialT1 ? " · لمست الهدف ١ جزئيًا" : ""}`,
    bodyEn: `issued ${s.issuedDate} at ${s.entry} — last close ${s.lastClose} after ${s.sessionsElapsed} session(s)${s.partialT1 ? " · touched T1 partially" : ""}`,
    score: s.retPct,
  };
}

/** ASTP-style self-validation (once per Cairo day): compare the live track
 *  record's target-before-stop rate against the backtest baseline. Honest
 *  both ways — "within baseline" or "away from baseline", with n. */
export async function emitSelfCheck(record: TrackRecord): Promise<number> {
  const closed = record.summary.hits + record.summary.stopped;
  if (closed < 10) return 0; // not enough closed episodes to say anything
  const baseline = backtestJson.stats?.hitRate ?? null;
  if (baseline === null || typeof baseline !== "number") return 0;
  const live = record.summary.hitRate ?? 0;
  const diff = live - baseline;
  const within = Math.abs(diff) <= 0.1;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  try {
    const dup = await db.signalEvent.findFirst({
      where: { kind: "self-check", createdAt: { gte: new Date(`${day}T00:00:00Z`) } },
    });
    if (dup) return 0; // one review per Cairo day
  } catch {
    return 0;
  }
  const verdictAr = within
    ? "ضمن خط الأساس"
    : diff > 0
      ? "أعلى من خط الأساس"
      : "أدنى من خط الأساس";
  const verdictEn = within ? "within baseline" : diff > 0 ? "above baseline" : "below baseline";
  return writeEvents([
    {
      kind: "self-check",
      ticker: null,
      stance: null,
      setRef: null,
      episodeKey: null,
      titleAr: `المراجعة الذاتية: ${verdictAr}`,
      titleEn: `Self-validation: ${verdictEn}`,
      bodyAr: `معدل «الهدف قبل الوقف» الحي ${(live * 100).toFixed(1)}% مقابل ${(baseline * 100).toFixed(1)}% في الاختبار التاريخي — على ${closed} إشارة مغلقة.`,
      bodyEn: `Live target-before-stop ${(live * 100).toFixed(1)}% vs the backtested ${(baseline * 100).toFixed(1)}% — over ${closed} closed signals.`,
      score: Number(live.toFixed(3)),
    },
  ]);
}

async function writeEvents(rows: Parameters<typeof db.signalEvent.create>[0]["data"][]): Promise<number> {
  if (!rows.length) return 0;
  try {
    await db.signalEvent.createMany({ data: rows });
    // retention prune (bounded, rare)
    const total = await db.signalEvent.count();
    if (total > MAX_EVENTS) {
      const old = await db.signalEvent.findMany({
        orderBy: { createdAt: "desc" },
        skip: MAX_EVENTS,
        select: { id: true },
      });
      if (old.length) await db.signalEvent.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
    }
    return rows.length;
  } catch {
    return 0;
  }
}

// ── reads ──

export async function recentEvents(limit = 40): Promise<SignalEventRow[]> {
  try {
    const rows = await db.signalEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map(mapRow);
  } catch {
    return [];
  }
}

export async function eventsSince(sinceIso: string | null, limit = 60): Promise<SignalEventRow[]> {
  if (!sinceIso) return recentEvents(limit);
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) return recentEvents(limit);
  try {
    const rows = await db.signalEvent.findMany({
      where: { createdAt: { gt: new Date(since) } },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map(mapRow);
  } catch {
    return [];
  }
}

function mapRow(r: {
  id: string;
  createdAt: Date;
  kind: string;
  ticker: string | null;
  stance: string | null;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  score: number | null;
}): SignalEventRow {
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    kind: (["new-pick", "bias", "outcome", "self-check", "agent"] as const).includes(r.kind as never)
      ? (r.kind as SignalEventRow["kind"])
      : "self-check",
    ticker: r.ticker,
    stance: r.stance,
    titleAr: r.titleAr,
    titleEn: r.titleEn,
    bodyAr: r.bodyAr,
    bodyEn: r.bodyEn,
    score: r.score,
  };
}
