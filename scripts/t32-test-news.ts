/** Unit sanity test for the NEWS pillar of the composite signal (T32).
 *  Verifies via the scoreArticleList seam: window filtering, recency
 *  decay, intensity saturation, aggregate clamping, null-on-zero-coverage,
 *  bilingual reason lines, and the rating thresholds. */

import { scoreArticleList, NEWS_WINDOW_DAYS, type NewsScore } from "@/lib/news-score";
import { scoreSentiment, tickersInText } from "@/lib/sentiment";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label} ${extra}`);
  }
}

const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86_400_000);

console.log("1) window + null-on-zero");
{
  const s = scoreArticleList([]);
  ok(s.score === null, "no articles → score null");
  ok(s.count === 0, "no articles → count 0");
  ok(s.rating === "neutral", "no coverage → neutral rating");
  ok(s.reasons.length === 0 && s.reasonsAr.length === 0, "no coverage → no reasons");
  const old = scoreArticleList([{ title: "أرباح قياسية", snippet: null, publishedAt: daysAgo(NEWS_WINDOW_DAYS + 2) }]);
  ok(old.count === 0 && old.score === null, "article outside the 14-day window is dropped");
  const edge = scoreArticleList([{ title: "أرباح قياسية", snippet: null, publishedAt: daysAgo(NEWS_WINDOW_DAYS - 0.5) }]);
  ok(edge.count === 1, "article just inside the window counts");
}

console.log("2) sentiment + intensity");
{
  const r = scoreSentiment("ارتفاع قياسي", "نمو وأرباح مرتفعة");
  ok(r.score > 0 && r.sentiment === "bullish", "bullish Arabic lexicon hit", JSON.stringify(r));
  const b = scoreSentiment("خسائر وتراجع حاد", "انخفاض");
  ok(b.score < 0 && b.sentiment === "bearish", "bearish Arabic lexicon hit", JSON.stringify(b));
  const n = scoreSentiment("اجتماع مجلس الإدارة", null);
  ok(n.score === 0 && n.sentiment === "neutral", "no lexicon hit → neutral");

  // one strongly-bullish article today: intensity clamps to +1, weight 1.0
  const s1 = scoreArticleList([{ title: "أرباح قياسية ونمو", snippet: "ارتفاع", publishedAt: daysAgo(0) }]);
  ok(s1.count === 1 && s1.bull === 1, "single bullish article counted bull");
  ok(s1.score !== null && s1.score > 0 && s1.score <= 1 / 3, "single article never saturates (÷3)", String(s1.score));

  // one strongly-bearish article today
  const s2 = scoreArticleList([{ title: "خسائر وتراجع حاد", snippet: "انخفاض", publishedAt: daysAgo(0) }]);
  ok(s2.score !== null && s2.score < 0 && s2.score >= -1 / 3, "single bearish article is −⅓ at most", String(s2.score));
}

console.log("3) recency weight");
{
  // same article today vs 13 days ago — today's score must be larger
  const fresh = scoreArticleList([{ title: "أرباح قياسية", snippet: null, publishedAt: daysAgo(0) }]);
  const stale = scoreArticleList([{ title: "أرباح قياسية", snippet: null, publishedAt: daysAgo(13) }]);
  ok(
    (fresh.score ?? 0) > (stale.score ?? 0) && (stale.score ?? 0) > 0,
    "recency decay: today > 13-days-old > 0",
    `${fresh.score} vs ${stale.score}`
  );
}

console.log("4) saturation + aggregate clamp");
{
  // 6 same-day maximally-bullish articles: sum = 6 → 6/3 = 2 → clamped to +1
  const rows = Array.from({ length: 6 }, () => ({
    title: "أرباح قياسية ونمو وطفرة",
    snippet: "ارتفاع قياسي",
    publishedAt: daysAgo(0),
  }));
  const s = scoreArticleList(rows);
  ok(s.score === 1, "6 max articles saturate at +1", String(s.score));
  ok(s.bull === 6 && s.bear === 0, "bull/bear counts aggregate");
  // mixed: 3 max-bull today + 3 max-bear today → net 0
  const mixed = scoreArticleList([
    ...Array.from({ length: 3 }, () => ({ title: "أرباح قياسية ونمو", snippet: "ارتفاع", publishedAt: daysAgo(0) })),
    ...Array.from({ length: 3 }, () => ({ title: "خسائر وتراجع حاد", snippet: "انخفاض", publishedAt: daysAgo(0) })),
  ]);
  ok(Math.abs(mixed.score ?? 1) < 0.01, "balanced bull/bear nets ~0", String(mixed.score));
  ok(mixed.count === 6 && mixed.bull === 3 && mixed.bear === 3, "mixed counts tracked");
}

console.log("5) reasons (bilingual)");
{
  const s: NewsScore = scoreArticleList([
    { title: "أرباح قياسية", snippet: null, publishedAt: daysAgo(1) },
    { title: "نمو", snippet: null, publishedAt: daysAgo(2) },
  ]);
  ok(s.reasons.length >= 1 && s.reasons[0].includes("press articles"), "EN reason carries the count", s.reasons[0]);
  ok(s.reasonsAr.length >= 1 && s.reasonsAr[0].includes("مقالات"), "AR reason carries the count", s.reasonsAr[0]);
  const bal = scoreArticleList([{ title: "اجتماع عادي", snippet: null, publishedAt: daysAgo(1) }]);
  ok(bal.reasons.some((r) => r.includes("balanced")), "balanced line present when net 0", bal.reasons.join("|"));
  ok(bal.reasonsAr.some((r) => r.includes("متوازنة")), "AR balanced line present");
}

console.log("6) rating thresholds mirror the family");
{
  const bull = scoreArticleList(Array.from({ length: 6 }, () => ({ title: "أرباح قياسية ونمو", snippet: "ارتفاع", publishedAt: daysAgo(0) })));
  ok(bull.rating === "strongBuy", "saturated bull → strongBuy", bull.rating);
  const bear = scoreArticleList(Array.from({ length: 6 }, () => ({ title: "خسائر وتراجع حاد", snippet: "انخفاض", publishedAt: daysAgo(0) })));
  ok(bear.rating === "strongSell", "saturated bear → strongSell", bear.rating);
}

console.log("7) ticker attribution (the chips matcher)");
{
  const universe = [
    { ticker: "COMI", name: "Commercial International Bank" },
    { ticker: "EAST", name: "Eastern Company" },
    { ticker: "EFID", name: "Edita Food Industries" },
  ];
  const hit = tickersInText("Commercial International Bank reports profit", universe);
  ok(hit.includes("COMI"), "two-word English name attributes COMI", JSON.stringify(hit));
  const arHit = tickersInText("بنك التجارة الدولية يحقق أرباحًا", universe, { COMI: ["التجارة الدولية", "كومي"] });
  ok(arHit.includes("COMI"), "Arabic alias attributes COMI", JSON.stringify(arHit));
  const tickerHit = tickersInText("COMI rises on strong results", universe);
  ok(tickerHit.includes("COMI"), "bare ticker attributes");
  const noHit = tickersInText("Gold prices fall globally", universe);
  ok(noHit.length === 0, "unrelated text attributes nothing", JSON.stringify(noHit));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
