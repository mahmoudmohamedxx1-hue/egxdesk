#!/usr/bin/env node
/** T58 — build src/data/ownership-network.json from the captured EGX
 *  disclosure archive (scripts/research/t58-esthmr-live/insider-people.json
 *  + sector-ownership.json — parsed from the official EGX bulletin PDFs).
 *
 *  Compact schema (client builds bulletin URLs from the id):
 *    people[]    {n: nameAr, e?: nameEn, k: p|f}
 *    positions[] {h: peopleIdx, t: ticker, p: pct, a: asOf, b: r|t, f: filingId, s: bulletinFile}
 *    periods[]   {start, end, l: labelAr, n: movesCount, m: [{h: peopleIdx, t, f: from%, o: to%, c: changePP}]}
 *    cross[]     {o: owner ticker, d: held ticker, p: pct, v: valueEgp, f: filingId, s: bulletinFile}
 *    refused[]   honesty list (filings the parser rejected and why)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// repo-relative (works in the sandbox AND in CI checkouts)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "scripts", "research", "t58-esthmr-live");
const OUT = path.join(ROOT, "src", "data", "ownership-network.json");

const ip = JSON.parse(fs.readFileSync(`${SRC}/insider-people.json`, "utf8"));
const so = JSON.parse(fs.readFileSync(`${SRC}/sector-ownership.json`, "utf8"));

// ── people index (name + aliases → array position) ──
// names arrive with occasional markdown junk from the source parsing
// ("**ALPHA ORYX LIMITED", "*Odyssey Re…") — strip it once, here.
const cleanName = (raw) =>
  String(raw)
    .replace(/^[*_`\s]+/, "")
    .replace(/[*_`\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

const people = [];
const nameToIdx = new Map();
const intern = (name) => {
  if (!name) return null;
  const key = cleanName(name);
  if (!key) return null;
  if (nameToIdx.has(key)) return nameToIdx.get(key);
  const idx = people.length;
  people.push({ n: key });
  nameToIdx.set(key, idx);
  return idx;
};

// build people from the source list (keep their ar/en/kind when present)
for (const p of ip.people) {
  const idx = intern(p.name);
  if (p.nameEn) people[idx].e = p.nameEn;
  people[idx].k = p.kind === "firm" ? "f" : "p";
  for (const a of p.aliases ?? []) nameToIdx.set(String(a).trim(), idx);
}

// ── positions ──
const bulletin = (url) => {
  if (typeof url !== "string") return null;
  const m = url.match(/(\d+_\d+)\.pdf$/);
  return m ? m[1] : null;
};
const positions = [];
let droppedNoHolder = 0;
for (const pos of ip.positions) {
  const h = intern(pos.holder);
  if (h === null || typeof pos.percent !== "number" || !Number.isFinite(pos.percent)) {
    droppedNoHolder++;
    continue;
  }
  // keep the person record's kind when the position knows it
  if (pos.kind && !people[h].k) people[h].k = pos.kind === "firm" ? "f" : "p";
  const rec = {
    h,
    t: pos.ticker,
    p: Math.round(pos.percent * 100) / 100,
    a: pos.asOf ?? null,
    b: pos.basis === "register" ? "r" : "t",
    f: pos.filingId ?? null,
  };
  const s = bulletin(pos.source);
  if (s) rec.s = s;
  positions.push(rec);
}

// ── weekly periods ──
const periods = [];
for (const per of ip.periods ?? []) {
  const moves = (per.moves ?? [])
    .map((mv) => {
      const h = intern(mv.holder);
      if (h === null) return null;
      return {
        h,
        t: mv.ticker,
        f: typeof mv.from === "number" ? Math.round(mv.from * 100) / 100 : null,
        o: typeof mv.to === "number" ? Math.round(mv.to * 100) / 100 : null,
        c: typeof mv.change === "number" ? Math.round(mv.change * 100) / 100 : null,
      };
    })
    .filter(Boolean);
  periods.push({
    start: per.start,
    end: per.end,
    l: per.labelAr ?? per.label ?? `${per.start} → ${per.end}`,
    n: moves.length,
    m: moves,
  });
}

// ── cross holdings (listed company → listed company) ──
const cross = (so.links ?? [])
  .map((l) => {
    const rec = {
      o: l.owner,
      d: l.held,
      p: typeof l.percent === "number" ? Math.round(l.percent * 100) / 100 : null,
      v: typeof l.value === "number" ? Math.round(l.value) : null,
    };
    if (l.filingId) rec.f = String(l.filingId);
    const s = bulletin(l.source ?? l.filingUrl);
    if (s) rec.s = s;
    return rec;
  })
  .filter((r) => r.o && r.d);

const out = {
  asOf: so.asOf ?? ip.generated?.slice(0, 10) ?? "2026-09-22",
  sourceAr:
    "نماذج الإفصاح الرسمية للبورصة المصرية (إفصاح بعد التنفيذ + إفصاح عن مجلس الإدارة وهيكل المساهمين) — كل حصة موثقة برابط النشرة الرسمية",
  source:
    "Official EGX disclosure forms (post-execution + board & shareholder structure) — every position links to the official bulletin PDF",
  bulletinBase: "https://www.egx.com.eg/downloads/Bulletins/",
  people,
  positions,
  periods,
  cross,
  refused: (so.refused ?? []).map((r) => ({ holder: r.holder, t: r.ticker, why: r.why })),
  counts: {
    people: people.length,
    positions: positions.length,
    tickersWithPositions: new Set(positions.map((p) => p.t)).size,
    periods: periods.length,
    cross: cross.length,
    droppedNoHolder,
  },
};

fs.writeFileSync(OUT, JSON.stringify(out));
const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`written ${OUT} — ${kb} KB`);
console.log("counts:", JSON.stringify(out.counts));
// sanity: a known position (WAFA ASSURANCE 97.86% of DEIN)
const wafa = people.findIndex((p) => p.n === "WAFA ASSURANCE");
const dein = positions.find((p) => p.t === "DEIN" && p.h === wafa);
console.log("WAFA→DEIN check:", JSON.stringify(dein));
const comiPos = positions.filter((p) => p.t === "COMI");
console.log("COMI positions:", comiPos.length, "| top:", JSON.stringify(comiPos.sort((a, b) => b.p - a.p).slice(0, 3)));
