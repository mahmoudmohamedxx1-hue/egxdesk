import { NextResponse } from "next/server";
import { fetchEconomy } from "@/lib/economy";

export const dynamic = "force-dynamic";

/** GET /api/economy — real FX rates and gold for the exchange view.
 *  Free public sources, no key. See src/lib/economy.ts for provenance. */
export async function GET() {
  try {
    const data = await fetchEconomy();
    return NextResponse.json({
      ...data,
      fxNote: {
        ar: "أسعار السوق المفتوح من open.er-api.com — مرجع يومي وليست أسعار البنك المركزي الرسمية.",
        en: "Open-market mid-rates from open.er-api.com — a daily reference, not official CBE rates.",
      },
      goldNote: {
        ar: "الذهب الفوري عالمياً محوّلاً إلى الجنيه بالسعر المفتوح، جرام ٢١ قيراطاً (معيار التجزئة المصري) وجرام ٢٤.",
        en: "International spot gold converted at the open-market rate — 21k (Egyptian retail standard) and 24k per gram.",
      },
    });
  } catch {
    return NextResponse.json({ error: "economy data unavailable" }, { status: 502 });
  }
}
