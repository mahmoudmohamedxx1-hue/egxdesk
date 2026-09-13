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
 *  4. Desk reports scheduler (Task 22): every 10 minutes check the Cairo
 *     clock — while the EGX session is open, publish ONE shared report per
 *     trading hour; shortly after the close, publish the final end-of-day
 *     report. maybeGenerateReport no-ops when the due report already exists,
 *     so the cadence is exact and the cost stays one call per report.
 *
 *  Guarded by a globalThis flag so dev hot-reloads / route module isolation
 *  can never start a second copy of the same interval. */

import { evaluateDevices } from "@/lib/push";

const g = globalThis as unknown as { __egxBgStarted?: boolean };

const PUSH_INTERVAL_MS = 5 * 60_000;
const SIGNALS_WARM_DELAY_MS = 15_000;
const SIGNALS_WARM_INTERVAL_MS = 60 * 60_000;
const REPORT_CHECK_INTERVAL_MS = 10 * 60_000;

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

async function safeDeskReportTick(): Promise<void> {
  try {
    const { maybeGenerateReport } = await import("@/lib/hourly-report");
    // maybeGenerateReport itself decides what is due (hourly while open /
    // EOD after the close) and no-ops when the report already exists
    await maybeGenerateReport();
  } catch (err) {
    console.warn("[desk-report] tick failed:", err instanceof Error ? err.message : err);
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

  // desk reports: first check ~2 min after boot (needs the scan warm), then
  // every 10 minutes — publishes the hourly report while the market is open
  // and the EOD report after the close, exactly once each
  setTimeout(() => void safeDeskReportTick(), 2 * 60_000).unref?.();
  setInterval(() => void safeDeskReportTick(), REPORT_CHECK_INTERVAL_MS).unref?.();

  console.log("[bg] push loop + signals + ai-signals warm + desk reports started");
}
