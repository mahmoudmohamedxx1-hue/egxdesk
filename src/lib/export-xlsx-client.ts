"use client";

/** Client helper for XLSX report downloads (Task 21-b): POSTs the report
 *  request to /api/export, receives the styled workbook as a blob and
 *  triggers a browser download. Returns success so callers can toast. */

export async function downloadXlsx(report: string, lang: "ar" | "en", payload?: unknown): Promise<boolean> {
  try {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report, lang, payload }),
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (!blob.size) return false;
    // filename from the server's Content-Disposition (ASCII-safe)
    let name = `EGX-Desk-${report}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    const cd = res.headers.get("content-disposition") ?? "";
    const m = /filename="([^"]+)"/.exec(cd);
    if (m) name = m[1];
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}
