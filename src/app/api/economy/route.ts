import { NextResponse } from "next/server";
import { fetchEconomy, fetchWorld } from "@/lib/economy";

export const dynamic = "force-dynamic";

/** GET /api/economy — real FX rates, gold, silver, world indices & commodities
 *  for the exchange view. Free public sources, no key.
 *  See src/lib/economy.ts for provenance. */
export async function GET() {
  try {
    const data = await fetchEconomy();
    const usdEgp = data.fx.find((f) => f.code === "USD")?.egpPer ?? null;
    const world = await fetchWorld(usdEgp).catch(() => null);
    return NextResponse.json({
      ...data,
      world,
      fxNote: {
        ar: "أسعار السوق المفتوح من open.er-api.com — مرجع يومي وليست أسعار البنك المركزي الرسمية.",
        en: "Open-market mid-rates from open.er-api.com — a daily reference, not official CBE rates.",
      },
      goldNote: {
        ar: "الذهب والفضة الفوريان عالمياً محوّلين إلى الجنيه بالسعر المفتوح — جرام ٢١ (معيار التجزئة المصري) وجرام ٢٤ وجرام ١٨.",
        en: "International spot gold & silver converted at the open-market rate — 21k (Egyptian retail standard), 24k and 18k per gram.",
      },
      worldNote: {
        ar: "أسعار عالمية حية من ياهو فاينانس — سياق تُقرأ فيه أسعار الجنيه والذهب، وليست أدوات متاحة للتداول هنا.",
        en: "Live world prices from Yahoo Finance — context for the pound and gold, not instruments tradeable here.",
      },
    });
  } catch {
    return NextResponse.json({ error: "economy data unavailable" }, { status: 502 });
  }
}
