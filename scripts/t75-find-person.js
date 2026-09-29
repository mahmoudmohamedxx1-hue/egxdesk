// T75 — find a PERSON investor with several companies + moves (EN pronoun check)
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const d = JSON.parse(s);
  const byHolder = new Map();
  for (const p of d.positions) {
    if (!byHolder.has(p.h)) byHolder.set(p.h, 0);
    byHolder.set(p.h, byHolder.get(p.h) + 1);
  }
  const withMoves = new Set();
  for (const per of d.periods) for (const m of per.m) withMoves.add(m.h);
  let found = 0;
  for (let i = 0; i < d.people.length && found < 3; i++) {
    const person = d.people[i];
    if (person.k === "p" && (byHolder.get(i) ?? 0) >= 2 && withMoves.has(i)) {
      console.log(`PERSON h=${i} | ${person.n} | e=${person.e ?? "-"} | companies=${byHolder.get(i)}`);
      found++;
    }
  }
});
