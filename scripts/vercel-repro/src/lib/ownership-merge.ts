/** T66 → T67 — conservative duplicate-holder merge for the ownership lens.
 *
 *  The EGX disclosure archive names the SAME person/company as several
 *  separate registry entries with filing-typos: a leading "+", "ليمتد" vs
 *  "ليميتد", "لالتصالات" vs "للاتصالات", hamza/alef spelling variants, "ة/ه"
 *  and "ى/ي" endings… The user saw the result on the board: the same name
 *  holding "4.5%" and "15.6%" as two different people. This module merges
 *  those variants into ONE holder — conservatively, because a WRONG merge
 *  invents an investor that does not exist:
 *
 *  GUARDS (never merge when any fails):
 *   1. the first normalized word must be IDENTICAL — "محمد…" never merges
 *      with "محمود…" even at 0.98 similarity (different first names);
 *   2. the DIGITS must match when BOTH names carry them — "صندوق … حساب ٦"
 *      and "حساب ٧" are genuinely DIFFERENT funds (T67: digits may be
 *      absent on one side only when the other side's digit is a trailing
 *      stray attached to a non-account word);
 *   3. parenthetical content must match — "اتحاد العاملين (CEFM)" and
 *      "(SCFM)" are different unions; two DIFFERENT Latin acronym tails
 *      never merge either (rule C only absorbs a tail into a tail-FREE
 *      twin);
 *   4. same word count for the edit-distance and token-set rules.
 *
 *  MERGE RULES (when the guards pass):
 *   A. identical after normalization (diacritics stripped, alef variants
 *      unified, final ى→ي / ة→ه, punctuation & leading "+"/"أ/" removed,
 *      Persian digits → western, spaces squeezed) → merge;
 *   B. bounded edit distance ≤ 1 on the squeezed string (length ≥ 8) →
 *      merge — catches single-letter filing typos;
 *   C. TRAILING LATIN ACRONYM (T67): "ام جيه سي للتجارة والاستثمار العقاري
 *      MJC" ≡ "ام جيه سي للتجارة والاستثمار العقاري" — the acronym is the
 *      transliteration of the Arabic name; one side must be tail-FREE;
 *   D. TOKEN-SET equality, order-insensitive (T67): "اورينت تورز للفنادق و
 *      القرى السياحية" ≡ "اورينت تورز للقري و الفنادق السياحيه" — the same
 *      words in a different order with ة/ه/ى spelling drift (definite-article
 *      prefixes ال/لل stripped per token before comparing, ≥3 tokens);
 *   E. TRAILING STRAY DIGIT (T67): "… بالقطاع الحكومى ۳" ≡ "… الحكومي" — a
 *      lone trailing digit (Persian/western) that is NOT an account number
 *      (not preceded by حساب/رقم) is filing garbage; strip and compare.
 *
 *  The canonical entry of each group is the one with the most standing
 *  positions (ties: the longer name); it carries `alts` — the variant
 *  spellings it absorbed — so the profile can say "also filed as: …".
 *  Positions of the same (holder, company) collapse to the LATEST filing
 *  (stakes change over time; they never sum; same-date ties keep the
 *  register basis, then the LARGER stake — the same filing's typo'd dust
 *  row loses). Period moves keep their history with holder ids remapped.
 *  Pure + deterministic + computed once per process from the static JSON —
 *  daily data refreshes inherit it on every deploy automatically. */

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

/** leading honorific/typo prefixes seen in the archive ("+", "أ/", "ا/", "م/",
 *  and the generic corporate prefix شركة/الشركة in its ة/ه spellings — T67:
 *  filings alternate "شركة اورينت تورز…" with "اورينت تورز…" for the SAME
 *  entity, and the prefix was pushing the first-word guard apart). */
const LEADING_JUNK = /^[\+\-_]*\s*(?:(?:أ|ا|م|د|مهندس|مهندسة|السيد|السيدة|شركة|الشركة|شركه|الشركه|أ\.|ا\.|م\.)\s+)?/;

