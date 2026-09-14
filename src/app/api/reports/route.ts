import { NextRequest, NextResponse } from "next/server";
import { getReports, getReportById, type ReportsResponse } from "@/lib/hourly-report";

/** GET /api/reports — the Market Desk Reports section (Task 22).
 *
 *  Public, free, unlimited reads: every report is shared compute (one LLM
 *  call + 2-3 web searches per report, persisted in SQLite and served to
 *  EVERY visitor from cache). While the market is open a new hourly report
 *  appears each Cairo trading hour; after the close the final end-of-day
 *  report. A due report regenerates in the background (stale-while-
 *  revalidate) so a visitor never waits for it.
 *
 *  Params: ?id=<reportId> serves one specific report (deep links / exports);
 *  ?wait=0 skips the cold-start wait (used by background polls). */

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const report = await getReportById(id.slice(0, 64));
    if (!report) return NextResponse.json({ error: "no such report" }, { status: 404 });
    return NextResponse.json(
      { ok: true, report },
      { headers: { "Cache-Control": "public, max-age=60" } }
    );
  }

  const waitRaw = Number(req.nextUrl.searchParams.get("wait"));
  const waitMs = Number.isFinite(waitRaw) ? Math.min(Math.max(waitRaw, 0) * 1000, 90_000) : 45_000;
  const data: ReportsResponse = await getReports(waitMs);
  return NextResponse.json(data, { headers: { "Cache-Control": "public, max-age=60" } });
}
