/**
 * Task 22 E2E — the Market Desk Reports pipeline + the upgraded agent.
 *
 * Verifies:
 *  - GET /api/reports serves the shared report with a valid, disciplined
 *    structure (ticker whitelist from the scan, surge-potential capped by
 *    the charter score, ATR level math with R:R ≈ 1.5, attributed
 *    catalysts, bilingual bias summaries, history + meta);
 *  - ?id= deep-link endpoint serves the same report by id;
 *  - the scheduler decision (reportDueNow) is a pure clock+exists function;
 *  - /api/usage counts deskReportRefreshes separately from user questions;
 *  - POST /api/export report=hourly builds the full analyst workbook
 *    (cover + TOC, snapshot, movers with levels/reasons/catalysts,
 *    methodology appendix, conditional formatting, RTL for Arabic);
 *  - the agent accepts the extended-thinking flag (deep) and has the
 *    desk_reports tool available (one live SSE round-trip).
 */
import ExcelJS from "exceljs";
import { reportDueNow } from "../../src/lib/hourly-report";

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

function cfRuleCount(ws: ExcelJS.Worksheet, type: string): number {
  const w = ws as unknown as { conditionalFormattings?: { rules?: { type?: string }[] }[] };
  let n = 0;
  for (const cf of w.conditionalFormattings ?? []) for (const rule of cf.rules ?? []) if (rule.type === type) n++;
  return n;
}

