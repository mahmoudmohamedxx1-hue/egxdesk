import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { APP_VERSION } from "@/lib/version";

/** GET /api/usage — usage metering for the AI agent (Task 19): questions,
 *  LLM calls, tool calls and web searches served today and over the last 7
 *  days, plus the per-user hourly limit. Makes real AI consumption visible
 *  (the upstream LLM gateway additionally throttles bursts — those are
 *  retried transparently inside /api/agent). Rows older than 30 days are
 *  pruned on each read. */

export const runtime = "nodejs";

const RETENTION_DAYS = 30;

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function GET() {
  try {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const h24 = new Date(Date.now() - 24 * 3600_000);
    const d7 = new Date(Date.now() - 7 * 24 * 3600_000);

    const [todayRows, rows7] = await Promise.all([
      db.usageEvent.findMany({
        where: { createdAt: { gte: dayStart } },
        select: { route: true, llmCalls: true, toolCalls: true, webSearches: true, ok: true, ms: true },
      }),
      db.usageEvent.findMany({
        where: { createdAt: { gte: d7 } },
        select: { createdAt: true, route: true, llmCalls: true, toolCalls: true, webSearches: true },
      }),
    ]);

    // per-day buckets for the last 7 days (local dates). "questions" counts
    // only user-facing agent questions — route "ai-signals" rows are shared
    // compute (one LLM call serving every user), metered separately.
    const byDay = new Map<
      string,
      { date: string; questions: number; llmCalls: number; toolCalls: number; webSearches: number }
    >();
    for (const r of rows7) {
      const key = dayKey(r.createdAt);
      const b = byDay.get(key) ?? { date: key, questions: 0, llmCalls: 0, toolCalls: 0, webSearches: 0 };
      if (r.route === "agent") b.questions += 1;
      b.llmCalls += r.llmCalls;
      b.toolCalls += r.toolCalls;
      b.webSearches += r.webSearches;
      byDay.set(key, b);
    }
    const last7d = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

    const today = {
      questions: todayRows.filter((r) => r.route === "agent").length,
      aiSignalRefreshes: todayRows.filter((r) => r.route === "ai-signals").length,
      llmCalls: todayRows.reduce((s, r) => s + r.llmCalls, 0),
      toolCalls: todayRows.reduce((s, r) => s + r.toolCalls, 0),
      webSearches: todayRows.reduce((s, r) => s + r.webSearches, 0),
      okRate: todayRows.length ? todayRows.filter((r) => r.ok).length / todayRows.length : 1,
      avgMs: todayRows.length ? Math.round(todayRows.reduce((s, r) => s + r.ms, 0) / todayRows.length) : 0,
    };

    // housekeeping (fire-and-forget): keep metering rows bounded
    void db.usageEvent
      .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_DAYS * 24 * 3600_000) } } })
      .catch(() => {});

    return NextResponse.json(
      {
        ok: true,
        version: APP_VERSION,
        limits: {
          agentQuestionsPerHourPerUser: 60,
          note: "per IP or device, persisted in SQLite; the upstream LLM gateway also throttles bursts (auto-retried)",
        },
        today,
        last24h: { questions: rows7.filter((r) => r.createdAt >= h24).length },
        last7d,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "usage unavailable", detail: err instanceof Error ? err.message : "unknown" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
