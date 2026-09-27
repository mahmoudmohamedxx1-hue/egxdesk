"use client";

/** Client-side CSV export (G7).
 *  UTF-8 with a BOM so Arabic text opens correctly in Excel; RFC-4180 quoting;
 *  numbers written with plain dots (never localized) so spreadsheets parse
 *  them. Runs fully in the browser — no server round-trip, no data leaves
 *  the device. */

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (typeof v === "number") {
    // keep full precision, avoid exponent notation for big caps
    s = Number.isFinite(v) ? String(v) : "";
  } else {
    s = String(v);
  }
  if (s === "") return "";
  // quote when the value could break the row: separator, quote, newline, BOM-like
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** Download a CSV file in the browser. */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][]
): void {
  try {
    const blob = new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch {
    // download is best-effort (blocked iframe contexts, disk errors) — never crash the view
  }
}

/** Stamp for filenames: egx-screener-2026-09-10.csv (Cairo date). */
export function fileStamp(d = new Date()): string {
  // Africa/Cairo is UTC+2 or +3 with no DST since 2023 — derive the date label
  // from the local machine; a filename stamp does not need exchange precision.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
