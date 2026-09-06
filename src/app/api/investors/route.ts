import { NextResponse } from "next/server";
import { marketStatus } from "@/lib/market-status";
import {
  fetchFlows,
  persistFlowDay,
  ensureHistory,
  flowHistory,
  participationHistory,
  FLOWS_SOURCES,
} from "@/lib/flows";

export const dynamic = "force-dynamic";

/** GET /api/investors — real EGX investor-category flows (buy/sell/net by
 *  Egyptians / Arabs / Foreigners × retail / institutions), participation
 *  history, and stored daily flow history. No auth, no demo data. */
export async function GET() {
  const status = marketStatus();
  let today = null;
  let flowsError = false;
  try {
    today = await fetchFlows();
  } catch {
    flowsError = true;
  }

  // persist the final session figure once the market has closed
  if (today && !status.open) {
    await persistFlowDay(today);
  }

  await ensureHistory();

  const [flows, participation] = await Promise.all([flowHistory(), participationHistory()]);

  if (!today && !flows.length) {
    return NextResponse.json({ error: "investor flows unavailable" }, { status: 502 });
  }

  return NextResponse.json({
    session: {
      asOf: status.cairoDate,
      lastSession: status.lastSession,
      open: status.open,
      cairoTime: status.cairoTime,
    },
    today,
    flowsError,
    history: {
      flows: [...flows].reverse(), // oldest first for charts
      participation,
    },
    sources: FLOWS_SOURCES,
  });
}
