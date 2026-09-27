// Probe TV scanner columns for EGX — see what's really populated
const COLS = [
  "name", "close", "change", "market_cap_basic", "sector", "industry",
  "total_revenue_ttm", "net_margin_ttm", "average_turnover_30d_calc",
  "float_shares_outstanding", "revenue_growth_quarterly",
  "High.1M", "Low.1M", "beta_1_year",
  "price_earnings_ttm", "price_book_fq", "debt_to_equity", "return_on_equity",
  "net_income_ttm", "dividend_payout_ratio_ttm", "gross_margin_ttm",
  "net_debt", "number_of_employees", "earnings_release_date",
];

const res = await fetch("https://scanner.tradingview.com/egypt/scan", {
  method: "POST",
  headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36" },
  body: JSON.stringify({
    filter: [{ left: "market", operation: "equal", right: "egypt" }],
    columns: COLS,
    range: [0, 60],
  }),
});
console.log("HTTP", res.status);
const j = await res.json();
const rows = j.data ?? [];
console.log("rows:", rows.length);
// count non-null per column
COLS.forEach((c, idx) => {
  const n = rows.filter((r) => r.d[idx] != null && r.d[idx] !== "").length;
  console.log(`${c}: ${n}/${rows.length}`);
});
const one = rows.find((r) => (r.d[6] ?? null) != null);
if (one) console.log("sample with revenue:", one.s, JSON.stringify(one.d));
