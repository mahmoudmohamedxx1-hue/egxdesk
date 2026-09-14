/** T32 — the NEWS pillar of the composite signal.
 *
 *  A third, fully-independent evidence stream for the per-stock and
 *  whole-market signals: what the Egyptian business press is actually
 *  WRITING about each company. The scorer is transparent and rule-based
 *  (the same bilingual lexicon the news chips use — labeled as such, never
 *  sold as "AI"):
 *
 *    - window: the last 14 days of the archived Arabic press
 *      (Alborsaanews + Amwal Alghad, ~9k real articles in SQLite)
 *    - attribution: ticker / English name words / Arabic brand aliases —
 *      the exact matcher the company "related news" panel uses
 *    - per article: scoreSentiment (title double-weighted), intensity
 *      clamped to ±1 (a headline with 2+ lexicon hits saturates)
 *    - recency weight: 1.0 today → 0.25 at the window edge
 *    - aggregate: sum / SATURATION(3) clamped to −1 … +1, so a single
 *      article never swings the pillar to full bull/bear
 *    - count === 0 → null (the pillar is omitted, weights renormalize —
 *      a stock with no coverage is never punished or rewarded)
 *
 *  The whole-universe map is computed in ONE pass over the recent window
 *  and cached 10 minutes (news refresh cadence is minutes). */

import { db } from "./db";
import { scoreSentiment, tickersInText } from "./sentiment";
import { ratingFromScore, type Rating } from "./fundamentals";
import { AR_ALIASES } from "./news-archive";

export const NEWS_WINDOW_DAYS = 14;
const SATURATION = 3; // net weighted articles that saturate the pillar
const CACHE_TTL_MS = 10 * 60_000;
const MAX_ARTICLES = 900; // hard cap on the window scan

