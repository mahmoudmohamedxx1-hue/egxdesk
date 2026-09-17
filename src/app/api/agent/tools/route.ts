import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { runAgentTool, AGENT_TOOLS } from "@/lib/agent-core";

/** POST /api/agent/tools — single server-side tool execution for the
 *  CLIENT-side agent loop (T33). When the user picks a free Puter cloud
 *  model (GPT-OSS 20B, GLM-5.3, Claude, Gemini…), the plan/answer LLM
 *  rounds run in the browser through puter.js, but every TOOL still
 *  executes HERE — the same real (delayed ~15 min) data layer, the same
 *  runners as the server loop in /api/agent, one tool per call.
 *
 *  Body: { tool: string, args?: object, lang?: "ar"|"en", deviceId?: string }
 *  Reply: { ok: boolean, result: unknown } — result may itself carry an
 *  { error: … } field for tool-level failures (ok === false then, mirroring
 *  the SSE loop's step semantics).
 *
 *  Guardrails: a per-IP rolling 240-calls/10-minute memory limit (the LLM
 *  loop caps itself at 10 tools per question, so honest clients sit far
 *  below it), each execution metered as a UsageEvent row (route "agent-tool")
 *  so /api/usage stays truthful. NO LLM cost server-side — this route never
 *  calls a model, it only serves data. */

export const runtime = "nodejs";

const TOOL_RATE_LIMIT = 240; // per IP per 10 minutes
const WINDOW_MS = 10 * 60_000;

const rateMap = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (rateMap.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= TOOL_RATE_LIMIT) {
    rateMap.set(ip, arr);
    return true;
  }
  arr.push(now);
  rateMap.set(ip, arr);
  if (rateMap.size > 500) {
    for (const [k, v] of rateMap) if (v.every((t) => now - t >= WINDOW_MS)) rateMap.delete(k);
  }
  return false;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";

  let body: { tool?: unknown; args?: unknown; lang?: unknown; deviceId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const tool = typeof body.tool === "string" ? body.tool : "";
  if (!tool) {
    return NextResponse.json({ ok: false, error: "tool required" }, { status: 400 });
  }
  if (!AGENT_TOOLS.some((t) => t.name === tool)) {
    return NextResponse.json(
      { ok: false, error: `unknown tool "${tool.slice(0, 40)}"`, available: AGENT_TOOLS.map((t) => t.name) },
      { status: 400 }
    );
  }
  const args =
    body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : {};
  const deviceId =
    typeof body.deviceId === "string" && body.deviceId.length >= 8 ? body.deviceId.slice(0, 64) : null;

  if (rateLimited(ip)) {
    return NextResponse.json({ ok: false, error: "rate limited — try again later" }, { status: 429 });
  }

  const t0 = Date.now();
  const result = await runAgentTool(tool, args);
  const ok = !(result && typeof result === "object" && "error" in (result as Record<string, unknown>));

  // metering — data-only executions, never blocks the reply
  void db.usageEvent
    .create({
      data: {
        ip,
        deviceId,
        route: "agent-tool",
        llmCalls: 0,
        toolCalls: 1,
        webSearches: 0,
        ok,
        ms: Date.now() - t0,
      },
    })
    .catch(() => {});

  return NextResponse.json({ ok, result }, { headers: { "Cache-Control": "no-store" } });
}
