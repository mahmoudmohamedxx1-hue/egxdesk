/** Cross-signal market narrative (G15) — one plain-language sentence-set that
 *  joins the index move, breadth, flows and sector extremes into a readable
 *  story. Deterministic templates over the same numbers the home page shows —
 *  no invented claims, no LLM, every clause traceable to a field. */

export type NarrativeInput = {
  indexName: string;
  indexChangePct: number | null;
  up: number;
  down: number;
  total: number;
  flows: { egyNet: number; arabNet: number; forNet: number } | null;
  bestSector: string | null;
  worstSector: string | null;
  topMover: { ticker: string; changePct: number } | null;
};

/** Format a net-flow figure the investors view serves (EGP millions). */
function egpMn(v: number): string {
  const mn = v; // values arrive in EGP millions (flowsSummary contract)
  return `${mn >= 1000 ? `${(mn / 1000).toFixed(1)}bn` : mn.toFixed(0)}m`;
}

/** Build the narrative in the requested language. Returns null when the
 *  inputs are too thin to say anything honest. */
export function marketNarrative(d: NarrativeInput, lang: "ar" | "en"): string | null {
  if (d.indexChangePct == null || !Number.isFinite(d.indexChangePct)) return null;
  const chg = d.indexChangePct;
  const dir =
    chg > 0.15 ? (lang === "ar" ? "صاعد" : "up")
    : chg < -0.15 ? (lang === "ar" ? "هابط" : "down")
    : lang === "ar" ? "شبه ثابت" : "little changed";

  // sentence 1: index + breadth
  const s1 =
    lang === "ar"
      ? `${d.indexName} ${dir} ${Math.abs(chg).toFixed(2)}٪، واتساع الحركة ${d.up} صاعداً مقابل ${d.down} هابطاً من ${d.total} سهم — ${
          d.up > d.down * 1.3 ? "يوم عريض للصعود" : d.down > d.up * 1.3 ? "يوم عريض للهبوط" : "يوم متوازن نسبياً"
        }.`
      : `${d.indexName} is ${dir} ${Math.abs(chg).toFixed(2)}% with breadth at ${d.up} up versus ${d.down} down of ${d.total} — ${
          d.up > d.down * 1.3 ? "a broad up day" : d.down > d.up * 1.3 ? "a broad down day" : "a fairly balanced day"
        }.`;

  // sentence 2: who moved the money (flows, when present)
  let s2 = "";
  if (d.flows && Number.isFinite(d.flows.forNet) && Math.abs(d.flows.forNet) > 0) {
    const f = d.flows;
    const buyers =
      f.egyNet >= f.arabNet && f.egyNet >= f.forNet ? { ar: "المصريون", en: "Egyptians", v: f.egyNet }
      : f.arabNet >= f.forNet ? { ar: "العرب", en: "Arabs", v: f.arabNet }
      : { ar: "الأجانب", en: "Foreigners", v: f.forNet };
    const sellers =
      f.egyNet <= f.arabNet && f.egyNet <= f.forNet ? { ar: "المصريون", en: "Egyptians", v: f.egyNet }
      : f.arabNet <= f.forNet ? { ar: "العرب", en: "Arabs", v: f.arabNet }
      : { ar: "الأجانب", en: "Foreigners", v: f.forNet };
    const sign = (v: number) => (v >= 0 ? "+" : "−");
    s2 =
      lang === "ar"
        ? `${buyers.ar} ${sign(buyers.v)}${egpMn(Math.abs(buyers.v))} جنيه صافي، مقابل ${sellers.ar} ${sign(sellers.v)}${egpMn(Math.abs(sellers.v))} — أيدي على الطاولة اليوم.`
        : `${buyers.en} ${sign(buyers.v)}${egpMn(Math.abs(buyers.v))} EGP net against ${sellers.en} ${sign(sellers.v)}${egpMn(Math.abs(sellers.v))} — the hands on the table today.`;
  }

  // sentence 3: sector extremes + top mover
  let s3 = "";
  if (d.bestSector && d.worstSector && d.bestSector !== d.worstSector) {
    s3 =
      lang === "ar"
        ? `قطاعياً: ${d.bestSector} في الصدارة و${d.worstSector} في المؤخرة`
        : `By sector: ${d.bestSector} leads while ${d.worstSector} lags`;
    if (d.topMover && Number.isFinite(d.topMover.changePct) && Math.abs(d.topMover.changePct) >= 5) {
      s3 +=
        lang === "ar"
          ? `، وأكبر حركة فردية ${d.topMover.ticker} (${d.topMover.changePct >= 0 ? "+" : ""}${d.topMover.changePct.toFixed(1)}٪).`
          : `, with the biggest single move from ${d.topMover.ticker} (${d.topMover.changePct >= 0 ? "+" : ""}${d.topMover.changePct.toFixed(1)}%).`;
    } else {
      s3 += lang === "ar" ? "." : ".";
    }
  }

  return [s1, s2, s3].filter(Boolean).join(" ") || null;
}