export type NewsScore = {
  score: number | null; // −1 … +1, null when no coverage in the window
  rating: Rating;
  count: number; // attributed articles in the window
  bull: number;
  bear: number;
  neutral: number;
  latest: string | null; // ISO date of the newest attributed article
  reasons: string[]; // short EN evidence lines
  reasonsAr: string[];
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

type Acc = {
  sum: number;
  count: number;
  bull: number;
  bear: number;
  neutral: number;
  latest: number; // epoch ms
};

function finalize(a: Acc): NewsScore {
  const score = clamp(a.sum / SATURATION, -1, 1);
  const net = a.bull - a.bear;
  const reasons: string[] = [];
  const reasonsAr: string[] = [];
  if (a.count > 0) {
    reasons.push(
      `${a.count} press articles in ${NEWS_WINDOW_DAYS} days — ${a.bull} bullish / ${a.bear} bearish / ${a.neutral} neutral`
    );
    reasonsAr.push(
      `${a.count} مقالات صحفية خلال ${NEWS_WINDOW_DAYS} يومًا — ${a.bull} صعودية / ${a.bear} هابطة / ${a.neutral} محايدة`
    );
    if (net > 0) {
      reasons.push(`net positive coverage (${net} more bullish than bearish)`);
      reasonsAr.push(`تغطية صافية إيجابية (${net} مقالات صعودية أكثر من الهابطة)`);
    } else if (net < 0) {
      reasons.push(`net negative coverage (${-net} more bearish than bullish)`);
      reasonsAr.push(`تغطية صافية سلبية (${-net} مقالات هابطة أكثر من الصعودية)`);
    } else {
      reasons.push("balanced press coverage");
      reasonsAr.push("تغطية صحفية متوازنة");
    }
  }
  return {
    score: a.count > 0 ? Number(score.toFixed(3)) : null,
    rating: ratingFromScore(a.count > 0 ? score : null),
    count: a.count,
    bull: a.bull,
    bear: a.bear,
    neutral: a.neutral,
    latest: a.latest > 0 ? new Date(a.latest).toISOString() : null,
    reasons,
    reasonsAr,
  };
}

function scoreRows(
  rows: { title: string; snippet: string | null; publishedAt: Date }[]
): NewsScore {
  const a: Acc = { sum: 0, count: 0, bull: 0, bear: 0, neutral: 0, latest: 0 };
  const now = Date.now();
  for (const r of rows) {
    const s = scoreSentiment(r.title, r.snippet);
    const ageDays = (now - r.publishedAt.getTime()) / 86_400_000;
    if (ageDays > NEWS_WINDOW_DAYS) continue; // outside the signal window
    const w = Math.max(0.25, 1 - ageDays / NEWS_WINDOW_DAYS);
    const val = clamp(s.score / 2, -1, 1); // intensity, saturated at 2 lexicon hits
    a.sum += w * val;
    a.count++;
    if (s.sentiment === "bullish") a.bull++;
    else if (s.sentiment === "bearish") a.bear++;
    else a.neutral++;
    if (r.publishedAt.getTime() > a.latest) a.latest = r.publishedAt.getTime();
  }
  return finalize(a);
}

// ── whole-universe map (one pass, 10-minute TTL) ──

type UniEntry = { at: number; data: Map<string, NewsScore> };
let uniCache: UniEntry | null = null;

/** Per-ticker news scores for the entire live universe — ONE query + ONE
 *  attribution pass over the recent window, shared by the market scan. */
export async function newsScoresForUniverse(
  universe: { ticker: string; name: string }[]
): Promise<Map<string, NewsScore>> {
  if (uniCache && Date.now() - uniCache.at < CACHE_TTL_MS) return uniCache.data;
  const since = new Date(Date.now() - NEWS_WINDOW_DAYS * 86_400_000);
  const rows = await db.newsPost.findMany({
    where: { publishedAt: { gte: since } },
    orderBy: { publishedAt: "desc" },
    take: MAX_ARTICLES,
    select: { title: true, snippet: true, publishedAt: true },
  });
  const acc = new Map<string, Acc>();
  for (const r of rows) {
    const text = `${r.title} ${r.snippet ?? ""}`;
    const s = scoreSentiment(r.title, r.snippet);
    const ageDays = (Date.now() - r.publishedAt.getTime()) / 86_400_000;
    const w = Math.max(0.25, 1 - ageDays / NEWS_WINDOW_DAYS);
    const val = clamp(s.score / 2, -1, 1);
    const tickers = tickersInText(text, universe, AR_ALIASES);
    for (const t of tickers) {
      const a =
        acc.get(t) ?? { sum: 0, count: 0, bull: 0, bear: 0, neutral: 0, latest: 0 };
      a.sum += w * val;
      a.count++;
      if (s.sentiment === "bullish") a.bull++;
      else if (s.sentiment === "bearish") a.bear++;
      else a.neutral++;
      if (r.publishedAt.getTime() > a.latest) a.latest = r.publishedAt.getTime();
      acc.set(t, a);
    }
  }
  const data = new Map<string, NewsScore>();
  for (const [t, a] of acc) data.set(t, finalize(a));
  uniCache = { at: Date.now(), data };
  return data;
}

// ── single-ticker score (company page / AI agent) ──

/** News pillar for ONE stock: newest attributed articles scored over the
 *  14-day window. Mirrors the related-news matcher (ticker + English name
 *  words + Arabic brand aliases). */
export async function newsScoreForTicker(
  ticker: string,
  name: string
): Promise<NewsScore> {
  const t = ticker.toUpperCase();
  // reuse the shared matcher from news-archive via a lightweight query here
  const tickerRe = new RegExp(`\\b${t.replace(/[^A-Z0-9]/g, "")}\\b`, "i");
  const words = name
    .split(/[^A-Za-z]+/)
    .filter(
      (w) =>
        w.length > 3 &&
        !["Egypt", "Egyptian", "Company", "S.A.E", "Holding", "Limited", "Corporation"].includes(w)
    )
    .slice(0, 2)
    .map((w) => new RegExp(`\\b${w}\\b`, "i"));
  const aliases = (AR_ALIASES[t] ?? []).map(
    (a) => new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  );
  const since = new Date(Date.now() - NEWS_WINDOW_DAYS * 86_400_000);
  const rows = await db.newsPost.findMany({
    where: { publishedAt: { gte: since } },
    orderBy: { publishedAt: "desc" },
    take: MAX_ARTICLES,
    select: { title: true, snippet: true, publishedAt: true },
  });
  const matched = rows.filter((r) => {
    const text = `${r.title} ${r.snippet ?? ""}`;
    return (
      tickerRe.test(text) ||
      aliases.some((re) => re.test(text)) ||
      (words.length > 0 && words.every((re) => re.test(text)))
    );
  });
  return scoreRows(matched);
}

/** Test seam: score an explicit list of articles (unit tests). */
export function scoreArticleList(
  rows: { title: string; snippet: string | null; publishedAt: Date }[]
): NewsScore {
  return scoreRows(rows);
}
