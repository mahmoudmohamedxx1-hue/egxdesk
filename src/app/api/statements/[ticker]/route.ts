import { NextRequest, NextResponse } from "next/server";
import { fetchStatements } from "@/lib/statements";

export const dynamic = "force-dynamic";

/** GET /api/statements/[ticker] — REAL per-period financial statements for
 *  an EGX company (income / balance sheet / cash flow, annual + quarterly
 *  income), scraped live from stockanalysis.com's public pages. Values in
 *  millions of EGP exactly as the source displays them. No auth, no mock. */
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
    const data = await fetchStatements(t);
    if (!data.hasData) {
      return NextResponse.json(
        { error: "no statements published for this company", ticker: t },
        { status: 404 }
      );
    }
    return NextResponse.json({
      ...data,
      note: {
        ar: "القوائم كما ينشرها المصدر بالمليون جنيه؛ الخانة الفارغة رقم لم يُفصح عنه — وليست صفراً. القيم التراكمية كما تُقدَّم.",
        en: "Statements as published by the source, in EGP millions; an empty cell is an undisclosed figure — not zero. Periods are cumulative as filed.",
      },
    });
  } catch {
    return NextResponse.json({ error: "statements unavailable" }, { status: 502 });
  }
}
