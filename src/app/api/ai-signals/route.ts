import { NextResponse } from "next/server";
import { getAiSignals } from "@/lib/ai-signals";

/** GET /api/ai-signals — the AI Signals section (Task 20).
 *
 *  PUBLIC AND FREE BY DESIGN: this endpoint serves the SHARED, cached signal
 *  set (one LLM synthesis call per 45-minute cycle, persisted in SQLite) plus
 *  the walk-forward backtest evidence for the strategy charter. Unlimited
 *  reads cost zero additional AI calls — that shared-compute pattern is what
 *  lets the section stay totally free for every visitor. No per-user limit,
 *  no auth. First-ever call (cold cache) may take up to ~60s to warm. */

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const waitParam = Number(url.searchParams.get("wait"));
  const waitMs = Number.isFinite(waitParam) && waitParam >= 0 ? Math.min(waitParam, 120_000) : 60_000;
  try {
    const payload = await getAiSignals(waitMs);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "ai-signals unavailable", detail: err instanceof Error ? err.message : "unknown" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
