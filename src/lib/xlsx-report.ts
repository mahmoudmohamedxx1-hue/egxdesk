/** Professional XLSX report builder (Task 21-b, upgraded in Task 22-c).
 *
 *  Every export from EGX Desk gets the full "analyst desk" treatment:
 *  - an optional branded COVER sheet (title page + table of contents),
 *  - a branded ink-on-paper header block (brand, title, generated-at, source)
 *    on every data sheet,
 *  - styled header rows (warm ink fill + paper text, frozen, autofiltered),
 *  - zebra striping, tabular number formats per column,
 *  - CONDITIONAL FORMATTING: red→neutral→green color scales on change-%
 *    columns and data bars on volume/value columns,
 *  - an optional METHODOLOGY & DEFINITIONS appendix sheet,
 *  - print setup (landscape, fit-to-width, repeating header rows) so the
 *    workbook prints like a report, not like a spreadsheet dump,
 *  - an honest footer disclaimer — and right-to-left sheet views for the
 *    Arabic UI so the report reads natively in Excel in either language. */

import ExcelJS from "exceljs";

// ── brand palette (matches the app's warm paper & ink editorial theme) ──
const INK = "FF332D26"; // deep warm ink — header fills, titles
const INK_SOFT = "FF4A4239"; // secondary ink
const PAPER = "FFFBF8F1"; // paper white — header row text
const ZEBRA = "FFF5F1E8"; // warm zebra stripe
const ZEBRA_2 = "FFEFEBE0"; // slightly deeper stripe
const MUTED = "FF8A8177"; // muted labels
const ACCENT = "FF1E8A5C"; // the app's up-green — thin brand rules
const BORDER = "FFDDD8CD"; // hairline borders
// conditional-formatting stops (soft market red → paper → market green)
const CF_DOWN = "FFD96459";
const CF_MID = "FFEFEBE0";
const CF_UP = "FF2E9E6B";
const CF_BAR = "FF1E8A5C"; // data bars

export type ColFmt = "text" | "num" | "int" | "pct" | "ratio" | "score";

const NUM_FMT: Record<ColFmt, string | null> = {
  text: null,
  num: "#,##0.00",
  int: "#,##0",
  pct: '0.00"%"',
  ratio: '0.00"×"',
  score: "0.00",
};

export type ColSpec = {
  header: string;
  width?: number;
  fmt?: ColFmt;
  /** custom Excel numFmt (overrides fmt) */
  numFmt?: string;
  /** conditional formatting applied over this column's data range */
  condFmt?: "changeScale" | "dataBar";
};

export type TableSpec = {
  title: string;
  note?: string;
  columns: ColSpec[];
  rows: (string | number | null)[][];
  /** add an Excel autofilter to this table's header row (main data tables) */
  autoFilter?: boolean;
};

export type SheetSpec = {
  name: string;
  tables: TableSpec[];
};

export type ReportSpec = {
  lang: "ar" | "en";
  reportTitle: string;
  subtitle?: string;
  meta: [string, string][];
  /** branded cover sheet (title page + table of contents) — recommended */
  cover?: { toc: { sheet: string; title: string }[] };
  sheets: SheetSpec[];
  /** methodology & definitions appendix sheet (topic → explanation rows) */
  methodology?: { title: string; rows: [string, string][] };
  footerNote: string;
};

const thin = { style: "thin" as const, color: { argb: BORDER } };

/** Auto width from content (header + sampled values), clamped. */
function autoWidth(col: ColSpec, values: (string | number | null)[]): number {
  if (col.width) return col.width;
  const sample = [col.header, ...values.slice(0, 400)];
  let max = 0;
  for (const v of sample) {
    const s = v === null || v === undefined ? "" : typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(v);
    // Arabic glyphs are a touch wider per char in Calibri
    const arabic = /[\u0600-\u06FF]/.test(s);
    max = Math.max(max, Math.min(s.length + (arabic ? 1.5 : 1), 60));
  }
  return Math.max(9, Math.min(max + 3, 55));
}

