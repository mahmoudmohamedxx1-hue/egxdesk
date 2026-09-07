import { NextResponse } from "next/server";
import raw from "@/data/insiders.json";

/**
 * GET /api/insiders — insider & treasury-share dealing log.
 *
 * Real filings published by the Egyptian Exchange (the exchange's own
 * disclosure records, harvested from esthmr.com's published document on
 * 2026-09-07). Each row is a filed disclosure with its official EGX
 * document id and link. The snapshot carries ~2 months of filings; it is
 * labelled with its as-of date and refreshes when a newer document is
 * harvested. No aggregation and no inference: what the exchange filed is
 * what this returns.
 */

type Item = {
  id: string;
  filingId: string;
  date: string;
  ticker: string;
  companyAr: string;
  company: string;
  sectorAr: string;
  action: string;
  actionLabelAr: string;
  actionLabel: string;
  relationshipLabelAr: string;
  relationshipLabel: string;
  positionRaw: string | null;
  shares: number | null;
  title: string;
  titleEn: string;
  link: string;
};

type Payload = {
  asOf: string;
  updatedAt: string;
  source: string;
  sourceAr: string;
  basis: string;
  basisAr: string;
  summary: {
    totalRecords: number;
    buyCount: number;
    sellCount: number;
    treasuryBuyCount: number;
    treasurySellCount: number;
    totalBuyShares: number;
    totalSellShares: number;
    activeCompaniesCount: number;
    activeTreasuryCompanies: string[];
    latestSession: string;
    earliestSession: string;
  };
  items: Item[];
};

const data = raw as unknown as Payload;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filter = url.searchParams.get("filter") ?? "all"; // all | buys | sells | treasury
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 200) || 200, 400);

  let items = data.items;
  if (filter === "buys") items = items.filter((i) => i.action === "bought");
  if (filter === "sells") items = items.filter((i) => i.action === "sold");
  if (filter === "treasury") items = items.filter((i) => i.action.startsWith("treasury"));

  return NextResponse.json({
    asOf: data.asOf,
    source: data.source,
    sourceAr: data.sourceAr,
    basis: data.basis,
    basisAr: data.basisAr,
    summary: data.summary,
    total: items.length,
    items: items.slice(0, limit),
  });
}
