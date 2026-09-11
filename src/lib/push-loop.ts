/** Server boot background jobs (started from src/instrumentation.ts — the
 *  Next.js register() hook runs once per server process, dev included):
 *
 *  1. Push loop (G1 mobile): every 5 minutes evaluate every subscribed
 *     device's alerts against the same delayed quotes the app shows and send
 *     system notifications for anything that just fired. Honest pacing —
 *     quotes are ~15 min delayed, so a 5-min cadence can never "beat" the
 *     market data, it just reduces worst-case notification latency.
 *
 *  2. Signals warm (Signals tab): pre-compute the cross-market technical
 *     scan shortly after boot and refresh it hourly so the first visitor of
 *     the day never waits for ~200 candle fetches.
 *
 *  3. AI-signals warm (Task 20): refresh the shared AI signal set on its
 *     45-min cooldown — one LLM call per cycle serves every user, so the
 *     section stays free; the warm makes sure a set is usually ready before
 *     the first visitor asks for it.
 *
 *  Guarded by a globalThis flag so dev hot-reloads / route module isolation
 *  can never start a second copy of the same interval. */

import { evaluateDevices } from "@/lib/push";

const g = globalThis as unknown as { __egxBgStarted?: boolean };

const PUSH_INTERVAL_MS = 5 * 60_000;
const SIGNALS_WARM_DELAY_MS = 15_000;
const SIGNALS_WARM_INTERVAL_MS = 60 * 60_000;

async function safePushTick(): Promise<void> {
  try {
    const summary = await evaluateDevices();
    if (summary.devices > 0 || summary.notified > 0) {
      console.log(
        `[push] devices=${summary.devices} alerts=${summary.checkedAlerts} notified=${summary.notified} removed=${summary.removedSubscriptions}`
      );
    }
  } catch (err) {
    console.warn("[push] tick failed:", err instanceof Error ? err.message : err);
  }
}

async function safeSignalsWarm(): Promise<void> {
  try {
    const { scanSignals } = await import("@/lib/signals-scan");
    const res = await scanSignals();
    console.log(`[signals] warm: ${res.rows.length} scanned as of ${res.asOf}`);
  } catch (err) {
    console.warn("[signals] warm failed:", err instanceof Error ? err.message : err);
  }
}

async function safeAiSignalsWarm(): Promise<void> {
  try {
    const { refreshAiSignals } = await import("@/lib/ai-signals");
    const set = await refreshAiSignals();
    if (set) console.log(`[ai-signals] warm: ${set.picks.length} picks, bias ${set.marketBias.direction}, as of ${set.generatedAt}`);
  } catch (err) {
    console.warn("[ai-signals] warm failed:", err instanceof Error ? err.message : err);
  }
}

export function startBackgroundJobs(): void {
  if (g.__egxBgStarted) return;
  g.__egxBgStarted = true;

  // push: first evaluation shortly after boot, then every 5 minutes
  setTimeout(() => void safePushTick(), 10_000).unref?.();
  setInterval(() => void safePushTick(), PUSH_INTERVAL_MS).unref?.();

  // signals scan: warm once after boot, then hourly
  setTimeout(() => void safeSignalsWarm(), SIGNALS_WARM_DELAY_MS).unref?.();
  setInterval(() => void safeSignalsWarm(), SIGNALS_WARM_INTERVAL_MS).unref?.();

  // AI signals: first shared refresh ~90s after boot (needs the scan), then
  // every 30 min — refreshAiSignals no-ops while the newest set is inside
  // its 45-minute cooldown
  setTimeout(() => void safeAiSignalsWarm(), 90_000).unref?.();
  setInterval(() => void safeAiSignalsWarm(), 30 * 60_000).unref?.();

  console.log("[bg] push loop + signals + ai-signals warm started");
}
