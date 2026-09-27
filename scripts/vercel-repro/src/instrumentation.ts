/** Next.js instrumentation hook — runs once per server process (dev server
 *  boot AND the standalone production server). Starts the background jobs:
 *  the web-push evaluation loop (phone notifications for alerts while the
 *  app is closed) and the hourly cross-market signals warm scan. Node
 *  runtime only — never inside edge middleware. */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackgroundJobs } = await import("@/lib/push-loop");
    startBackgroundJobs();
  }
}
