import { NextResponse } from "next/server";
import { fetchNewsEn } from "@/lib/news-en";
import { scoreSentiment } from "@/lib/sentiment";

export const dynamic = "force-dynamic";

/** GET /api/news-en — English-language Egyptian-market news from the public
 *  Google News RSS aggregation (publishers include Daily News Egypt, Egypt
 *  Today, Zawya, Global Finance and others). Titles link to the original
 *  publishers. 10-minute cache. No auth, no mock.
 *  T26: each item carries a rule-based sentiment chip (finance lexicon —
 *  labeled as linguistic analysis, not AI). */
export async function GET() {
  try {
    const data = await fetchNewsEn();
    const items = data.items.map((n) => ({ ...n, sentiment: scoreSentiment(n.title).sentiment }));
    return NextResponse.json({ ...data, items });
  } catch {
    return NextResponse.json({ error: "english news unavailable" }, { status: 502 });
  }
}