/** T67 — Persian (U+06F0-06F9) AND Arabic-Indic (U+0660-0669) digits appear
 *  in filings ("الحكومى ۳", "الحكومي ٣"); normalize them to western so the
 *  tail rules and the digit guard see them uniformly. */
const DIGIT_MAP: Record<string, string> = {
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

function normalizeName(raw: string): string {
  let s = (raw ?? "").trim();
  s = s.replace(ARABIC_DIACRITICS, "");
  s = s.replace(LEADING_JUNK, "");
  // alef variants
  s = s.replace(/[أإآٱ]/g, "ا");
  // T67 — Persian + Arabic-Indic digits → western (so tails/guards match)
  s = s.replace(/[۰-۹٠-٩]/g, (ch) => DIGIT_MAP[ch] ?? ch);
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

const sameSet = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
};

/** digits of a NORMALIZED name (Persian already → western), sorted — the guard multiset */
function digitsOfNorm(norm: string): string[] {
  const out: string[] = [];
  for (const ch of norm) if (/[0-9]/.test(ch)) out.push(ch);
  return out.sort();
}

/** all digits found in the RAW name (western + Arabic-Indic), sorted */
function digitsOf(raw: string): string[] {
  const map: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };
  const out: string[] = [];
  for (const ch of raw) {
    if (/[0-9]/.test(ch)) out.push(ch);
    else if (map[ch]) out.push(map[ch]);
  }
  return out.sort();
}

// ── T67 tail rules ──

/** a trailing Latin acronym token (≥2 letters, e.g. "mjc") */
const LATIN_TAIL = /(?:^|\s)([a-z]{2,10})$/;
/** a trailing lone digit token (1-2 chars) */
const DIGIT_TAIL = /(?:^|\s)([0-9]{1,2})$/;
/** account-number markers — a digit after these is REAL (pension accounts), never stripped */
const ACCOUNT_TAIL = /(?:حساب|رقم)\s*$/u;

type Variant = { core: string; tail: string | null; tailIsDigit: boolean };

/** the comparison variants of a normalized name: the full name, plus — when
 *  a trailing Latin acronym / stray digit can be safely dropped — the
 *  stripped core. Guards: the remaining core must have ≥3 tokens, and an
 *  account-number digit (حساب ٦ / رقم 7) is never stripped. */
function coreVariants(norm: string): Variant[] {
  const out: Variant[] = [{ core: norm, tail: null, tailIsDigit: false }];
  const mLatin = norm.match(LATIN_TAIL);
  if (mLatin) {
    const core = norm.slice(0, norm.length - mLatin[1].length).trim();
    if (core.split(" ").filter(Boolean).length >= 3) {
      out.push({ core, tail: mLatin[1], tailIsDigit: false });
    }
  }
  const mDigit = norm.match(DIGIT_TAIL);
  if (mDigit) {
    const core = norm.slice(0, norm.length - mDigit[1].length).trim();
    if (core.split(" ").filter(Boolean).length >= 3 && !ACCOUNT_TAIL.test(core)) {
      out.push({ core, tail: mDigit[1], tailIsDigit: true });
    }
  }
  return out;
}

/** definite-article prefixes stripped per token for the order-insensitive
 *  token-set rule (D): "للفنادق" ≡ "الفنادق" once ال/لل is removed; the
 *  conjunction و attaches to the NEXT word in filings ("والقرى" vs
 *  "و القرى") so a و-prefixed token splits into "و" + the word. */
const splitConjunction = (tok: string): string[] =>
  /^و.{2,}$/.test(tok) ? ["و", tok.slice(1)] : [tok];
const stripArticle = (tok: string) => tok.replace(/^(?:ال|لل)/, "");
const normTokens = (a: string[]) => a.flatMap(splitConjunction).map(stripArticle);

