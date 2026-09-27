// T66 — test the ownership merge on the real registry
import { mergeOwnershipNetwork } from "../src/lib/ownership-merge";
import { readFileSync } from "node:fs";

const raw = JSON.parse(readFileSync("src/data/ownership-network.json", "utf-8"));
const t0 = Date.now();
const merged = mergeOwnershipNetwork(raw);
const ms = Date.now() - t0;

console.log(`people: ${raw.people.length} -> ${merged.people.length} (${merged.mergedGroups} groups, ${merged.mergedVariants} variants absorbed) in ${ms}ms`);
console.log(`positions: ${raw.positions.length} -> ${merged.positions.length} (same-holder-same-company collapsed to latest)`);

// show the biggest merged groups
const withAlts = merged.people.filter((p) => p.alts && p.alts.length);
console.log(`\nmerged people (with alts): ${withAlts.length}`);
for (const p of withAlts.slice(0, 14)) {
  const positions = merged.positions.filter((q) => merged.people[q.h] === p).length;
  console.log(`  ✓ ${p.n}  [also: ${p.alts!.join(" | ")}]`);
}

// guards must hold: pension accounts & unions NOT merged
const pension = merged.people.filter((p) => /حساب/.test(p.n));
console.log(`\npension-fund accounts kept separate: ${pension.length}`);
const unions = merged.people.filter((p) => /\(CEFM\)|\(SCFM\)/.test(p.n));
console.log(`unions kept separate: ${unions.length} -> ${unions.map((u) => u.n).join(" / ")}`);

// regression: no duplicate (holder, company) positions
const seen = new Set();
let dups = 0;
for (const p of merged.positions) {
  const k = `${p.h}|${p.t}`;
  if (seen.has(k)) dups++;
  seen.add(k);
}
console.log(`\nduplicate (holder,company) positions after merge: ${dups}`);

// moves remapped: every h in periods < merged.people.length
const badH = merged.periods.flatMap((per) => per.m.filter((m) => m.h >= merged.people.length)).length;
console.log(`moves with out-of-range holder ids: ${badH}`);