/** Render ONE table into a worksheet starting at the given row; returns the next free row. */
function renderTable(
  ws: ExcelJS.Worksheet,
  t: TableSpec,
  startRow: number,
  lang: "ar" | "en"
): { nextRow: number; headerRow: number; lastRow: number; colCount: number } {
  let r = startRow;

  // table title — bold ink with a green accent underline
  const titleCell = ws.getCell(r, 1);
  titleCell.value = t.title;
  titleCell.font = { bold: true, size: 12, color: { argb: INK } };
  titleCell.border = { bottom: { style: "thin", color: { argb: ACCENT } } };
  ws.getRow(r).outlineLevel = 0;
  r += 1;

  if (t.note) {
    const noteCell = ws.getCell(r, 1);
    noteCell.value = t.note;
    noteCell.font = { italic: true, size: 9, color: { argb: MUTED } };
    r += 1;
  }

  const colCount = t.columns.length;

  // header row — ink fill, paper text
  const headerRow = r;
  const hr = ws.getRow(headerRow);
  t.columns.forEach((col, i) => {
    const c = hr.getCell(i + 1);
    c.value = col.header;
    c.font = { bold: true, size: 10.5, color: { argb: PAPER } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    c.border = { bottom: thin, top: thin, left: thin, right: thin };
    c.alignment = { horizontal: lang === "ar" ? "right" : "left", vertical: "middle", wrapText: true };
  });
  hr.height = 22;
  r += 1;

  // data rows — zebra + formats
  const firstDataRow = r;
  t.rows.forEach((row, ri) => {
    const xr = ws.getRow(r);
    const stripe = ri % 2 === 1 ? ZEBRA : ZEBRA_2;
    t.columns.forEach((col, ci) => {
      const cell = xr.getCell(ci + 1);
      const v = row[ci] ?? null;
      cell.value = v === "" || v === undefined ? null : v;
      const fmt = col.numFmt ?? NUM_FMT[col.fmt ?? "text"];
      if (fmt && typeof v === "number") cell.numFmt = fmt;
      cell.font = { size: 10, color: { argb: INK_SOFT } };
      if (ri % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: stripe } };
      cell.border = { bottom: { style: "hair", color: { argb: BORDER } }, left: thin, right: thin };
      cell.alignment = {
        horizontal: typeof v === "number" ? "right" : lang === "ar" ? "right" : "left",
        vertical: "middle",
      };
    });
    r += 1;
  });
  const lastRow = r - 1;

  // column widths (auto from rendered content)
  t.columns.forEach((col, ci) => {
    const values = t.rows.map((row) => row[ci] ?? null);
    ws.getColumn(ci + 1).width = autoWidth(col, values);
  });

  // autofilter on the main table
  if (t.autoFilter && t.rows.length > 0) {
    ws.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: headerRow, column: colCount },
    };
  }

  // conditional formatting over the data range (Task 22-c)
  if (t.rows.length > 0) {
    t.columns.forEach((col, ci) => {
      if (!col.condFmt) return;
      const letter = ws.getColumn(ci + 1).letter;
      const ref = `${letter}${firstDataRow}:${letter}${lastRow}`;
      if (col.condFmt === "changeScale") {
        ws.addConditionalFormatting({
          ref,
          rules: [
            {
              priority: 1,
              type: "colorScale" as const,
              cfvo: [{ type: "min" as const }, { type: "num" as const, value: 0 }, { type: "max" as const }],
              color: [{ argb: CF_DOWN }, { argb: CF_MID }, { argb: CF_UP }],
            },
          ],
        });
      } else if (col.condFmt === "dataBar") {
        ws.addConditionalFormatting({
          ref,
          rules: [
            {
              priority: 1,
              type: "dataBar" as const,
              cfvo: [{ type: "min" as const }, { type: "max" as const }],
              // `color` is supported at runtime but missing from the DataBar
              // typing in exceljs 4.x — cast through the rule type
              color: { argb: CF_BAR },
              gradient: false,
              showValue: true,
            } as unknown as ExcelJS.DataBarRuleType,
          ],
        });
      }
    });
  }

  // freeze the header row of the FIRST table on the sheet (set by caller via views)
  return { nextRow: r + 1, headerRow, lastRow, colCount };
}

/** The branded cover sheet — a real title page: brand block, report title,
 *  meta lines, a table of contents of the sheets that follow, disclaimer. */
