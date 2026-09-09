import { NextResponse } from "next/server";
import { fetchNewsEn } from "@/lib/news-en";

export const dynamic = "force-dynamic";

/** GET /api/news-en — English-language Egyptian-market news from the public
 *  Google News RSS aggregation (publishers include Daily News Egypt, Egypt
 *  Today, Zawya, Global Finance and others). Titles link to the original
 *  publishers. 10-minute cache. No auth, no mock. */
export async function GET() {
  try {
    const data = await fetchNewsEn();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "english news unavailable" }, { status: 502 });
  }
}
