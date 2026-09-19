import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** /api/agent-signals — the AUTONOMOUS AGENT's public face (T45).
 *
 *  GET  → the full agent state: the weekday schedule (next run + countdown),
 *         the latest successful run's payload (picks + vision reads + journal
 *         + the learning snapshot), the live learning state, the journal
 *         lessons and the recent run history (successes AND failures).
 *         T47: also `auth` — whether a Supabase account is signed in on this
 *         browser (its email; runs triggered now are attributed to it).
 *
 *  POST → a guarded MANUAL trigger (rate-limited: one run of any kind per 10
 *         minutes). The run happens in the background — the response returns
 *         immediately with { started: true } and the next GETs reflect
 *         progress. This exists so a user can see the agent work NOW instead
 *         of waiting for the next weekday slot; it is the same single-flight
 *         pipeline the scheduler fires. T47: a signed-in Supabase account's
 *         identity is captured BEFORE the fire-and-forget (cookies() context
 *         dies with the request) and attributed to the mirrored rows. */

export async function GET() {
  try {
    const { getAgentState } = await import("@/lib/hermes-agent");
    const { nextAgentRun, AGENT_SLOTS } = await import("@/lib/agent-scheduler");
    const state = await getAgentState();
    const next = nextAgentRun();
    // T47 — the signed-in Supabase identity (null when signed out; the
    // tokens themselves never leave the HttpOnly cookie)
    let auth: { signedIn: boolean; user: { id: string; email: string | null } | null } = { signedIn: false, user: null };
    try {
      const { SB_SESSION_COOKIE, sbCurrentUser } = await import("@/lib/supabase-auth");
      const jar = await cookies();
      const { user } = await sbCurrentUser(jar.get(SB_SESSION_COOKIE)?.value);
      auth = { signedIn: user !== null, user };
    } catch {}
    // T47 — verify the mirror honestly (a fresh "ok" has never written yet;
    // the probe checks the agent tables really exist, 5-min cache)
    try {
      const { probeMirrorState } = await import("@/lib/supabase-mirror");
      await probeMirrorState();
    } catch {}
    return NextResponse.json(
      {
        ...state,
        auth,
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
    // T47 — capture the signed-in Supabase user BEFORE fire-and-forget
    let user: { id: string; email: string | null } | null = null;
    try {
      const { SB_SESSION_COOKIE, sbCurrentUser } = await import("@/lib/supabase-auth");
      const jar = await cookies();
      const r = await sbCurrentUser(jar.get(SB_SESSION_COOKIE)?.value);
      user = r.user;
    } catch {}
    // fire and forget — the pipeline is single-flight and self-recording
    void runHermesAgent("manual", user).catch(() => {});
    return NextResponse.json({ ok: true, started: true, attributedTo: user?.email ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "trigger failed", detail: err instanceof Error ? err.message : "unknown" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
