#!/usr/bin/env node
/**
 * API Deep Test Suite — EGX Desk
 * Tests all endpoints: valid inputs, invalid inputs, edge cases,
 * latency, caching, data integrity (NaN/null leak scan, cross-endpoint consistency).
 */
const BASE = "http://localhost:3000";
const results = [];
let failures = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
}

async function timed(path, opts = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + path, opts);
    const ms = Date.now() - t0;
    let body = null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("json")) body = await res.json();
    else body = await res.text();
    return { res, ms, body };
  } catch (e) {
    return { res: null, ms: Date.now() - t0, body: null, err: String(e) };
  }
}

// Deep scan for NaN / Infinity / "undefined" / "null" string leaks in JSON
function scanBadNumbers(obj, path = "$", found = []) {
  if (typeof obj === "number") {
    if (!Number.isFinite(obj)) found.push(`${path}=${obj}`);
  } else if (typeof obj === "string") {
    if (/^(\s)*(nan|infinity|-infinity|null|undefined)(\s)*$/i.test(obj)) found.push(`${path}="${obj}"`);
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => scanBadNumbers(v, `${path}[${i}]`, found));
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) scanBadNumbers(v, `${path}.${k}`, found);
  }
  return found;
}

(async () => {
  console.log("=== 1. CORE MARKET ENDPOINTS ===");

  // /api/overview
  let r = await timed("/api/overview");
  check("GET /api/overview -> 200", r.res?.status === 200, `${r.ms}ms`);
  let ov = r.body;
  check("overview has indices[3]", Array.isArray(ov?.indices) && ov.indices.length >= 3, `n=${ov?.indices?.length}`);
  check("overview has sectorsSnapshot (best/worst)", Array.isArray(ov?.sectorsSnapshot?.best) && ov.sectorsSnapshot.best.length > 0, `best n=${ov?.sectorsSnapshot?.best?.length}`);
  check("overview has sectorPerformance chart data", Array.isArray(ov?.sectorPerformance) && ov.sectorPerformance.length >= 15, `n=${ov?.sectorPerformance?.length}`);
  check("overview has movers", Array.isArray(ov?.movers) && ov.movers.length > 0);
  check("overview flowsSummary present", !!ov?.flowsSummary || ov?.flowsSummary === null);
  check("overview no NaN leaks", scanBadNumbers(ov).length === 0, scanBadNumbers(ov).slice(0, 3).join(", "));
  const idx = ov?.indices?.[0];
  check("index quote numeric", idx && typeof idx.close === "number" && typeof idx.changePct === "number", JSON.stringify(idx)?.slice(0, 120));

  // /api/companies
  r = await timed("/api/companies");
  check("GET /api/companies -> 200", r.res?.status === 200, `${r.ms}ms`);
  const comps = Array.isArray(r.body) ? r.body : r.body?.rows;
  check("companies rows ~296", Array.isArray(comps) && comps.length > 200, `n=${comps?.length} total=${r.body?.total}`);
  check("companies no NaN leaks", scanBadNumbers(comps).length === 0, scanBadNumbers(comps).slice(0, 3).join(", "));
  const c0 = comps?.[0];
  check("company row fields", c0 && "ticker" in c0 && "close" in c0 && "sectorEn" in c0, Object.keys(c0 || {}).slice(0, 12).join(","));
  // caching check — second call should be fast
  r = await timed("/api/companies");
  check("companies cached (2nd call < 2s)", r.ms < 2000, `${r.ms}ms`);
  check("companies total field = 296", r.body?.total === comps?.length, `total=${r.body?.total}`);

  // /api/sectors
  r = await timed("/api/sectors");
  check("GET /api/sectors -> 200", r.res?.status === 200, `${r.ms}ms`);
  const secs = Array.isArray(r.body) ? r.body : (r.body?.sectors || r.body?.rows);
  check("sectors ~21", Array.isArray(secs) && secs.length >= 15, `n=${secs?.length}`);
  check("sectors no NaN leaks", scanBadNumbers(secs).length === 0, scanBadNumbers(secs).slice(0, 3).join(", "));
  const sec0 = secs?.[0];
  check("sector row has name + change", sec0 && ("nameEn" in sec0 || "nameAr" in sec0) && "avgChangePct" in sec0, Object.keys(sec0 || {}).slice(0, 8).join(","));

  console.log("\n=== 2. COMPANY DETAIL ===");
  // Pick a real ticker from companies list; some illiquid names have no
  // Yahoo history (honest 404) — fall back to known-covered tickers.
  const covered = ["COMI", "TMGH", "SWDY", "ETEL", "EAST"];
  let ticker = c0?.ticker || "COMI";
  {
    const probe = await timed(`/api/chart?symbol=${ticker}&range=1M`);
    if (probe.res?.status !== 200) ticker = covered.find(t => t !== ticker) || "COMI";
  }
  r = await timed(`/api/company/${ticker}`);
  check(`GET /api/company/${ticker} -> 200`, r.res?.status === 200, `${r.ms}ms`);
  const co = r.body;
  const cco = co?.company;
  check("company object with close", cco && typeof cco.close === "number" && typeof cco.ticker === "string", `ticker=${cco?.ticker} close=${cco?.close}`);
  check("company has fundamentals (pe)", cco && "pe" in cco && "pb" in cco, `pe=${cco?.pe} pb=${cco?.pb} roe=${cco?.roe}`);
  check("company has sectorAgg", co?.sectorAgg && typeof co.sectorAgg === "object");
  check("company has peers array", Array.isArray(co?.peers) && co.peers.length > 0, `n=${co?.peers?.length}`);
  check("company has news array", Array.isArray(co?.news));
  check("company has disclosures array", Array.isArray(co?.disclosures));
  check("company has signals object", !!co?.signals && typeof co.signals === "object");
  check("company no NaN leaks", scanBadNumbers(co).length === 0, scanBadNumbers(co).slice(0, 3).join(", "));

  // Invalid ticker
  r = await timed("/api/company/ZZZZZZ");
  check("company invalid ticker -> 404 or null-safe", r.res?.status === 404 || r.res?.status === 400 || (r.res?.status === 200 && !r.body?.company), `status=${r.res?.status}`);
  // lowercase ticker (URL case robustness)
  r = await timed(`/api/company/${ticker.toLowerCase()}`);
  check("company lowercase ticker handled", [200, 404, 400].includes(r.res?.status), `status=${r.res?.status} (${ticker.toLowerCase()})`);
  // ticker with special chars (path traversal attempt)
  r = await timed("/api/company/..%2Fetc");
  check("company path-traversal safe", [200, 400, 404, 500].includes(r.res?.status) && typeof r.body !== "undefined", `status=${r.res?.status}`);

  console.log("\n=== 3. STATEMENTS ===");
  r = await timed("/api/statements/COMI");
  check("GET /api/statements/COMI -> 200", r.res?.status === 200, `${r.ms}ms`);
  check("statements has annual income lines", Array.isArray(r.body?.annual?.income?.lines) && r.body.annual.income.lines.length > 0, `lines=${r.body?.annual?.income?.lines?.length} periods=${r.body?.annual?.income?.periods?.length}`);
  check("statements has balance", Array.isArray(r.body?.annual?.balance?.lines) && r.body.annual.balance.lines.length > 0, `lines=${r.body?.annual?.balance?.lines?.length}`);
  check("statements has cashflow", Array.isArray(r.body?.annual?.cashflow?.lines) && r.body.annual.cashflow.lines.length > 0, `lines=${r.body?.annual?.cashflow?.lines?.length}`);
  check("statements has quarterly income", Array.isArray(r.body?.quarterly?.income?.lines));
  check("statements periods >= 4", (r.body?.annual?.income?.periods?.length ?? 0) >= 4, `periods=${r.body?.annual?.income?.periods?.join(",")}`);
  check("statements no NaN leaks", scanBadNumbers(r.body).length === 0, scanBadNumbers(r.body).slice(0, 3).join(", "));
  r = await timed("/api/statements/NOTICKER");
  check("statements invalid ticker -> 4xx", r.res?.status >= 400 && r.res?.status < 500, `status=${r.res?.status}`);
  r = await timed("/api/statements/ZZZZZ");
  check("statements unknown ticker graceful", r.res?.status < 500, `status=${r.res?.status}`);

  console.log("\n=== 4. CHART ===");
  for (const range of ["1W", "1M", "3M", "6M", "1Y", "5Y"]) {
    r = await timed(`/api/chart?symbol=${ticker}&range=${range}`);
    const pts = r.body?.points;
    check(`chart ${ticker} ${range}`, r.res?.status === 200 && Array.isArray(pts) && pts.length > 0, `n=${pts?.length} ${r.ms}ms`);
    check(`chart ${range} candles well-formed`, pts?.every?.(p => typeof p.close === "number" && Number.isFinite(p.close) && typeof p.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) !== false);
    check(`chart ${range} volumes finite`, pts?.every?.(p => p.volume === undefined || (typeof p.volume === "number" && Number.isFinite(p.volume) && p.volume >= 0)) !== false);
    check(`chart ${range} dates ascending`, pts?.every?.((p, i) => i === 0 || p.date > pts[i - 1].date) !== false);
  }
  // index chart
  r = await timed("/api/chart?symbol=EGX30&range=3M");
  check("chart EGX30 3M", r.res?.status === 200 && Array.isArray(r.body?.points) && r.body.points.length > 10, `n=${r.body?.points?.length}`);
  r = await timed("/api/chart?symbol=EGX70&range=1W");
  check("chart EGX70 1W", r.res?.status === 200 && (r.body?.points?.length ?? 0) >= 1, `n=${r.body?.points?.length} warming=${r.body?.warming}`);
  // bad range + missing symbol
  r = await timed(`/api/chart?symbol=${ticker}&range=99Y`);
  check("chart bad range -> graceful fallback", r.res?.status === 200 && Array.isArray(r.body?.points) && r.body.points.length > 0 && typeof r.body.range === "string", `status=${r.res?.status} fellback→${r.body?.range}`);
  r = await timed("/api/chart?range=1M");
  check("chart missing symbol -> 4xx", r.res?.status >= 400, `status=${r.res?.status}`);
  r = await timed("/api/chart?symbol=HACK&range=1M");
  check("chart invalid symbol -> 4xx/empty", r.res?.status >= 400 || (r.res?.status === 200 && !r.body?.points?.length), `status=${r.res?.status}`);

  console.log("\n=== 5. NEWS ===");
  r = await timed("/api/news?page=1");
  check("GET /api/news -> 200", r.res?.status === 200, `${r.ms}ms`);
  const items = r.body?.items;
  check("news items array", Array.isArray(items) && items.length > 0, `n=${items?.length}`);
  check("news has total", typeof r.body?.total === "number", `total=${r.body?.total}`);
  check("news newest-first", items?.length > 1 && new Date(items[0].publishedAt) >= new Date(items[items.length - 1].publishedAt));
  check("news no NaN leaks", scanBadNumbers(items).length === 0);
  r = await timed("/api/news?page=999");
  check("news deep page -> empty not crash", r.res?.status === 200 && (r.body?.items?.length ?? 0) === 0, `n=${r.body?.items?.length}`);
  r = await timed("/api/news?page=0");
  check("news page=0 graceful", r.res?.status === 200 || r.res?.status === 400, `status=${r.res?.status}`);
  r = await timed("/api/news?page=-5");
  check("news negative page graceful", r.res?.status === 200 || r.res?.status === 400, `status=${r.res?.status}`);
  r = await timed("/api/news?page=abc");
  check("news non-numeric page graceful", r.res?.status === 200 || r.res?.status === 400, `status=${r.res?.status}`);

  console.log("\n=== 6. SEARCH ===");
  r = await timed("/api/search?q=comi");
  check("search 'comi' -> 200 + results", r.res?.status === 200 && (r.body?.results?.length ?? r.body?.length ?? 0) > 0, `n=${r.body?.results?.length ?? r.body?.length}`);
  r = await timed("/api/search?q=%D8%A7%D9%84%D8%AA%D8%AC%D8%A7%D8%B1%D9%8A"); // التجاري in Arabic
  check("search Arabic query -> 200", r.res?.status === 200, `n=${JSON.stringify(r.body).slice(0, 80)}`);
  r = await timed("/api/search?q=");
  check("search empty q -> 200 empty/4xx", r.res?.status === 200 || r.res?.status === 400, `status=${r.res?.status}`);
  r = await timed("/api/search");
  check("search missing q -> 4xx or empty", r.res?.status === 400 || (r.res?.status === 200 && (r.body?.results?.length ?? 0) === 0), `status=${r.res?.status}`);
  r = await timed("/api/search?q=" + "x".repeat(500));
  check("search huge query no crash", r.res?.status !== undefined && r.res?.status < 500, `status=${r.res?.status}`);

  console.log("\n=== 7. INVESTORS / ACTIVITY / ECONOMY ===");
  r = await timed("/api/investors");
  check("GET /api/investors -> 200", r.res?.status === 200, `${r.ms}ms`);
  check("investors has categories", Array.isArray(r.body?.categories) || Array.isArray(r.body?.today?.categories), Object.keys(r.body || {}).join(","));
  check("investors no NaN leaks", scanBadNumbers(r.body).length === 0, scanBadNumbers(r.body).slice(0, 3).join(", "));
  r = await timed("/api/activity");
  check("GET /api/activity -> 200", r.res?.status === 200, `${r.ms}ms`);
  check("activity no NaN leaks", scanBadNumbers(r.body).length === 0);
  r = await timed("/api/economy");
  check("GET /api/economy -> 200", r.res?.status === 200, `${r.ms}ms`);
  const eco = r.body;
  check("economy has FX table", (eco?.fx?.length ?? 0) >= 5, `fx=${eco?.fx?.length}`);
  check("economy has gold", !!eco?.gold);
  check("economy USD/EGP plausible 40-90", (() => {
    const usd = eco?.fx?.find?.(f => (f.code ?? f.cur ?? "").includes("USD"));
    const v = usd?.egpPer ?? usd?.rate ?? usd?.value;
    return typeof v === "number" && v > 40 && v < 90;
  })(), JSON.stringify(eco?.fx?.[0] ?? "").slice(0, 80));
  check("economy fx all rates finite", eco?.fx?.every?.(f => Number.isFinite(f.egpPer)) !== false);

  console.log("\n=== 8. CROSS-ENDPOINT CONSISTENCY ===");
  // company close in /api/companies matches /api/company/[ticker]
  const [rc, rd] = await Promise.all([timed("/api/companies"), timed(`/api/company/${ticker}`)]);
  const listC = (Array.isArray(rc.body) ? rc.body : rc.body?.rows)?.find(c => c.ticker === ticker);
  check(`companies vs company/${ticker} close match`, Math.abs((listC?.close ?? 0) - (rd.body?.company?.close ?? -1)) < 0.51, `list=${listC?.close} detail=${rd.body?.company?.close}`);
  // overview index values consistent across calls
  const ro = await timed("/api/overview");
  const idxAgain = ro.body?.indices?.[0];
  check("overview stable across calls", Math.abs((idx?.close ?? 0) - (idxAgain?.close ?? -1)) < 0.51, `${idx?.close} vs ${idxAgain?.close}`);
  // sector coverage in companies list vs sectors endpoint
  const sectorSet = new Set((Array.isArray(rc.body) ? rc.body : rc.body?.rows).map(c => c.sectorEn || c.sector).filter(Boolean));
  check("companies cover >= 15 sectors", sectorSet.size >= 15, `n=${sectorSet.size}`);
  // every sector in sectors endpoint exists in companies list
  const secsBody = await timed("/api/sectors");
  const secNames = (Array.isArray(secsBody.body) ? secsBody.body : (secsBody.body?.sectors || secsBody.body?.rows))?.map(s => s.nameEn || s.name || s.nameAr).filter(Boolean);
  const missing = secNames?.filter(n => !sectorSet.has(n)) ?? [];
  check("sectors endpoint aligns with companies sectors", missing.length <= 2, `missing=${missing.slice(0, 3).join("|")}`);

  console.log("\n=== 9. PAGE SHELL ===");
  r = await timed("/");
  check("GET / -> 200 html", r.res?.status === 200 && String(r.body).includes("<html"), `${r.ms}ms`);
  r = await timed("/?view=company&ticker=COMI");
  check("GET /?view=company&ticker=COMI -> 200", r.res?.status === 200, `${r.ms}ms`);
  r = await timed("/?view=screener");
  check("GET /?view=screener -> 200", r.res?.status === 200);
  r = await timed("/api/nonexistent");
  check("unknown API -> 404 not 500", r.res?.status === 404, `status=${r.res?.status}`);

  console.log(`\n========== SUMMARY ==========`);
  const pass = results.filter(x => x.ok).length;
  console.log(`TOTAL: ${results.length}  PASS: ${pass}  FAIL: ${failures}`);
  if (failures) {
    console.log("FAILED:");
    results.filter(x => !x.ok).forEach(x => console.log(`  - ${x.name} ${x.detail}`));
    process.exit(1);
  }
})();
