import { NextResponse } from "next/server";

/** GET /api — a real index of the public API surface (T74: replaced the
 *  Next.js scaffold "Hello, world!" leftover — a product whose docs view
 *  promises honest endpoints should not greet crawlers with scaffold
 *  output at its API root). */
export async function GET() {
  return NextResponse.json({
    name: "EGX Desk API",
    docs: "/?view=api-docs",
    health: "/api/health",
    endpoints: [
      "/api/health",
      "/api/overview",
      "/api/companies",
      "/api/company/[ticker]",
      "/api/sectors",
      "/api/chart?symbol=&range=",
      "/api/news",
      "/api/news-feed",
      "/api/crossings",
      "/api/investors",
      "/api/flows",
      "/api/insiders",
      "/api/economy",
      "/api/funds",
      "/api/fear-greed",
      "/api/valuation-map",
      "/api/ownership-lens",
      "/api/usage",
      "/api/api-docs",
    ],
    note: "Every response carries its own source and as-of; see the in-app API docs view for the full contract.",
  });
}
