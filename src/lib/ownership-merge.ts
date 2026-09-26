/** T66 — conservative duplicate-holder merge for the ownership lens.
 *
 *  The EGX disclosure archive names the SAME person/company as several
 *  separate registry entries with filing-typos: a leading "+", "ليمتد" vs
 *  "ليميتد", "لالتصالات" vs "للاتصالات", "للاستثمارت" vs "للاستثمارات",
 *  hamza/alef spelling variants, "ة/ه" and "ى/ي" endings… The user saw the
 *  result on the board: the same name holding "4.5%" and "15.6%" as two
 *  different people. This module merges those variants into ONE holder —
 *  conservatively, because a WRONG merge invents an investor that does not
 *  exist:
 *
 *  GUARDS (never merge when any fails):
 *   1. the first normalized word must be IDENTICAL — "محمد…" never merges
 *      with "محمود…" even at 0.98 similarity (different first names);
 *   2. the DIGITS (western + Arabic-Indic, normalized) must match exactly —
 *      "صندوق … حساب ٦" and "حساب ٧" are genuinely DIFFERENT funds;
 *   3. parenthetical content must match — "اتحاد العاملين (CEFM)" and
 *      "(SCFM)" are different unions;
 *   4. same word count.
 *
 *  MERGE RULES (when all guards pass):
 *   A. identical after normalization (diacritics stripped, alef variants
 *      unified, final ى→ي / ة→ه, punctuation & leading "+"/"أ/" removed,
 *      spaces squeezed) → merge;
 *   B. bounded edit distance ≤ 2 on the squeezed string (length ≥ 8) →
 *      merge — catches the single-letter filing typos.
 *
 *  The canonical entry of each group is the one with the most standing
 *  positions (ties: the longer name); it carries `alts` — the variant
 *  spellings it absorbed — so the profile can say "also filed as: …".
 *  Positions of the same (holder, company) collapse to the LATEST filing
 *  (stakes change over time; they never sum). Period moves keep their
 *  history with holder ids remapped. Pure + deterministic + computed once
 *  per process from the static JSON — daily data refreshes inherit it on
 *  every deploy automatically. */

export type NetPerson = { n: string; e?: string; k: "p" | "f" };
export type NetPosition = { h: number; t: string; p: number; a: string | null; b: "r" | "t"; f: string | null; s?: string };
export type NetMove = { h: number; t: string; f: number | null; o: number | null; c: number | null };
export type NetPeriod = { start: string; end: string; l: string; n: number; m: NetMove[] };

export type MergedPerson = NetPerson & { alts?: string[] };

export type MergedNetwork = {
  people: MergedPerson[];
  positions: NetPosition[];
  periods: NetPeriod[];
  /** id remap: old index → canonical index (identical when no merge) */
  remap: number[];
  mergedGroups: number;
  mergedVariants: number;
};

// ── normalization ──

const ARABIC_DIACRITICS = /[\u064B-\u0652\u0640\u0670]/g;

/** leading honorific/typo prefixes seen in the archive ("+", "أ/", "ا/", "م/") */
const LEADING_JUNK = /^[\+\-_]*\s*(?:(?:أ|ا|م|د|مهندس|مهندسة|السيد|السيدة|أ\.|ا\.|م\.)\s+)?/;

function normalizeName(raw: string): string {
  let s = (raw ?? "").trim();
  s = s.replace(ARABIC_DIACRITICS, "");
  s = s.replace(LEADING_JUNK, "");
  // alef variants
  s = s.replace(/[أإآٱ]/g, "ا");
  // word-final ى → ي and ة → ه (filing orthography varies for the same name)
  s = s.replace(/ى(?=\s|$)/g, "ي").replace(/ة(?=\s|$)/g, "ه");
  // latin side: lowercase + strip accents-lite
  s = s.toLowerCase();
  // punctuation → space (keep parentheses content for the guard, applied on
  // the original below — here parens become spaces too, the guard uses raw)
  s = s.replace(/[^\p{L}\p{N}\s()]/gu, " ");
  return s.replace(/\s+/g, " ").trim();
}

const squeeze = (s: string) => s.replace(/\s+/g, "");

/** all digits found (Arabic-Indic normalized to western) — the guard multiset */
function digitsOf(raw: string): string[] {
  const map: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };
  const out: string[] = [];
  for (const ch of raw) {
    if (/[0-9]/.test(ch)) out.push(ch);
    else if (map[ch]) out.push(map[ch]);
  }
  return out.sort();
}

/** parenthetical contents, in order — the union/fund-suffix guard */
function parensOf(raw: string): string[] {
  const out: string[] = [];
  const re = /\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.push(m[1].trim());
  return out;
}

