import { NextResponse } from "next/server";
import { fetchUniverse } from "@/lib/market";
import { getEnrichedFeedCached, type NewsSnapshot } from "@/lib/news-sources";
import snapshotDoc from "@/data/news-snapshot.json";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const snapshot = snapshotDoc as unknown as NewsSnapshot;

/** GET /api/news-feed — the esthmr-grade multi-outlet feed behind the
 *  Updates section's news screen (المستجدات → الأخبار).
 *
 *  Reads the SAME Egyptian financial outlets the source terminal reads
 *  (Al Borsa, Hapi, Arab Finance, Al Mal, Enterprise + Amwal Al Ghad),
 *  merges duplicate stories across outlets, withholds recommendation
 *  headlines, classifies events, matches EGX tickers and flags unusual
 *  session volume for matched names — every honesty number published in
 *  `provenance`. Unreachable outlets are listed, never faked; an outlet the
 *  runtime network loses but the daily snapshot reached is served FROM the
 *  snapshot (noted in provenance.archivedFrom with its stamp). */
export async function GET() {
  try {
    const feed = await getEnrichedFeedCached(
      async () => (await fetchUniverse()).map((s) => ({ ticker: s.ticker, name: s.name, volume: s.volume, avgVolume: s.avgVolume })),
      snapshot,
    );
    return NextResponse.json({ provenance: feed.provenance, items: feed.items });
  } catch (e) {
    return NextResponse.json(
      { error: "news feed unavailable", detail: String((e as Error)?.message ?? e).slice(0, 120) },
      { status: 502 },
    );
  }
}