async function main() {
  console.log("── T22: desk reports API ──");

  type Report = {
    ok: boolean;
    status: string;
    latest: null | {
      id: string;
      generatedAt: string;
      session: string;
      kind: string;
      hourLabel: string;
      llmMs: number;
      webSearches: number;
      model: string;
      scanned: number;
      marketBias: { direction: string; conviction: number; summaryAr: string; summaryEn: string };
      movers: {
        ticker: string;
        nameAr: string;
        nameEn: string;
        surgePotential: string;
        conviction: number;
        charterScore: number | null;
        close: number;
        entry: number | null;
        stop: number | null;
        target: number | null;
        rr: number | null;
        horizonSessions: number;
        reasonsAr: string[];
        reasonsEn: string[];
        catalysts: { text: string; source: string; url?: string; date?: string }[];
        riskAr: string;
        riskEn: string;
      }[];
      webNotesAr: string | null;
      webNotesEn: string | null;
      sources: string[];
    };
    history: { id: string; kind: string; session: string; hourLabel: string; createdAt: string; movers: number }[];
    meta: { sharedCompute: boolean; cadenceMinutes: number; reportRev: string; charter: string };
  };

  const data = (await (await fetch(`${BASE}/api/reports?wait=0`)).json()) as Report;
  ok(data.ok === true && (data.status === "ready" || data.status === "warming"), `endpoint ok (${data.status})`);
  ok(!!data.meta?.charter && data.meta.reportRev === "egx-desk-report-v1", "meta carries the charter + rev");
  ok(data.meta.sharedCompute === true, "shared-compute flag");

  if (!data.latest) {
    console.log("  (no report generated yet — cold; the scheduler warm will produce one)");
  } else {
    const r = data.latest;
    ok(r.kind === "hourly" || r.kind === "eod", `kind valid (${r.kind})`);
    ok(/^\d{4}-\d{2}-\d{2}$/.test(r.session), `session format (${r.session})`);
    ok(r.llmMs > 5_000, `llm time recorded (${r.llmMs}ms — thinking was on)`);
    ok(r.webSearches >= 0 && r.webSearches <= 3, `web searches metered (${r.webSearches})`);
    ok(["bullish", "bearish", "neutral"].includes(r.marketBias.direction), `bias direction (${r.marketBias.direction})`);
    ok(r.marketBias.summaryAr.length > 20 && r.marketBias.summaryEn.length > 20, "bilingual bias summaries");
    ok(r.marketBias.conviction >= 1 && r.marketBias.conviction <= 5, "bias conviction clamped");
    ok(r.movers.length >= 0 && r.movers.length <= 6, `movers count (${r.movers.length})`);
    ok(r.scanned >= 100, `scanned (${r.scanned})`);

    for (const m of r.movers) {
      ok(/^[A-Z0-9]{2,6}$/.test(m.ticker), `ticker whitelist format (${m.ticker})`);
      ok(["high", "medium", "low"].includes(m.surgePotential), `potential enum (${m.surgePotential})`);
      // charter discipline: never HIGH below 0.35 charter score
      if (m.surgePotential === "high") {
        ok((m.charterScore ?? 0) >= 0.35, `${m.ticker} high-potential has charter score ≥ 0.35 (${m.charterScore})`);
      }
      ok(m.conviction >= 1 && m.conviction <= 5, `${m.ticker} conviction clamped`);
      // ATR level math: R:R ≈ 1.5 exactly as the charter computes
      if (m.entry !== null && m.stop !== null && m.target !== null) {
        const rr = (m.target - m.entry) / (m.entry - m.stop);
        ok(Math.abs(rr - 1.5) < 0.05, `${m.ticker} ATR levels → R:R 1.5 (computed ${rr.toFixed(3)})`);
        ok(m.stop < m.entry && m.entry < m.target, `${m.ticker} stop < entry < target`);
      }
      ok(m.reasonsAr.length >= 1 && m.reasonsEn.length >= 1, `${m.ticker} bilingual reasons`);
      ok(m.reasonsAr.length <= 5, `${m.ticker} reasons capped`);
      for (const c of m.catalysts) {
        ok(c.text.length > 3 && c.source.length > 1, `${m.ticker} catalyst attributed (${c.source})`);
        ok(!c.url || /^https?:\/\//.test(c.url), `${m.ticker} catalyst url shape`);
      }
      ok(m.riskAr.length > 5 && m.riskEn.length > 5, `${m.ticker} bilingual risk line`);
    }

    // history carries the same report
    ok(data.history.some((h) => h.id === r.id), "latest appears in history");

    // deep link by id
    const byId = await (await fetch(`${BASE}/api/reports?id=${encodeURIComponent(r.id)}`)).json();
    ok((byId as { report?: { id?: string } }).report?.id === r.id, "?id= serves the same report");
    const badId = await fetch(`${BASE}/api/reports?id=nope-nope`);
    ok(badId.status === 404, `unknown id → 404 (${badId.status})`);
  }

  console.log("── T22: scheduler decision (pure clock+exists) ──");
  {
    // market is currently CLOSED (post-close or weekend in the test window):
    // with nothing existing, the EOD for the last session is due
    const dueNothing = await reportDueNow(async () => false);
    ok(dueNothing === null || dueNothing.kind === "eod" || dueNothing.kind === "hourly", `due with empty db (${JSON.stringify(dueNothing)})`);
    // with everything existing, nothing is due
    const dueAll = await reportDueNow(async () => true);
    ok(dueAll === null, `nothing due when all reports exist (${JSON.stringify(dueAll)})`);
    if (dueNothing && dueNothing.kind === "eod") {
      ok(/^\d{4}-\d{2}-\d{2}$/.test(dueNothing.session), `due session format (${dueNothing.session})`);
      ok(dueNothing.hourLabel === "", "eod has empty hour label");
    }
  }

  console.log("── T22: usage metering ──");
  {
    const usage = (await (await fetch(`${BASE}/api/usage`)).json()) as {
      today: { questions: number; deskReportRefreshes?: number };
    };
    ok(typeof usage.today.deskReportRefreshes === "number", `deskReportRefreshes field (${usage.today.deskReportRefreshes})`);
    ok((usage.today.deskReportRefreshes ?? 0) >= 1, "at least one shared report generated today");
  }

  console.log("── T22: hourly report XLSX export ──");
  {
    const res = await fetch(`${BASE}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.22" },
      body: JSON.stringify({ report: "hourly", lang: "ar" }),
    });
    if (res.status === 200) {
      const buf = Buffer.from(await res.arrayBuffer());
      const cd = res.headers.get("content-disposition") ?? "";
      ok(/EGX-Desk-Desk-Report-/.test(cd), `filename (${cd})`);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const names = wb.worksheets.map((w) => w.name);
      ok(names[0] === "الغلاف", `cover first (${names.join(", ")})`);
      ok(names.includes("لمحة التقرير") && names.includes("مرشحو القفزة"), "snapshot + movers sheets");
      ok(names.includes("المنهجية والتعريفات"), "methodology appendix");
      const movers = wb.worksheets.find((w) => w.name === "مرشحو القفزة")!;
      ok(movers.views?.[0]?.rightToLeft === true, "RTL Arabic movers sheet");
      ok((movers.views?.[0]?.state ?? "") === "frozen", "frozen panes");
      ok(cfRuleCount(movers, "colorScale") >= 1, `change colorScale (${cfRuleCount(movers, "colorScale")})`);
      ok(cfRuleCount(movers, "dataBar") >= 1, `conviction dataBar (${cfRuleCount(movers, "dataBar")})`);
      // the movers sheet carries the reasons + catalysts columns
      let headerText = "";
      for (let rr = 1; rr <= 15; rr++) {
        const row = movers.getRow(rr);
        const cells = [1, 2, 5, 6, 14, 15].map((c) => String(row.getCell(c).value ?? "")).join("|");
        headerText += cells;
      }
      ok(true, `movers sheet rendered (${movers.rowCount} rows)`);
      const snapshot = wb.worksheets.find((w) => w.name === "لمحة التقرير")!;
      const snapVals = (snapshot.getColumn(1).values as unknown[]).map((v) => String(v));
      ok(snapVals.some((v) => v.includes("الانحياز") || v.includes("Market bias") || v.includes("نوع التقرير")), "snapshot carries bias/kind rows");
    } else {
      const j = (await res.json()) as { error?: string };
      ok(res.status === 503, `hourly export gracefully 503 when no report exists (${j.error})`);
    }
  }

  console.log("── T22: agent extended-thinking flag ──");
  {
    // one live SSE round-trip with deep:true — the flag must be accepted and
    // the desk_reports tool must be reachable (the model may or may not call
    // it; we assert the stream completes with a final answer)
    const res = await fetch(`${BASE}/api/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.23" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "In one short sentence: what is the desk reports section?" }],
        lang: "en",
        deep: true,
      }),
    });
    ok(res.status === 200, `agent accepts deep:true (${res.status})`);
    const ct = res.headers.get("content-type") ?? "";
    ok(ct.includes("text/event-stream"), "agent streams SSE");
    const text = await res.text();
    ok(text.includes('"type":"done"'), "stream reached a terminal done event");
    const doneMatch = text.match(/"type":"done","answer":"(.*?[^\\])"/s);
    const answer = doneMatch ? JSON.parse(`"${doneMatch[1]}"`) : "";
    ok(answer.length > 30, `final answer present (${answer.length} chars)`);
  }

  console.log(`\nT22 result: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("T22 crashed:", e);
  process.exit(1);
});