/** bounded edit distance: returns true when dist(a,b) ≤ max */
function withinEditDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  // classic DP with early exit, band-limited
  const INF = max + 1;
  let prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(INF);
    cur[0] = i;
    const lo = Math.max(1, i - max);
    const hi = Math.min(b.length, i + max);
    for (let j = lo; j <= hi; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    if (cur.every((v) => v > max)) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

const sameSeq = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** can the two RAW names be merged? (guards + rules, order matters) */
function mergeable(rawA: string, rawB: string): boolean {
  const a = normalizeName(rawA);
  const b = normalizeName(rawB);
  if (!a || !b || a === b) return a === b && a.length > 0;
  const ta = a.split(" ");
  const tb = b.split(" ");
  // GUARD 1: same first word  GUARD 4: same word count
  if (ta[0] !== tb[0] || ta.length !== tb.length) return false;
  // GUARD 2: identical digits
  if (!sameSeq(digitsOf(rawA), digitsOf(rawB))) return false;
  // GUARD 3: identical parenthetical content
  if (!sameSeq(parensOf(rawA), parensOf(rawB))) return false;
  const sa = squeeze(a);
  const sb = squeeze(b);
  if (sa === sb) return true; // rule A
  // rule B: ≤1 edit on a name of meaningful length — single-letter filing
  // typos (لالتصالات→للاتصالات, ليمتد→ليميتد, دابل→دايل). TWO edits can turn
  // one family name into another (سعيد→سمير, بسيونى→سيرني) — never merged.
  if (sa.length >= 8 && sb.length >= 8 && withinEditDistance(sa, sb, 1)) return true;
  return false;
}

/** merge the registry + remap positions/moves. Deterministic, pure. */
export function mergeOwnershipNetwork(input: {
  people: NetPerson[];
  positions: NetPosition[];
  periods: NetPeriod[];
}): MergedNetwork {
  const n = input.people.length;
  const parent = new Array<number>(n).fill(0).map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (x: number, y: number) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[Math.max(rx, ry)] = Math.min(rx, ry);
  };

  // bucket by (first word, word count, kind) — only compare within buckets
  const buckets = new Map<string, number[]>();
  const normKeys = input.people.map((p, i) => {
    const nm = normalizeName(p.n);
    const words = nm.split(" ");
    return { first: words[0] ?? "", count: words.length, kind: p.k };
  });
  normKeys.forEach((k, i) => {
    const key = `${k.kind}|${k.first}|${k.count}`;
    const arr = buckets.get(key) ?? [];
    arr.push(i);
    buckets.set(key, arr);
  });
  // COMPLETE-LINKAGE clustering: a group only grows when the candidate is
  // mergeable with EVERY current member. Single-linkage chaining once fused
  // a family of different last names (سعيد→سميد→سمير each one letter apart);
  // complete linkage keeps groups tight.
  const members = new Map<number, number[]>(); // root → member ids
  const membersOf = (root: number): number[] => {
    const arr = members.get(root);
    if (arr) return arr;
    const single = [root];
    members.set(root, single);
    return single;
  };
  for (const idxs of buckets.values()) {
    for (let i = 0; i < idxs.length; i++) {
      for (let j = i + 1; j < idxs.length; j++) {
        const ri = find(idxs[i]);
        const rj = find(idxs[j]);
        if (ri === rj) continue;
        const gi = membersOf(ri);
        const gj = membersOf(rj);
        const compatible = gi.every((a) => gj.every((b) => a === b || mergeable(input.people[a].n, input.people[b].n)));
        if (compatible) {
          union(idxs[i], idxs[j]);
          // rebuild the member lists under the new root
          const nr = find(idxs[i]);
          const all = [...gi, ...gj];
          members.delete(ri === nr ? rj : ri);
          members.set(nr, all);
        }
      }
    }
  }

  // canonical per group: most positions (ties → longer name, then lower id)
  const posCount = new Map<number, number>();
  for (const p of input.positions) posCount.set(p.h, (posCount.get(p.h) ?? 0) + 1);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const arr = groups.get(r) ?? [];
    arr.push(i);
    groups.set(r, arr);
  }

  const remap = new Array<number>(n).fill(0);
  const people: MergedPerson[] = [];
  let mergedGroups = 0;
  let mergedVariants = 0;
  for (const members of groups.values()) {
    const canonical = [...members].sort((a, b) => {
      const ca = posCount.get(a) ?? 0;
      const cb = posCount.get(b) ?? 0;
      if (ca !== cb) return cb - ca;
      const la = input.people[a].n.length;
      const lb = input.people[b].n.length;
      if (la !== lb) return lb - la;
      return a - b;
    })[0];
    const newId = people.length;
    const base = input.people[canonical];
    const alts = members
      .filter((m) => m !== canonical)
      .map((m) => input.people[m].n)
      .filter((nm) => nm !== base.n);
    people.push({ ...base, ...(alts.length ? { alts } : {}) });
    for (const m of members) remap[m] = newId;
    if (members.length > 1) {
      mergedGroups++;
      mergedVariants += members.length - 1;
    }
  }

  // positions: remap + collapse same (holder, company) to the LATEST filing
  const posByKey = new Map<string, NetPosition>();
  for (const p of input.positions) {
    const key = `${remap[p.h]}|${p.t}`;
    const cur = posByKey.get(key);
    if (!cur) {
      posByKey.set(key, { ...p, h: remap[p.h] });
      continue;
    }
    // keep the newer asOf; ties → register basis wins; then the larger stake
    const aDate = cur.a ?? "";
    const bDate = p.a ?? "";
    if (bDate > aDate || (bDate === aDate && (p.b === "r" || (cur.b !== "r" && p.p > cur.p)))) {
      posByKey.set(key, { ...p, h: remap[p.h] });
    }
  }

  const periods = input.periods.map((per) => ({
    ...per,
    m: per.m.map((mv) => ({ ...mv, h: remap[mv.h] })),
  }));

  return { people, positions: [...posByKey.values()], periods, remap, mergedGroups, mergedVariants };
}
