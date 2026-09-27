#!/usr/bin/env node
/* New-endpoint test round (Task 14) — verifies the four data layers added by
 * the gap-closure build: dividends, calendar, rates, English news — plus the
 * quarterly statements extension. Run against dev (:3000) or production
 * (BASE_URL=http://localhost:3102). */

const BASE = process.env.BASE_URL || "http://localhost:3000";
let pass = 0, fail = 0;

function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
}

async function j(path) {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

(async () => {
  console.log(`new-endpoint tests → ${BASE}\n`);

  // 1) dividends per company
  console.log("GET /api/dividends/COMI");
  {
    const { status, body } = await j("/api/dividends/COMI");
    ok("status 200", status === 200);
    ok("ticker COMI", body?.ticker === "COMI");
    ok("rows array", Array.isArray(body?.rows));
    ok("has payments (COMI is a payer)", (body?.rows?.length ?? 0) >= 4, `got ${body?.rows?.length}`);
    const r = body?.rows?.[0];
    ok("row shape (exDate ISO, amount > 0)",
      !!r && /^\d{4}-\d{2}-\d{2}$/.test(r.exDate) && Number.isFinite(r.amount) && r.amount > 0,
      JSON.stringify(r));
    ok("dates sorted newest-first",
      (body?.rows ?? []).every((x, i, a) => i === 0 || a[i - 1].exDate >= x.exDate));
    ok("source attributed", typeof body?.source === "string" && body.source.length > 0);
  }

  {
    const { status, body } = await j("/api/dividends/ZZZZ");
    ok("unknown ticker → 200 + empty rows (no dividends on record)", status === 200 && (body?.rows?.length ?? -1) === 0);
  }

  // 2) calendar
  console.log("GET /api/calendar");
  {
    const { status, body } = await j("/api/calendar");
    ok("status 200", status === 200);
    ok("asOf is today-ish (ISO)", /^\d{4}-\d{2}-\d{2}$/.test(body?.asOf ?? ""));
    ok("counts object", body?.counts && typeof body.counts.earnings === "number");
    ok("earnings events >= 300 (seeded expected results)", (body?.counts?.earnings ?? 0) >= 300, `got ${body?.counts?.earnings}`);
    ok("events sorted by date", (body?.events ?? []).every((e, i, a) => i === 0 || a[i - 1].date <= e.date));
    const est = (body?.events ?? []).filter((e) => e.estimated);
    ok("estimated events carry the flag", est.length > 0);
    const types = new Set((body?.events ?? []).map((e) => e.type));
    ok("all types valid", [...types].every((t) => ["earnings", "dividend", "assembly", "rights"].includes(t)));
    const future = (body?.events ?? []).filter((e) => e.date >= body.asOf);
    ok("has future events", future.length > 0, `got ${future.length}`);
    const withUrl = (body?.events ?? []).filter((e) => e.url);
    ok("some events link their source", withUrl.length > 0);
  }

  // 3) rates
  console.log("GET /api/rates");
  {
    const { status, body } = await j("/api/rates");
    ok("status 200", status === 200);
    const keys = (body?.rows ?? []).map((r) => r.key);
    ok("policy rate present", keys.includes("policy"), JSON.stringify(keys));
    ok("interbank rate present", keys.includes("interbank"));
    const policy = body?.rows?.find((r) => r.key === "policy");
    ok("policy value sane (0-50%)", policy && policy.value > 0 && policy.value < 50, JSON.stringify(policy));
    ok("each rate has bilingual meaning", (body?.rows ?? []).every((r) => r.meaningAr && r.meaningEn));
    ok("next decision date or null", body?.nextDecision === null || /^\d{4}-\d{2}-\d{2}$/.test(body.nextDecision));
  }

  // 4) English news
  console.log("GET /api/news-en");
  {
    const { status, body } = await j("/api/news-en");
    ok("status 200", status === 200);
    ok("items present", (body?.items?.length ?? 0) >= 20, `got ${body?.items?.length}`);
    const it = body?.items?.[0];
    ok("item shape (title/link/ISO/source)",
      !!it && it.title && /^https?:/.test(it.link) && !Number.isNaN(Date.parse(it.publishedAt)) && it.source);
    ok("newest first", (body?.items ?? []).every((x, i, a) => i === 0 || a[i - 1].publishedAt >= x.publishedAt));
  }

  // 5) statements — quarterly BS/CF extension
  console.log("GET /api/statements/COMI");
  {
    const { status, body } = await j("/api/statements/COMI");
    ok("status 200", status === 200);
    ok("quarterly balance sheet present", !!body?.quarterly?.balance, JSON.stringify(Object.keys(body?.quarterly ?? {})));
    ok("quarterly cash flow present", !!body?.quarterly?.cashflow);
    const qbs = body?.quarterly?.balance;
    ok("quarterly BS periods look like Q labels", !qbs || qbs.periods.every((p) => /^Q[1-4] \d{4}/.test(p)), JSON.stringify(qbs?.periods?.slice(0, 3)));
    ok("quarterly BS has lines", !qbs || qbs.lines.length >= 5, `got ${qbs?.lines?.length}`);
  }

  // 6) PWA assets
  {
    const m = await fetch(`${BASE}/manifest.webmanifest`);
    ok("manifest served", m.status === 200);
    const sw = await fetch(`${BASE}/sw.js`);
    ok("service worker served", sw.status === 200);
    const ic = await fetch(`${BASE}/icon-192.png`);
    ok("icon served", ic.status === 200);
    const html = await (await fetch(`${BASE}/`)).text();
    ok("manifest linked in HTML", html.includes("manifest"));
  }

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("suite crashed:", e);
  process.exit(1);
});
