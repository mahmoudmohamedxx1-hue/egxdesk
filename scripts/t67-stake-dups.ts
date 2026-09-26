/** T67 — find the same-name multi-stake cases the user still reports:
 *  within ONE company's holder list, does the same (merged) holder name
 *  appear more than once with different stakes? */
import rawNetwork from "../src/data/ownership-network.json";
import { mergeOwnershipNetwork } from "../src/lib/ownership-merge";

type NetPosition = { h: number; t: string; p: number; a: string | null; b: "r" | "t"; f: string | null; s?: string };

const net = rawNetwork as unknown as Parameters<typeof mergeOwnershipNetwork>[0];
const merged = mergeOwnershipNetwork(net);

// 1) same person id holding the SAME company multiple times (should be none after T66)
const perPersonTicker = new Map<string, number>();
for (const p of merged.positions as NetPosition[]) {
  const key = `${p.h}:${p.t}`;
  perPersonTicker.set(key, (perPersonTicker.get(key) ?? 0) + 1);
}
const dupIds = [...perPersonTicker.entries()].filter(([, n]) => n > 1);
console.log(`same (personId, ticker) duplicates: ${dupIds.length}`);
for (const [k, n] of dupIds.slice(0, 10)) console.log(`  ${k} × ${n}`);

// 2) same NAME (normalized-ish, trimmed) holding the same company via DIFFERENT ids
type P = { name: string; t: string; p: number; id: number; a: string | null; b: string };
const rows: P[] = (merged.positions as NetPosition[]).map((p) => ({
  name: (merged.people[p.h] as { n: string }).n,
  t: p.t,
  p: p.p,
  id: p.h,
  a: p.a,
  b: p.b,
}));
const byNameTicker = new Map<string, P[]>();
for (const r of rows) {
  const key = `${r.name.trim()}||${r.t}`;
  const arr = byNameTicker.get(key) ?? [];
  arr.push(r);
  byNameTicker.set(key, arr);
}
const dups = [...byNameTicker.values()].filter((arr) => arr.length > 1);
console.log(`\nsame NAME holding same company (different ids): ${dups.length}`);
for (const arr of dups.slice(0, 25)) {
  console.log(
    `  ${arr[0].t}: "${arr[0].name}" × ${arr.length} → ${arr
      .map((x) => `${x.p}% (id ${x.id}, ${x.b}, ${x.a ?? "?"})`)
      .join(" | ")}`
  );
}

// 3) same name holding the same company where names differ only by whitespace/case
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const byNormTicker = new Map<string, P[]>();
for (const r of rows) {
  const key = `${norm(r.name)}||${r.t}`;
  const arr = byNormTicker.get(key) ?? [];
  arr.push(r);
  byNormTicker.set(key, arr);
}
const dups3 = [...byNormTicker.values()].filter((arr) => arr.length > 1);
console.log(`\nsame normalized NAME holding same company: ${dups3.length}`);
for (const arr of dups3.slice(0, 25)) {
  console.log(
    `  ${arr[0].t}: "${arr[0].name}" × ${arr.length} → ${arr.map((x) => `${x.p}% (id ${x.id}, ${x.b})`).join(" | ")}`
  );
}

// 4) fuzzy: same company, names sharing the first 2 words (catch "X القابضة" vs "X")
const byTicker = new Map<string, P[]>();
for (const r of rows) {
  const arr = byTicker.get(r.t) ?? [];
  arr.push(r);
  byTicker.set(r.t, arr);
}
let fuzzyCount = 0;
console.log(`\nfuzzy same-name candidates (first-2-words equal, same company):`);
for (const [t, arr] of byTicker) {
  const seen = new Set<string>();
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const wi = arr[i].name.split(/\s+/);
      const wj = arr[j].name.split(/\s+/);
      const ki = wi.slice(0, Math.min(2, wi.length)).join(" ");
      const kj = wj.slice(0, Math.min(2, wj.length)).join(" ");
      if (ki && ki === kj && arr[i].id !== arr[j].id) {
        const key = `${arr[i].id}:${arr[j].id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        fuzzyCount++;
        if (fuzzyCount <= 20) {
          console.log(`  ${t}: "${arr[i].name}" (${arr[i].p}%) vs "${arr[j].name}" (${arr[j].p}%)`);
        }
      }
    }
  }
}
console.log(`total fuzzy candidates: ${fuzzyCount}`);
