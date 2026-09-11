/** Professional XLSX report builder (Task 21-b) — server-side only.
 *
 *  Every export from EGX Desk gets the same "analyst report" treatment:
 *  a branded ink-on-paper header block (brand, title, generated-at, source),
 *  styled header rows (warm ink fill + paper text, frozen, autofiltered),
 *  zebra striping, tabular number formats per column, an honest footer
 *  disclaimer — and right-to-left sheet views for the Arabic UI so the
 *  report reads natively in Excel in either language. */

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
  sheets: SheetSpec[];
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

  // freeze the header row of the FIRST table on the sheet (set by caller via views)
  return { nextRow: r + 1, headerRow, lastRow, colCount };
}

export async function buildReportBuffer(spec: ReportSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "EGX Desk";
  wb.lastModifiedBy = "EGX Desk";
  wb.title = spec.reportTitle;
  wb.description = spec.footerNote.slice(0, 250);

  const now = new Date();
  const stamp = now.toISOString().replace("T", " ").slice(0, 16) + " UTC";

  for (const sheet of spec.sheets) {
    const ws = wb.addWorksheet(sheet.name, {
      views: [{ rightToLeft: spec.lang === "ar", showGridLines: false }],
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

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
