import { NextResponse } from "next/server";
import { fetchUniverse } from "@/lib/market";
import { fetchFlows, indexHistory } from "@/lib/flows";

/** GET /api/fear-greed — مؤشر الخوف والطمع لمصر (T57, foudalens parity).
 *
 *  A transparent, 100%-real-data composite (0-100) with its components
 *  published — exactly like every other number in this app:
 *
 *    1. Breadth (30%) — today's advancers vs decliners across the whole
 *       live universe (real scanner data).
 *    2. EGX30 momentum (25%) — the index's own 1-month return from the
 *       persisted IndexDay archive (EGXBot session reports).
 *    3. EGX30 52-week position (25%) — where the index sits inside its
 *       1-year range from the same archive.
 *    4. Foreign flows (20%) — today's foreign net trading (EGP mn) from the
 *       exchange's investor-category figures.
 *
 *  Each component is mapped linearly onto 0-100 with published caps, then
 *  weighted. Buckets: 0-24 extreme fear · 25-44 fear · 45-55 neutral ·
 *  56-75 greed · 76-100 extreme greed. No hidden formula: the response
 *  carries every component's raw value and its normalized score. */

export const dynamic = "force-dynamic";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lin = (v: number, lo: number, hi: number) => clamp01((v - lo) / (hi - lo)) * 100;

export async function GET() {
  try {
    const [stocks, egx30_1y, egx30_1m, flows] = await Promise.all([
      fetchUniverse(),
      indexHistory(365, "egx30"),
      indexHistory(31, "egx30"),
      fetchFlows().catch(() => null),
    ]);

    // 1 — breadth
    const up = stocks.filter((s) => s.changePct > 0).length;
    const down = stocks.filter((s) => s.changePct < 0).length;
    const total = up + down;
    const breadth = total > 0 ? 50 + (50 * (up - down)) / total : 50;

    // 2 — EGX30 one-month momentum (±8% maps to 0-100)
    let momentum: number | null = null;
    let momRet: number | null = null;
    if (egx30_1m.length >= 2) {
      const first = egx30_1m[0].close;
      const last = egx30_1m[egx30_1m.length - 1].close;
      momRet = first > 0 ? Math.round(((last - first) / first) * 10000) / 100 : null;
      momentum = momRet == null ? null : lin(momRet, -8, 8);
    }

    // 3 — EGX30 position inside its 1-year range
    let rangePos: number | null = null;
    if (egx30_1y.length >= 2) {
      const closes = egx30_1y.map((r) => r.close);
      const hi = Math.max(...closes);
      const lo = Math.min(...closes);
      const last = closes[closes.length - 1];
      rangePos = hi > lo ? lin((last - lo) / (hi - lo), 0, 1) : 50;
    }

    // 4 — foreign net flows today (±400 EGP mn maps to 0-100)
    const foreignNet = flows?.nationalityNet.foreigners ?? null;
    const foreign = foreignNet != null ? lin(foreignNet, -400, 400) : null;

    // composite with honest weight renormalization when a component is missing
    const parts: { key: string; weight: number; value: number | null; score: number | null }[] = [
      { key: "breadth", weight: 0.3, value: total > 0 ? Math.round(((up - down) / total) * 100) / 100 : null, score: breadth },
      { key: "momentum", weight: 0.25, value: momRet, score: momentum },
      { key: "range52", weight: 0.25, value: null, score: rangePos },
      { key: "foreign", weight: 0.2, value: foreignNet, score: foreign },
    ];
    const avail = parts.filter((p) => p.score != null);
    const wSum = avail.reduce((s, p) => s + p.weight, 0) || 1;
    const score = Math.round(avail.reduce((s, p) => s + (p.score as number) * (p.weight / wSum), 0));

    const bucket =
      score <= 24 ? "extreme-fear" : score <= 44 ? "fear" : score <= 55 ? "neutral" : score <= 75 ? "greed" : "extreme-greed";

    return NextResponse.json(
      {
        ok: true,
        score,
        bucket,
        asOf: new Date().toISOString().slice(0, 10),
        components: parts.map((p) => ({
          key: p.key,
          weight: p.weight,
          raw: p.value,
          score: p.score == null ? null : Math.round(p.score),
          missing: p.score == null,
        })),
        up,
        down,
        noteAr:
          "مؤشر مركّب من مكونات معلنة: اتساع السوق (٣٠٪) + زخم EGX30 الشهري (٢٥٪) + موقعه في مدى ٥٢ أسبوعًا (٢٥٪) + صافي تعاملات الأجانب اليوم (٢٠٪) — كلها من بيانات حقيقية، والمعادلة معلنة بالكامل.",
        noteEn:
          "A composite with published components: market breadth (30%) + EGX30 1-month momentum (25%) + its 52-week range position (25%) + today's foreign net trading (20%) — all real data, the formula fully disclosed.",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "fear-greed unavailable", detail: err instanceof Error ? err.message : "unknown" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
