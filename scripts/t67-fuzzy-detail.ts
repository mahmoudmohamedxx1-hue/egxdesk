/** T67 — inspect the raw filings behind the fuzzy duplicate pairs so the
 *  merge rules can be designed safely (dates, basis, filing ids). */
import rawNetwork from "../src/data/ownership-network.json";

type NetPerson = { n: string; e?: string; k: "p" | "f" };
type NetPosition = { h: number; t: string; p: number; a: string | null; b: "r" | "t"; f: string | null; s?: string };
const net = rawNetwork as unknown as { people: NetPerson[]; positions: NetPosition[] };

const targets: [string, string, string][] = [
  ["TWSA", "ام جيه سي للتجارة والاستثمار العقاري MJC", "ام جيه سي للتجارة والاستثمار العقاري"],
  ["NIPH", "اورينت تورز للفنادق و القرى السياحية", "اورينت تورز للقري و الفنادق السياحيه"],
  ["EGAL", "صندوق التأمين الاجتماعي للعاملين بالقطاع الحكومي", "صندوق التأمين الإجتماعي للعاملين بالقطاع الحكومى ۳"],
];

for (const [t, a, b] of targets) {
  console.log(`\n=== ${t} ===`);
  for (const p of net.positions) {
    const name = net.people[p.h]?.n;
    if (p.t === t && (name === a || name === b)) {
      console.log(
        `  id=${p.h} "${name}" pct=${p.p} asOf=${p.a} basis=${p.b} filing=${p.f}`
      );
    }
  }
}

// also count how many names carry a trailing Latin token (acronym suffix pattern)
let trailingLatin = 0;
for (const person of net.people) {
  if (/\s[A-Z]{2,}[.\s]*$/.test(person.n.trim())) trailingLatin++;
}
console.log(`\npeople with trailing Latin acronym: ${trailingLatin}`);

// and trailing stray digits (western or persian)
let trailingDigit = 0;
for (const person of net.people) {
  if (/\s[0-9۰-۹]{1,2}$/.test(person.n.trim())) trailingDigit++;
}
console.log(`people with trailing stray digit: ${trailingDigit}`);
