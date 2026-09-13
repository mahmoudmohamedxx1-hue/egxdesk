import { NextResponse } from "next/server";
import raw from "@/data/insiders.json";
import { disclosureNews } from "@/lib/news-archive";

/**
 * GET /api/insiders — insider & treasury-share dealing log.
 *
 * Real filings published by the Egyptian Exchange (the exchange's own
 * disclosure records, harvested from esthmr.com's published document on
 * 2026-09-07). Each row is a filed disclosure with its official EGX
 * document id and link. The snapshot carries ~2 months of filings.
 *
 * Task 23 — the esthmr document requires an authenticated re-harvest (the
 * public endpoint answers 401), so between harvests the official rows keep
 * their snapshot as-of date, honestly labelled. So the section never reads
 * as frozen, the response ALSO carries `press`: the newest disclosure-type
 * articles from the live news archive (filings, dividends, AGMs, insider
 * coverage) — real press coverage, kept separate from the official rows and
 * labelled as such. No aggregation and no inference: what the exchange filed
 * is what the filing rows return; what the press reported is what press
 * shows.
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

  // newest disclosure-type press coverage (best-effort — never blocks the
  // official filing rows above)
  const press = await disclosureNews(10).catch(() => []);

  return NextResponse.json({
    asOf: data.asOf,
    source: data.source,
    sourceAr: data.sourceAr,
    basis: data.basis,
    basisAr: data.basisAr,
    summary: data.summary,
    total: items.length,
    items: items.slice(0, limit),
    press,
  });
}
