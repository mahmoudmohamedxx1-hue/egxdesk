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

export function startBackgroundJobs(): void {
  if (g.__egxBgStarted) return;
  g.__egxBgStarted = true;

  // push: first evaluation shortly after boot, then every 5 minutes
  setTimeout(() => void safePushTick(), 10_000).unref?.();
  setInterval(() => void safePushTick(), PUSH_INTERVAL_MS).unref?.();

  // signals scan: warm once after boot, then hourly
  setTimeout(() => void safeSignalsWarm(), SIGNALS_WARM_DELAY_MS).unref?.();
  setInterval(() => void safeSignalsWarm(), SIGNALS_WARM_INTERVAL_MS).unref?.();

  console.log("[bg] push loop + signals warm started");
}
