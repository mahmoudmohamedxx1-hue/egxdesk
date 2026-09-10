/** Server-side Egypt rates layer (G12) — the interest-rate context an
 *  Egyptian saver weighs against stocks: the central bank's main policy
 *  rate, the overnight lending rate, and the interbank rate, parsed from
 *  Trading Economics' server-rendered Egypt pages (public, no key, no auth).
 *
 *  The same pages publish the CBE rate-decision calendar — we surface the
 *  next scheduled decision so the panel says WHEN the number may change.
 *
 *  Values are cross-consistent with the page tables: Interest Rate 19.00%,
 *  Overnight Lending 20.00%, Interbank 19.47% verified live on 2026-09-10. */

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type RateRow = {
  key: "policy" | "lending" | "interbank";
  value: number; // percent
  previous: number | null;
  reference: string; // "Aug 2026" / "Sep 2026"
  meaningAr: string;
  meaningEn: string;
};

export type RatesData = {
  rows: RateRow[];
  nextDecision: string | null; // yyyy-mm-dd
  source: string;
  sourceUrl: string;
  fetchedAt: string;
};

// ─────────────────────────────────────────────────────────── caching ───

const TTL = 60 * 60_000; // 1h — rates change on decision days, not minutes
type Entry = { data: RatesData; at: number };
let ratesCache: Entry | null = null;
let ratesInflight: Promise<RatesData> | null = null;

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Parse TE's "Related" table rows (Last | Previous | Unit | Reference). */
function parseRelated(html: string): Map<string, { last: string; prev: string; ref: string }> {
  const out = new Map<string, { last: string; prev: string; ref: string }>();
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  for (const r of rows) {
    const cells = (r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) ?? []).map((c) => stripTags(c));
    // row shape: [name, last, previous, unit, reference]
    if (cells.length >= 5 && cells[3] === "percent") {
      out.set(cells[0], { last: cells[1], prev: cells[2], ref: cells[4] ?? "" });
    }
  }
  return out;
}

/** Parse upcoming rate-decision dates from the TE calendar table
 *  (rows like: 2026-09-24 | 04:00 PM | Interest Rate Decision | 19%). */
function parseNextDecision(html: string): string | null {
  const today = new Date().toISOString().slice(0, 10);
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  const dates: string[] = [];
  for (const r of rows) {
    const cells = (r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) ?? []).map((c) => stripTags(c));
    if (cells.length >= 3 && /^Interest Rate Decision/.test(cells[2] ?? "")) {
      const d = cells[0] ?? "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today) dates.push(d);
    }
  }
  return dates.length ? dates.sort()[0] : null;
}

function num(s: string): number | null {
  const v = Number(s.replace(/%/g, ""));
  return Number.isFinite(v) ? v : null;
}

export async function fetchRates(): Promise<RatesData> {
  if (ratesCache && Date.now() - ratesCache.at < TTL) return ratesCache.data;
  if (ratesInflight) return ratesInflight;
  const p = (async (): Promise<RatesData> => {
    const html = (await fetchPage("https://tradingeconomics.com/egypt/interest-rate")) ?? "";
    const related = parseRelated(html);

    const rows: RateRow[] = [];
    const policy = related.get("Interest Rate");
    const policyVal = policy ? num(policy.last) : null;
    if (policyVal != null) {
      rows.push({
        key: "policy",
        value: policyVal,
        previous: policy ? num(policy.prev) : null,
        reference: policy?.ref ?? "",
        meaningAr:
          "السعر الذي يقرره البنك المركزي للجنيه ليلة واحدة — سقف تنافسي لكل عائد في الاقتصاد، ويتغير بقرار لجنة السياسة النقدية.",
        meaningEn:
          "The central bank's overnight price of the pound — a competitive ceiling on every yield in the economy, changed only by MPC decision.",
      });
    }
    const lending = related.get("Overnight Lending Rate");
    const lendingVal = lending ? num(lending.last) : null;
    if (lendingVal != null) {
      rows.push({
        key: "lending",
        value: lendingVal,
        previous: lending ? num(lending.prev) : null,
        reference: lending?.ref ?? "",
        meaningAr:
          "الحد الأعلى الذي تُقرض به البنوك بعضها ليلة واحدة من المركزي — السقف الفعلي لتكلفة النقد قصير الأجل.",
        meaningEn:
          "The ceiling at which banks can borrow overnight from the central bank — the effective cap on short-term money cost.",
      });
    }
    const interbank = related.get("Interbank Rate");
    const ibVal = interbank ? num(interbank.last) : null;
    if (ibVal != null) {
      rows.push({
        key: "interbank",
        value: ibVal,
        previous: interbank ? num(interbank.prev) : null,
        reference: interbank?.ref ?? "",
        meaningAr:
          "السعر الفعلي الذي تتداول به البنوك فيما بينها يومياً — قراءة السوق الحية لندرة النقد قبل أي قرار رسمي.",
        meaningEn:
          "The rate banks actually trade at with each other daily — the market's live reading of money tightness ahead of any official decision.",
      });
    }

    const data: RatesData = {
      rows,
      nextDecision: parseNextDecision(html),
      source: "Trading Economics — Central Bank of Egypt data",
      sourceUrl: "https://tradingeconomics.com/egypt/interest-rate",
      fetchedAt: new Date().toISOString(),
    };
    ratesCache = { data, at: Date.now() };
    return data;
  })();
  ratesInflight = p;
  try {
    return await p;
  } finally {
    ratesInflight = null;
  }
}