function addCoverSheet(wb: ExcelJS.Workbook, spec: ReportSpec, stamp: string): ExcelJS.Worksheet {
  const ar = spec.lang === "ar";
  const ws = wb.addWorksheet(ar ? "الغلاف" : "Cover", {
    views: [{ rightToLeft: ar, showGridLines: false }],
    properties: { tabColor: { argb: ACCENT } },
  });
  ws.getColumn(1).width = 30;
  ws.getColumn(2).width = 72;

  let r = 2;
  const brand = ws.getCell(r, 1);
  brand.value = "EGX DESK";
  brand.font = { bold: true, size: 26, color: { argb: INK } };
  const brandSub = ws.getCell(r, 2);
  brandSub.value = ar ? "تقارير مكتب البورصة المصرية" : "Egyptian Exchange desk reports";
  brandSub.font = { italic: true, size: 11, color: { argb: MUTED } };
  ws.getRow(r).height = 34;
  r += 2;

  const title = ws.getCell(r, 1);
  title.value = spec.reportTitle;
  title.font = { bold: true, size: 17, color: { argb: INK } };
  if (spec.subtitle) {
    const sub = ws.getCell(r, 2);
    sub.value = spec.subtitle;
    sub.font = { size: 11, color: { argb: INK_SOFT } };
  }
  ws.getRow(r).height = 24;
  r += 1;
  ws.getCell(r, 1).border = { bottom: { style: "thin", color: { argb: ACCENT } } };
  r += 2;

  for (const [k, v] of spec.meta) {
    const kc = ws.getCell(r, 1);
    kc.value = k;
    kc.font = { bold: true, size: 10, color: { argb: MUTED } };
    const vc = ws.getCell(r, 2);
    vc.value = v;
    vc.font = { size: 10, color: { argb: INK_SOFT } };
    r += 1;
  }
  r += 1;

  if (spec.cover?.toc.length) {
    const tocTitle = ws.getCell(r, 1);
    tocTitle.value = ar ? "المحتويات" : "Contents";
    tocTitle.font = { bold: true, size: 12, color: { argb: INK } };
    tocTitle.border = { bottom: { style: "thin", color: { argb: ACCENT } } };
    r += 1;
    for (const item of spec.cover.toc) {
      const sc = ws.getCell(r, 1);
      sc.value = item.sheet;
      sc.font = { bold: true, size: 10, color: { argb: INK_SOFT } };
      const tc = ws.getCell(r, 2);
      tc.value = item.title;
      tc.font = { size: 10, color: { argb: INK_SOFT } };
      r += 1;
    }
    r += 1;
  }

  const footerRow = r + 1;
  ws.mergeCells(footerRow, 1, footerRow, 2);
  const fc = ws.getCell(footerRow, 1);
  fc.value = `${spec.footerNote}\n${ar ? "أُنشئ بواسطة EGX ديسك في" : "Generated by EGX Desk at"} ${stamp}`;
  fc.font = { italic: true, size: 9, color: { argb: MUTED } };
  fc.alignment = { horizontal: ar ? "right" : "left", vertical: "top", wrapText: true };
  ws.getRow(footerRow).height = 58;
  return ws;
}

/** The methodology & definitions appendix — what every column means, where
 *  the data comes from, how levels are computed. What makes an export a
 *  report a professional can hand to someone else. */
function addMethodologySheet(wb: ExcelJS.Workbook, spec: ReportSpec, stamp: string): ExcelJS.Worksheet {
  const ar = spec.lang === "ar";
  const m = spec.methodology!;
  const ws = wb.addWorksheet(m.title.slice(0, 28) || (ar ? "المنهجية" : "Methodology"), {
    views: [{ rightToLeft: ar, showGridLines: false }],
    properties: { tabColor: { argb: MUTED } },
  });
  ws.getColumn(1).width = 30;
  ws.getColumn(2).width = 84;

  let r = 2;
  const title = ws.getCell(r, 1);
  title.value = m.title;
  title.font = { bold: true, size: 14, color: { argb: INK } };
  const sub = ws.getCell(r, 2);
  sub.value = ar ? "تعريفات الأعمدة ومصادر البيانات وطريقة الحساب" : "Column definitions, data sources and computation method";
  sub.font = { italic: true, size: 10, color: { argb: MUTED } };
  ws.getRow(r).height = 22;
  r += 1;
  ws.getCell(r, 1).border = { bottom: { style: "thin", color: { argb: ACCENT } } };
  r += 2;

  for (const [topic, text] of m.rows) {
    const tc = ws.getCell(r, 1);
    tc.value = topic;
    tc.font = { bold: true, size: 10, color: { argb: INK_SOFT } };
    tc.alignment = { horizontal: ar ? "right" : "left", vertical: "top", wrapText: true };
    const vc = ws.getCell(r, 2);
    vc.value = text;
    vc.font = { size: 10, color: { argb: INK_SOFT } };
    vc.alignment = { horizontal: ar ? "right" : "left", vertical: "top", wrapText: true };
    ws.getRow(r).height = Math.max(16, Math.min(64, Math.ceil(text.length / 78) * 14 + 4));
    r += 1;
  }

  const footerRow = r + 1;
  ws.mergeCells(footerRow, 1, footerRow, 2);
  const fc = ws.getCell(footerRow, 1);
  fc.value = `${spec.footerNote}\n${stamp}`;
  fc.font = { italic: true, size: 8.5, color: { argb: MUTED } };
  fc.alignment = { horizontal: ar ? "right" : "left", vertical: "top", wrapText: true };
  ws.getRow(footerRow).height = 44;
  return ws;
}

