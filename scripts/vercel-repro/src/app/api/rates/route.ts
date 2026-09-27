import { NextResponse } from "next/server";
import { fetchRates } from "@/lib/rates";

export const dynamic = "force-dynamic";

/** GET /api/rates — Egypt interest-rate context: the CBE main policy rate,
 *  overnight lending rate, and the daily interbank rate, plus the next
 *  scheduled rate decision date. Parsed from Trading Economics' public
 *  Egypt pages (central-bank data). No auth, no mock. */
export async function GET() {
  try {
    const data = await fetchRates();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "rates unavailable" }, { status: 502 });
  }
}
