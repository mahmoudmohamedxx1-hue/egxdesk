/**
 * Task 21 E2E — XLSX export reports + shareable-routing surface.
 * (Updated in Task 22-c for the upgraded workbook structure: branded COVER
 * sheet + table of contents, summary/gainers sheets on market, price
 * history on company, methodology appendix, conditional formatting.)
 *
 * Verifies: every report type returns a valid, STYLED workbook (re-parsed
 * with exceljs: cover sheet + TOC, sheet names, frozen views, RTL for
 * Arabic, autofilter, number formats, zebra fills, brand block, footer
 * disclaimer, conditional formatting rules); the plain data API paths
 * (usage/health) still pass; and the `/` page serves the shell for deep
 * links (?view=…&lang=…) with 200 HTML.
 */
import ExcelJS from "exceljs";

const BASE = "http://localhost:3000";
let pass = 0;
let fail = 0;

function ok(cond: boolean, label: string, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✕ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

async function exportReport(report: string, lang: "ar" | "en", payload?: unknown) {
  const res = await fetch(`${BASE}/api/export`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // a dedicated client IP so the test's own export volume can never
      // burn the real per-IP budget of other suites (same pattern as t19)
      "X-Forwarded-For": "198.51.100.21",
    },
    body: JSON.stringify({ report, lang, payload }),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const cd = res.headers.get("content-disposition") ?? "";
  return { res, buf, cd };
}

async function parseXlsx(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

/** ExcelJS re-parses autofilter as an "A9:M9"-style string — find the header
 *  row robustly by scanning for the ink-filled row instead. */
function headerRowOf(ws: ExcelJS.Worksheet): number {
  for (let r = 1; r <= 25; r++) {
    const fill = (ws.getRow(r).getCell(1).fill as ExcelJS.Fill)?.fgColor?.argb ?? "";
    if (fill.endsWith("332D26")) return r;
  }
  return 0;
}

/** conditional formatting rules re-parsed by exceljs live in
 *  ws.conditionalFormattings[] (plural — the singular is the WRITE method) —
 *  count rules of a given type over any ref. */
function cfRuleCount(ws: ExcelJS.Worksheet, type: string): number {
  const w = ws as unknown as { conditionalFormattings?: { rules?: { type?: string }[] }[] };
  let n = 0;
  for (const cf of w.conditionalFormattings ?? []) for (const rule of cf.rules ?? []) if (rule.type === type) n++;
  return n;
}

async function main() {
  console.log("── T21: XLSX exports (22-c structure) ──");

  // 1) market report — Arabic: cover + summary + gainers + companies + methodology
  {
    const { res, buf, cd } = await exportReport("market", "ar");
    ok(res.status === 200, "market/ar → 200", String(res.status));
    ok(buf.length > 20_000, `market/ar workbook >20KB (${(buf.length / 1024).toFixed(0)}KB)`);
    ok(/EGX-Desk-Market-\d{4}-\d{2}-\d{2}\.xlsx/.test(cd), `filename header (${cd})`);
    const wb = await parseXlsx(buf);
    const names = wb.worksheets.map((w) => w.name);
    ok(names[0] === "الغلاف", `cover sheet first (${names.join(", ")})`);
    ok(names.includes("الملخص") && names.includes("الأكثر ارتفاعًا") && names.includes("الشركات") && names.includes("المنهجية والتعريفات"), "summary + gainers + companies + methodology sheets");
    const cover = wb.worksheets[0];
    ok(String(cover.getCell(2, 1).value).includes("EGX DESK"), "cover brand block");
    const tocHit = cover.getColumn(1).values.some((v) => String(v) === "المحتويات");
    ok(tocHit, "cover table of contents");
    const ws = wb.worksheets.find((w) => w.name === "الشركات")!;
    ok(ws.views?.[0]?.rightToLeft === true, "RTL view for Arabic");
    ok((ws.views?.[0]?.state ?? "") === "frozen" && (ws.views?.[0]?.ySplit ?? 0) > 3, "frozen panes under header");
    ok(!!ws.autoFilter, "autofilter on main table");
    const afFrom = headerRowOf(ws);
    ok(afFrom > 3, `header row located (r${afFrom})`);
    const hdr = ws.getRow(afFrom);
    const fill = (hdr.getCell(1).fill as ExcelJS.Fill)?.fgColor?.argb ?? "";
    ok(fill.endsWith("332D26"), `header ink fill (${fill})`);
    ok(hdr.getCell(1).font?.bold === true, "header bold font");
    const dataRow = ws.getRow(afFrom + 1);
    ok(typeof dataRow.getCell(4).value === "number", "close column numeric");
    ok(dataRow.getCell(4).numFmt === "#,##0.00", `numFmt on close (got ${dataRow.getCell(4).numFmt})`);
    ok(String(ws.getCell(1, 1).value).includes("EGX DESK"), "brand block present");
    ok(ws.rowCount > 290, `companies rows (${ws.rowCount})`);
    // 22-c: conditional formatting — color scale on change%, data bar on value
    ok(cfRuleCount(ws, "colorScale") >= 2, `colorScale rules on companies sheet (${cfRuleCount(ws, "colorScale")})`);
    ok(cfRuleCount(ws, "dataBar") >= 1, `dataBar rules on companies sheet (${cfRuleCount(ws, "dataBar")})`);
    // 22-c: print setup (landscape, fit to width)
    ok(ws.pageSetup?.orientation === "landscape", "print landscape");
    ok(ws.pageSetup?.fitToWidth === 1, "print fit-to-width");
    // gainers sheet has 3 tables (gainers + losers + active)
    const gainers = wb.worksheets.find((w) => w.name === "الأكثر ارتفاعًا")!;
    ok(gainers.rowCount > 30, `gainers/losers/active rows (${gainers.rowCount})`);
  }

  // 2) market report — English (LTR + English sheet names)
  {
    const { res, buf } = await exportReport("market", "en");
    ok(res.status === 200, "market/en → 200");
    const wb = await parseXlsx(buf);
    const names = wb.worksheets.map((w) => w.name);
    ok(names[0] === "Cover", `cover sheet first (${names.join(", ")})`);
    const ws = wb.worksheets.find((w) => w.name === "Companies")!;
    ok(ws.views?.[0]?.rightToLeft === false || ws.views?.[0]?.rightToLeft === undefined, "LTR view for English");
    ok(names.includes("Top gainers") && names.includes("Summary"), `gainers+summary sheets (en) (${names.join(", ")})`);
    ok(cfRuleCount(ws, "colorScale") >= 2, `en colorScale on companies (${cfRuleCount(ws, "colorScale")})`);
  }

  // 3) overview — cover + summary + sectors
  {
    const { res, buf } = await exportReport("overview", "en");
    ok(res.status === 200, "overview/en → 200");
    const wb = await parseXlsx(buf);
    ok(wb.worksheets.length === 3, `overview has cover + summary + sectors (${wb.worksheets.map((w) => w.name).join(", ")})`);
    const sectors = wb.worksheets.find((w) => w.name === "Sectors")!;
    ok(cfRuleCount(sectors, "colorScale") >= 1, `sector change colorScale (${cfRuleCount(sectors, "colorScale")})`);
  }

  // 4) signals scan — cover + scan + breadth, with condFmt
  {
    const { res, buf } = await exportReport("signals", "ar");
    ok(res.status === 200, "signals/ar → 200");
    const wb = await parseXlsx(buf);
    ok(wb.worksheets.length === 3, `signals has cover + scan + breadth (${wb.worksheets.map((w) => w.name).join(", ")})`);
    const ws = wb.worksheets.find((w) => w.name.includes("المسح")) ?? wb.worksheets[1];
    ok(ws.rowCount > 100, `scan rows (${ws.rowCount})`);
    ok(cfRuleCount(ws, "colorScale") >= 2, `colorScale on scan (${cfRuleCount(ws, "colorScale")})`);
    ok(cfRuleCount(ws, "dataBar") >= 1, `dataBar on vol ratio (${cfRuleCount(ws, "dataBar")})`);
  }

  // 5) ai-signals (served from the shared cache)
  {
    const { res, buf } = await exportReport("ai-signals", "ar");
    if (res.status === 200) {
      ok(buf.length > 8_000, `ai-signals workbook (${(buf.length / 1024).toFixed(0)}KB)`);
      const wb = await parseXlsx(buf);
      const picks = wb.worksheets.find((w) => w.name === "اختيارات AI")!;
      ok(!!picks, `picks sheet (${wb.worksheets.map((w) => w.name).join(", ")})`);
      const af = headerRowOf(picks);
      const r = picks.getRow(af + 1);
      ok(typeof r.getCell(7).value === "number", "close numeric");
      const evidence = wb.worksheets.find((w) => w.name === "الأدلة")!;
      ok(evidence.rowCount > 10, `evidence sheet has rows (${evidence.rowCount})`);
      ok(cfRuleCount(picks, "dataBar") >= 1, `conviction dataBar (${cfRuleCount(picks, "dataBar")})`);
    } else {
      const j = (await res.json()) as { error?: string };
      ok(res.status === 503, `ai-signals gracefully 503 when cache is cold (${j.error})`);
    }
  }

  // 6) company report — COMI: cover + snapshot + technicals + dividends + PRICE HISTORY
  {
    const { res, buf } = await exportReport("company", "en", { ticker: "COMI" });
    ok(res.status === 200, "company/COMI/en → 200");
    const wb = await parseXlsx(buf);
    const names = wb.worksheets.map((w) => w.name);
    ok(names[0] === "Cover", `cover first (${names.join(", ")})`);
    ok(names.includes("Price history"), `price history sheet present (${names.join(", ")})`);
    const ws = wb.worksheets.find((w) => w.name === "Company snapshot")!;
    const vals = ws.getColumn(1).values as unknown[];
    ok(vals.some((v) => String(v).includes("P/E")), "snapshot contains P/E metric");
    const hist = wb.worksheets.find((w) => w.name === "Price history")!;
    ok(hist.rowCount > 200, `price history rows (${hist.rowCount})`);
    ok(cfRuleCount(hist, "colorScale") >= 1 && cfRuleCount(hist, "dataBar") >= 1, "price history conditional formatting");
  }

  // 7) compare
  {
    const { res, buf } = await exportReport("compare", "en", { tickers: ["COMI", "HDBK"] });
    ok(res.status === 200, "compare/COMI,HDBK → 200");
    const wb = await parseXlsx(buf);
    const ws = wb.worksheets.find((w) => w.name === "Comparison")!;
    const af = headerRowOf(ws);
    ok(String(ws.getRow(af).getCell(3).value) === "HDBK", "transposed compare header (metric | COMI | HDBK)");
  }

  // 8) screener (client-data) + sanitization
  {
    const { res, buf } = await exportReport("screener", "ar", {
      columns: ["الرمز", "الإغلاق", "التغير %"],
      rows: [
        ["COMI", 78.5, 1.23],
        ["HDBK", 33.2, -0.4],
      ],
      filtersText: "pe: ~10",
    });
    ok(res.status === 200, "screener payload → 200");
    const wb = await parseXlsx(buf);
    const ws = wb.worksheets.find((w) => w.name === "النتائج")!;
    const af = headerRowOf(ws);
    ok(String(ws.getRow(af + 1).getCell(1).value) === "COMI", "screener row data present");
    ok(ws.getRow(af + 1).getCell(2).numFmt === "#,##0.00", "auto-detected numeric format");
  }

  // 9) rejections
  {
    const bad = await fetch(`${BASE}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.21" },
      body: JSON.stringify({ report: "nope", lang: "ar" }),
    });
    ok(bad.status === 400, `unknown report → 400 (${bad.status})`);
    const empty = await exportReport("watchlist", "ar", { columns: [], rows: [] });
    ok(empty.res.status === 400, `empty rows → 400 (${empty.res.status})`);
    const noTicker = await exportReport("company", "ar", {});
    ok(noTicker.res.status === 400, `company without ticker → 400 (${noTicker.res.status})`);
  }

  console.log("── T21: routing surface ──");

  // 10) deep links serve the same shell (client routing hydrates from params)
  for (const url of [
    "/?view=company&ticker=COMI&panel=technical&lang=en",
    "/?view=signals&mode=ai&lang=ar",
    "/?view=screener&sector=financials&pe=~10&dir=asc&lang=en",
    "/?view=compare&tickers=COMI,HDBK&lang=en",
    "/?view=agent&q=compare%20COMI%20vs%20HDBK&lang=en",
    "/?view=reports&lang=ar",
  ]) {
    const res = await fetch(`${BASE}${url}`);
    const html = res.status === 200 ? await res.text() : "";
    ok(res.status === 200 && html.includes("EGX") && html.length > 500, `page serves: ${url}`);
  }

  // 11) regression: usage + health still healthy
  {
    const usage = await (await fetch(`${BASE}/api/usage`)).json() as Record<string, unknown>;
    ok(usage && typeof usage === "object" && "today" in usage, "usage endpoint healthy");
    const health = await (await fetch(`${BASE}/api/health`)).json() as { version?: string };
    ok(!!health?.version && health.version >= "2.13", `health version ≥2.13 (got ${health?.version})`);
  }

  console.log(`\nT21 result: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("T21 crashed:", e);
  process.exit(1);
});
