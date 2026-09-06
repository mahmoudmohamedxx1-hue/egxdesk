import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/investors — period-to-date investor category flows as
 * published by the exchange.
 */
export async function GET() {
  const flows = await db.investorFlow.findMany({
    where: { dataset: "live" },
  });
  const totalValue = flows.reduce((acc, f) => acc + f.buyValue, 0);
  const instShare = 38.72;
  const retailShare = 61.28;

  return NextResponse.json({
    asOf: "2026-09-06 10:57 (القاهرة)",
    totalValue,
    institutionalShare: instShare,
    retailShare,
    categories: flows.map((f) => ({
      nameAr: f.categoryAr,
      nameEn: f.categoryEn,
      sharePct: f.sharePct,
      buyValue: f.buyValue,
      sellValue: f.sellValue,
      netFlow: f.netFlow,
    })),
  });
}