/** Print setup so the workbook prints like a report (landscape, fit to
 *  width, brand + header rows repeated on every printed page). */
function applyPrintSetup(ws: ExcelJS.Worksheet, headerRow: number): void {
  ws.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9, // A4
    horizontalCentered: true,
    margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
  };
  try {
    if (headerRow > 1) ws.pageSetup.printTitlesRow = `1:${headerRow}`;
  } catch {
    /* older ExcelJS types — printing still works without repeated titles */
  }
}

export async function buildReportBuffer(spec: ReportSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "EGX Desk";
  wb.lastModifiedBy = "EGX Desk";
  wb.title = spec.reportTitle;
  wb.description = spec.footerNote.slice(0, 250);

  const now = new Date();
  const stamp = now.toISOString().replace("T", " ").slice(0, 16) + " UTC";

  // cover first (a real title page + table of contents)
  if (spec.cover) addCoverSheet(wb, spec, stamp);

  for (const sheet of spec.sheets) {
    const ws = wb.addWorksheet(sheet.name, {
      views: [{ rightToLeft: spec.lang === "ar", showGridLines: false }],
      properties: { tabColor: { argb: INK } },
    });

    let r = 1;
    // ── brand block ──
    const brand = ws.getCell(r, 1);
    brand.value = "EGX DESK";
    brand.font = { bold: true, size: 16, color: { argb: INK } };
    const brandSub = ws.getCell(r, 2);
    brandSub.value = spec.lang === "ar" ? "تقارير بورصة مصر" : "Egyptian Exchange reports";
    brandSub.font = { italic: true, size: 9, color: { argb: MUTED } };
    ws.getRow(r).height = 24;
    r += 1;

    const title = ws.getCell(r, 1);
    title.value = spec.reportTitle;
    title.font = { bold: true, size: 13, color: { argb: INK } };
    if (spec.subtitle) {
      const sub = ws.getCell(r, 2);
      sub.value = spec.subtitle;
      sub.font = { size: 10, color: { argb: INK_SOFT } };
    }
    r += 1;

    // meta lines
    for (const [k, v] of spec.meta) {
      const kc = ws.getCell(r, 1);
      kc.value = k;
      kc.font = { bold: true, size: 9, color: { argb: MUTED } };
      const vc = ws.getCell(r, 2);
      vc.value = v;
      vc.font = { size: 9, color: { argb: INK_SOFT } };
      r += 1;
    }
    r += 1; // breathing room

    // tables
    let firstHeaderRow = 0;
    for (const t of sheet.tables) {
      const out = renderTable(ws, t, r, spec.lang);
      if (!firstHeaderRow) firstHeaderRow = out.headerRow;
      r = out.nextRow;
    }

    // freeze panes under the first table's header (brand block stays visible too)
    if (firstHeaderRow) {
      ws.views = [
        { rightToLeft: spec.lang === "ar", showGridLines: false, state: "frozen", ySplit: firstHeaderRow },
      ];
      applyPrintSetup(ws, firstHeaderRow);
    }

    // footer disclaimer — merged across the table width, wrapped
    const colCount = Math.max(...sheet.tables.map((t) => t.columns.length), 4);
    const footerRow = r + 1;
    ws.mergeCells(footerRow, 1, footerRow, colCount);
    const fc = ws.getCell(footerRow, 1);
    fc.value = `${spec.footerNote}\n${spec.lang === "ar" ? "أُنشئ بواسطة EGX ديسك في" : "Generated by EGX Desk at"} ${stamp}`;
    fc.font = { italic: true, size: 8.5, color: { argb: MUTED } };
    fc.alignment = { horizontal: spec.lang === "ar" ? "right" : "left", vertical: "top", wrapText: true };
    ws.getRow(footerRow).height = 44;
  }

  // methodology appendix last
  if (spec.methodology) addMethodologySheet(wb, spec, stamp);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
