/** T41 audit — XLSX export cell-level validation (exceljs, the lib the app uses). */
import ExcelJS from "exceljs";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const res = await fetch(`${BASE}/api/export`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ report: "market", lang: "ar" }),
});
if (!res.ok) { console.log("export HTTP", res.status); process.exit(1); }
const buf = Buffer.from(await res.arrayBuffer());
fs.writeFileSync("/tmp/t41-export.xlsx", buf);
console.log("export bytes:", buf.length);

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buf);
console.log("sheets:", wb.worksheets.map((w) => `${w.name}(${w.rowCount}r)`).join(", "));

const uni = (await (await fetch(`${BASE}/api/companies`)).json()).rows;
const byTicker = new Map(uni.map((r) => [r.ticker, r]));

let issues = 0;
const bad = (m) => { issues++; console.log("  ✗ " + m); };

// header row of every sheet
for (const ws of wb.worksheets) {
  const header = ws.getRow(1).values;
  console.log(`\n— "${ws.name}" rows=${ws.rowCount}:`, JSON.stringify(header).slice(0, 260));
  if (ws.rowCount < 2) bad(`sheet ${ws.name} has no data rows`);
}

// ── universe sheet deep check: close/changePct vs live ──
function colIndex(header, ...names) {
  for (const n of names) {
    const i = header.findIndex((h) => typeof h === "string" && h.trim() === n);
    if (i >= 0) return i;
  }
  return -1;
}
// find the header row: the row containing "الرمز"/"Ticker"
function findHeaderRow(ws) {
  for (let n = 1; n <= Math.min(12, ws.rowCount); n++) {
    const vals = ws.getRow(n).values;
    if (vals.some((h) => typeof h === "string" && (h.trim() === "الرمز" || h.trim() === "Ticker"))) return n;
  }
  return -1;
}
for (const ws of wb.worksheets) {
  const hN = findHeaderRow(ws);
  if (hN < 0) { console.log(`  "${ws.name}": no table header (chrome sheet)`); continue; }
  const header = ws.getRow(hN).values;
  const tI = colIndex(header, "Ticker", "الرمز", "Symbol");
  const cI = colIndex(header, "Close", "آخر", "الإغلاق", "الإغلاق (جنيه)", "Last");
  const chI = colIndex(header, "Change %", "التغير %", "التغير");
  if (tI < 0 || cI < 0) { console.log(`  "${ws.name}": header found but no ticker/close cols`, JSON.stringify(header).slice(0, 240)); continue; }
  let checked = 0, drift = 0, miss = 0, chChecked = 0, chDrift = 0;
  ws.eachRow((row, n) => {
    if (n <= hN) return;
    const t = String(row.getCell(tI).value ?? "").trim();
    if (!t || !/^[A-Z0-9-]+$/.test(t)) return; // skip summary/footer rows
    const live = byTicker.get(t);
    if (!live) { miss++; if (miss <= 3) bad(`row ${n}: ticker "${t}" not in live universe`); return; }
    const cell = row.getCell(cI);
    let close = typeof cell.value === "object" && cell.value?.result != null ? Number(cell.value.result) : Number(cell.value);
    if (Number.isFinite(close)) {
      checked++;
      if (Math.abs(close - live.close) / Math.max(1e-9, live.close) > 0.02) {
        drift++;
        if (drift <= 3) bad(`${t} close ${close} vs live ${live.close}`);
      }
    }
    if (chI >= 0) {
      const cch = row.getCell(chI);
      const ch = typeof cch.value === "object" && cch.value?.result != null ? Number(cch.value.result) : Number(cch.value);
      if (Number.isFinite(ch)) {
        chChecked++;
        if (Math.abs(ch - live.changePct) > 0.5) { chDrift++; if (chDrift <= 3) bad(`${t} change ${ch} vs live ${live.changePct}`); }
      }
    }
  });
  console.log(`  "${ws.name}": close checked=${checked} drift=${drift} unknown=${miss} | change checked=${chChecked} drift=${chDrift}`);
}

// ── signals/report sheet: R:R band ──
for (const ws of wb.worksheets) {
  const header = ws.getRow(1).values;
  const rrKeys = header.map((h, i) => [h, i]).filter(([h]) => typeof h === "string" && /r:?r/i.test(h));
  if (!rrKeys.length) continue;
  const tI = colIndex(header, "Ticker", "الرمز");
  ws.eachRow((row, n) => {
    if (n === 1) return;
    for (const [h, i] of rrKeys) {
      const rr = Number(row.getCell(i + 1).value);
      if (Number.isFinite(rr) && rr !== 0 && (rr < 1.3 || rr > 1.7)) {
        const t = tI >= 0 ? row.getCell(tI + 1).value : "?";
        bad(`${ws.name} row${n} ${t} R:R ${rr} outside charter band`);
      }
    }
  });
  console.log(`  "${ws.name}": R:R band checked (${rrKeys.map(([h]) => h).join(",")})`);
}

console.log(`\n=== XLSX ISSUES: ${issues} ===`);
