import { NextRequest, NextResponse } from "next/server";
import { fetchDividends } from "@/lib/dividends";

export const dynamic = "force-dynamic";

/** GET /api/dividends/[ticker] — per-company cash dividend history with
 *  ex-date / record date / pay date and per-share amounts, from
 *  stockanalysis.com's public dividend tables. Empty rows = no dividends
 *  published for the company (not an error). No auth, no mock. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await ctx.params;
  const t = decodeURIComponent(ticker).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!t) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }
  try {
    const data = await fetchDividends(t);
    return NextResponse.json({
      ...data,
      note: {
        ar: "المبالغ لكل سهم بالجنيه كما نشرها المصدر. الخانة الفارغة تاريخ لم يُعلن.",
        en: "Amounts are per share in EGP as published by the source. A blank cell is a date not announced.",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "dividend data unavailable", ticker: t },
      { status: 502 }
    );
  }
}
