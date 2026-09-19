/** T45 — the AUTONOMOUS WEEKDAY SCHEDULER.
 *
 *  The agent runs three times per EGX trading day (Sun–Thu, Cairo):
 *
 *    09:15  pre-open     — the morning brief before the 10:00 bell
 *    12:15  midday       — the live-tape scan mid-session (10:00–14:30)
 *    15:00  post-close   — the completed-session review (close 14:30)
 *
 *  Fridays, Saturdays and listed holidays are silent (an EGX trading-day
 *  check via market-status). Each slot runs AT MOST ONCE per Cairo day —
 *  the tick checks the AgentRun table (session+kind) before firing, so a
 *  crashed or restarted server can never double-run a slot; the run itself
 *  is additionally single-flight inside hermes-agent. Manual triggers are
 *  separate ("manual") and rate-limited by time, not by the table. */

import { db } from "@/lib/db";
import { marketStatus, isEgxTradingDay } from "@/lib/market-status";

export type AgentSlotKind = "pre-open" | "midday" | "post-close";

export type AgentSlot = {
  kind: AgentSlotKind;
  /** Cairo minutes since midnight */
  minutes: number;
  labelAr: string;
  labelEn: string;
};

export const AGENT_SLOTS: AgentSlot[] = [
  { kind: "pre-open", minutes: 9 * 60 + 15, labelAr: "قبل الافتتاح ٠٩:١٥", labelEn: "Pre-open 09:15" },
  { kind: "midday", minutes: 12 * 60 + 15, labelAr: "منتصف الجلسة ١٢:١٥", labelEn: "Midday 12:15" },
  { kind: "post-close", minutes: 15 * 60, labelAr: "بعد الإغلاق ١٥:٠٠", labelEn: "Post-close 15:00" },
];

/** Cairo wall-clock parts for "now" (ymd + minutes since midnight). */
export function cairoClock(now: Date = new Date()): { ymd: string; weekday: string; minutes: number; tradingDay: boolean } {
  const p = marketStatus(now);
  const [h = "0", m = "0"] = p.cairoTime.split(":");
  return {
    ymd: p.cairoDate,
    weekday: p.weekday,
    minutes: Number(h) * 60 + Number(m),
    tradingDay: isEgxTradingDay(now),
  };
}

/** Has this slot already run today? A SUCCESSFUL run closes the slot for the
 *  day; a FAILED run retries at most every 30 minutes (a rate-limited or
 *  overloaded slot gets another honest chance without spamming a failure row
 *  every 5-minute tick). */
async function hasRun(session: string, kind: string): Promise<boolean> {
  try {
    const okRun = await db.agentRun.count({ where: { session, kind, status: "ok" } });
    if (okRun > 0) return true;
    const failedRecently = await db.agentRun.count({
      where: { session, kind, status: "failed", startedAt: { gte: new Date(Date.now() - 30 * 60_000) } },
    });
    return failedRecently > 0;
  } catch {
    return true; // db unreachable — do NOT fire (honest silence over a double run)
  }
}

/** The slot that is due RIGHT NOW (time passed, trading day, not yet run) —
 *  or null. Late slots still fire (a 09:15 brief at 09:40 is better than
 *  none) until the next slot's time arrives. */
export async function dueAgentSlot(now: Date = new Date()): Promise<AgentSlot | null> {
  const clock = cairoClock(now);
  if (!clock.tradingDay) return null;
  const due = AGENT_SLOTS.filter((s) => clock.minutes >= s.minutes);
  for (const slot of [...due].reverse()) {
    // the newest due slot that hasn't run yet wins (a missed 09:15 is
    // superseded once 12:15 is due — one brief at a time)
    if (!(await hasRun(clock.ymd, slot.kind))) return slot;
  }
  return null;
}

/** The next scheduled run (for the UI countdown): today's remaining slot,
 *  or the first slot of the next trading day. Null never (there is always
 *  a next trading day). */
export function nextAgentRun(now: Date = new Date()): { kind: AgentSlotKind; at: Date; labelAr: string; labelEn: string } {
  const clock = cairoClock(now);
  const today = AGENT_SLOTS.find((s) => clock.minutes < s.minutes && clock.tradingDay);
  if (today) {
    return { kind: today.kind, at: cairoDateAt(clock.ymd, today.minutes, now), labelAr: today.labelAr, labelEn: today.labelEn };
  }
  // next trading day's first slot — roll forward day by day
  let d = new Date(now.getTime() + 24 * 3600_000);
  for (let guard = 0; guard < 8; guard++) {
    if (isEgxTradingDay(d)) {
      const ymd = marketStatus(d).cairoDate;
      const first = AGENT_SLOTS[0];
      return { kind: first.kind, at: cairoDateAt(ymd, first.minutes, d), labelAr: first.labelAr, labelEn: first.labelEn };
    }
    d = new Date(d.getTime() + 24 * 3600_000);
  }
  // unreachable within 8 days — fall back to tomorrow's first slot as-is
  const first = AGENT_SLOTS[0];
  return { kind: first.kind, at: new Date(now.getTime() + 24 * 3600_000), labelAr: first.labelAr, labelEn: first.labelEn };
}

/** Build a UTC Date from a Cairo YYYY-MM-DD + minutes-since-midnight.
 *  Cairo is UTC+2 (winter) / UTC+3 (Egypt DST) — derive the exact offset
 *  from a probe format of that same instant instead of hardcoding. */
function cairoDateAt(ymd: string, minutes: number, refNow: Date): Date {
  // guess with both common offsets, then verify via Intl
  for (const offsetH of [3, 2]) {
    const guess = new Date(Date.parse(`${ymd}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`) - offsetH * 3600_000);
    const p = marketStatus(guess);
    if (p.cairoDate === ymd && p.cairoTime === `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`) {
      return guess;
    }
  }
  return new Date(refNow.getTime() + 3600_000); // honest fallback: ~an hour out
}

/** The scheduler tick (every 5 min from the background jobs): fire the due
 *  slot if any. Safe to call from anywhere. */
export async function agentTick(): Promise<void> {
  const slot = await dueAgentSlot();
  if (!slot) return;
  const { runHermesAgent } = await import("@/lib/hermes-agent");
  console.log(`[hermes] scheduler firing ${slot.kind} slot for ${cairoClock().ymd}`);
  await runHermesAgent(slot.kind);
}