/** can the two RAW names be merged? (guards + rules, order matters) */
function mergeable(rawA: string, rawB: string): boolean {
  const a = normalizeName(rawA);
  const b = normalizeName(rawB);
  if (!a || !b) return false;
  if (a === b) return true; // rule A — identical after normalization
  // GUARD 3: identical parenthetical content
  if (!sameSeq(parensOf(rawA), parensOf(rawB))) return false;
  // GUARD 1: same first word (on the base names — tail stripping never
  // touches the head, so this guard also protects the tail rules)
  if (a.split(" ")[0] !== b.split(" ")[0]) return false;
  // rules A/C/E + B/D across the VARIANT cross-product: a tail-stripped core
  // may also need the fine-grained rules — "ام جيه سي … العقاري MJC" vs
  // "شركه ام جي سي للتجاره والاستثمار العقاري" merges only as (acronym-
  // stripped core) × (one-edit-typo base). TWO DIFFERENT Latin tails never
  // merge (CEFM ≠ SCFM) — a tail only ever absorbs into a tail-FREE twin
  // (or an equal tail). Digits of the COMPARED cores must agree, so account
  // numbers stay apart.
  const da = digitsOf(a);
  const db = digitsOf(b);
  const va = coreVariants(a);
  const vb = coreVariants(b);
  for (const xa of va) {
    for (const xb of vb) {
      const bothLatin = xa.tail && xb.tail && xa.tail !== xb.tail && !xa.tailIsDigit && !xb.tailIsDigit;
      if (bothLatin) continue; // different acronyms = different entities
      if (!sameSeq(digitsOfNorm(xa.core), digitsOfNorm(xb.core))) continue;
      if (xa.core === xb.core) return true; // rules A/C/E — identical cores
      // rule B (≤1 edit) on this variant pair, same word count
      const ta = xa.core.split(" ");
      const tb = xb.core.split(" ");
      if (ta.length === tb.length) {
        const sa = squeeze(xa.core);
        const sb = squeeze(xb.core);
        if (sa.length >= 8 && sb.length >= 8 && withinEditDistance(sa, sb, 1)) return true;
      }
      // rule D: token-SET equality (order-insensitive, ≥3 tokens, conjunctions
      // split, articles stripped) — the same words filed in a different order,
      // with و attached or detached, with ة/ه drift. Word count is deliberately
      // NOT required here: "و القرى" vs "والقرى" changes the count, not the words.
      const na = normTokens(ta);
      const nb = normTokens(tb);
      if (na.length >= 3 && nb.length >= 3 && sameSet(na, nb)) return true;
    }
  }
  // GUARD 2 (strict form): when BOTH full names carry digits they must agree
  // (pension accounts) — checked late because the variant loops above already
  // compare the digits of every candidate pair
  if (da.length > 0 && db.length > 0 && !sameSeq(da, db)) return false;
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

  // bucket by (first word, kind) — only compare within buckets. T67: the
  // word count LEFT the bucket key (the tail rules and the conjunction-split
  // token-set rule legitimately merge across counts — "… MJC" vs "…",
  // "و القرى" vs "والقرى"); complete-linkage below keeps groups tight.
  const buckets = new Map<string, number[]>();
  const normKeys = input.people.map((p, i) => {
    const nm = normalizeName(p.n);
    const words = nm.split(" ");
    return { first: words[0] ?? "", kind: p.k };
  });
  normKeys.forEach((k, i) => {
    const key = `${k.kind}|${k.first}`;
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
    // keep the newer asOf; same-date ties → register basis wins; same basis
    // → the LARGER stake (the same filing's typo'd dust row — 0.01% under a
    // garbage spelling — loses to the clean row)
    const aDate = cur.a ?? "";
    const bDate = p.a ?? "";
    const replace =
      bDate > aDate ||
      (bDate === aDate && (p.b !== cur.b ? p.b === "r" : p.p > cur.p));
    if (replace) {
      posByKey.set(key, { ...p, h: remap[p.h] });
    }
  }

  const periods = input.periods.map((per) => ({
    ...per,
    m: per.m.map((mv) => ({ ...mv, h: remap[mv.h] })),
  }));

  return { people, positions: [...posByKey.values()], periods, remap, mergedGroups, mergedVariants };
}
