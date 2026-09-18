import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** /api/agent-signals — the AUTONOMOUS AGENT's public face (T45).
 *
 *  GET  → the full agent state: the weekday schedule (next run + countdown),
 *         the latest successful run's payload (picks + vision reads + journal
 *         + the learning snapshot), the live learning state, the journal
 *         lessons and the recent run history (successes AND failures).
 *
 *  POST → a guarded MANUAL trigger (rate-limited: one run of any kind per 10
 *         minutes). The run happens in the background — the response returns
 *         immediately with { started: true } and the next GETs reflect
 *         progress. This exists so a user can see the agent work NOW instead
 *         of waiting for the next weekday slot; it is the same single-flight
 *         pipeline the scheduler fires. */

export async function GET() {
  try {
    const { getAgentState } = await import("@/lib/hermes-agent");
    const { nextAgentRun, AGENT_SLOTS } = await import("@/lib/agent-scheduler");
    const state = await getAgentState();
    const next = nextAgentRun();
    return NextResponse.json(
      {
        ...state,
        schedule: {
          slots: AGENT_SLOTS.map((s) => ({ kind: s.kind, labelAr: s.labelAr, labelEn: s.labelEn })),
          next: {
            kind: next.kind,
            at: next.at.toISOString(),
            inMs: Math.max(0, next.at.getTime() - Date.now()),
            labelAr: next.labelAr,
            labelEn: next.labelEn,
          },
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "agent state unavailable", detail: err instanceof Error ? err.message : "unknown" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function POST() {
  try {
    const { canTriggerManual, runHermesAgent } = await import("@/lib/hermes-agent");
    const guard = await canTriggerManual();
    if (!guard.ok) {
      return NextResponse.json(
        { ok: false, started: false, reason: guard.reason ?? "busy" },
        { status: 429, headers: { "Cache-Control": "no-store" } }
      );
    }
    // fire and forget — the pipeline is single-flight and self-recording
    void runHermesAgent("manual").catch(() => {});
    return NextResponse.json({ ok: true, started: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "trigger failed", detail: err instanceof Error ? err.message : "unknown" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
