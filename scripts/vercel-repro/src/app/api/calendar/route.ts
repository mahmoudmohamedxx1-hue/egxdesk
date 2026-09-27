import { NextResponse } from "next/server";
import { fetchCalendar } from "@/lib/events";

export const dynamic = "force-dynamic";

/** GET /api/calendar — announced EGX events organized by date:
 *  expected earnings releases (TradingView), upcoming dividend ex/pay dates
 *  (stockanalysis.com), and general-assembly announcements from the real
 *  news archive (press-reported, article-linked). Announcements only —
 *  never forecasts. No auth, no mock. */
export async function GET() {
  try {
    const data = await fetchCalendar();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "calendar unavailable" }, { status: 502 });
  }
}
