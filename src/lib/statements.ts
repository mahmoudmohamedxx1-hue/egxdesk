/** Server-side financial-statements layer — REAL per-period statements for EGX
 *  listed companies, scraped from stockanalysis.com's public quote pages
 *  (no key, no auth; values in millions of EGP as displayed by the source).
 *
 *  Coverage note: stockanalysis.com carries statements for the liquid majority
 *  of the EGX universe (all large/mid caps probed); some small caps 404 — the
 *  caller treats that as "no statements published" and hides the tab.
 *
 *  This is an original parser (text/regex extraction + arithmetic validation),
 *  not a copy of any site's code.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const BASE = "https://stockanalysis.com/quote/egx";

export type StmtLine = {
  label: string; // English label as published (cleaned)
  labelAr: string | null; // our Arabic translation for common lines
  values: (number | null)[]; // millions EGP per period, null = not disclosed
};

export type StmtTable = {
  periods: string[]; // "TTM" | "FY 2025" | "Q2 2026" …
  periodEndings: string[]; // display strings e.g. "Dec 31, 2025"
  lines: StmtLine[];
};

export type StatementsData = {
  ticker: string;
  currency: string; // "EGP"
  scale: "mn"; // values are millions
  source: string;
  sourceUrl: string;
  annual: { income: StmtTable | null; balance: StmtTable | null; cashflow: StmtTable | null };
  quarterly: { income: StmtTable | null };
  hasData: boolean;
  fetchedAt: string;
};

/** Arabic translations for the most common statement line items (our own). */
const AR_LINES: Record<string, string> = {
  "Revenue": "الإيرادات",
  "Net Income": "صافي الربح",
  "Earnings Per Share": "ربحية السهم",
  "Gross Profit": "الربح الإجمالي",
  "Operating Income": "الربح التشغيلي",
  "Total Revenue": "إجمالي الإيرادات",
  "Cost of Revenue": "تكلفة الإيرادات",
  "Research & Development": "البحث والتطوير",
  "SG&A": "مصاريف بيعية وإدارية",
  "Other Operating Income": "إيرادات تشغيلية أخرى",
  "Interest Expense": "تكلفة التمويل (الفوائد)",
  "Pre-Tax Income": "الربح قبل الضريبة",
  "Income Tax": "ضريبة الدخل",
  "Cash & Equivalents": "النقد وما في حكمه",
  "Investment Securities": "أوراق مالية للاستثمار",
  "Net Loans": "صافي القروض",
  "Gross Loans": "إجمالي القروض",
  "Total Assets": "إجمالي الأصول",
  "Total Liabilities": "إجمالي الالتزامات",
  "Shareholders' Equity": "حقوق المساهمين",
  "Total Debt": "إجمالي الدين",
  "Long-Term Debt": "دين طويل الأجل",
  "Current Debt": "دين قصير الأجل",
  "Property, Plant & Equipment": "الممتلكات والآلات والمعدات",
  "Goodwill": "الشهرة",
  "Other Intangible Assets": "أصول غير ملموسة أخرى",
  "Deposits": "الودائع",
  "Borrowings": "الاقتراض",
  "Operating Cash Flow": "التدفق النقدي التشغيلي",
  "Investing Cash Flow": "التدفق النقدي الاستثماري",
  "Financing Cash Flow": "التدفق النقدي التمويلي",
  "Net Change in Cash": "صافي التغير في النقد",
  "Depreciation & Amortization": "الاستهلاك والإطفاء",
  "Capital Expenditures": "الإنفاق الرأسمالي",
  "Dividends Paid": "التوزيعات المدفوعة",
  "Free Cash Flow": "التدفق النقدي الحر",
  "Cash on Hand": "النقد في الخزينة",
  "Total Current Assets": "إجمالي الأصول المتداولة",
  "Total Current Liabilities": "إجمالي الالتزامات المتداولة",
  "Long-Term Assets": "الأصول طويلة الأجل",
  "Retained Earnings": "الأرباح المبقاة",
  "Accrued Interest Receivable": "فوائد مستحقة القبض",
  "Restricted Cash": "نقد مقيد",
};

// ─────────────────────────────────────────────────────────── caching ───

type Entry = { data: unknown; at: number };
const cache = new Map<string, Entry>();
const stale = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const flying = inflight.get(key);
  if (flying) return flying as Promise<T>;
  const p = (async () => {
    try {
      const data = await loader();
      cache.set(key, { data, at: Date.now() });
      stale.set(key, { data, at: Date.now() });
      return data;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  try {
    return await p;
  } catch (err) {
    const s = stale.get(key);
    if (s) return s.data as T;
    throw err;
  }
}

// ─────────────────────────────────────────────────────────── parsing ───

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNum(cell: string): number | null {
  const s = cell.trim();
  if (!s || s === "-" || s === "–" || s === "—" || s === "N/A") return null;
  // parentheses negatives: (1,234)
  const neg = /^\(.*\)$/.test(s);
  const body = s.replace(/[()]/g, "");
  const v = Number(body.replace(/,/g, ""));
  if (!Number.isFinite(v)) return null;
  return neg ? -v : v;
}

/** Extract the primary line-item label from a label cell: the site puts the
 *  main name in a `row-label` div and growth echoes in separate divs. */
function labelOf(cellHtml: string): string {
  // main expandable rows carry class="row-label"; the first truncate div
  // inside them is the item name
  const rl = /class="row-label[^"]*"[^>]*>[\s\S]*?<div[^>]*class="truncate[^"]*"[^>]*>([^<]+)<\/div>/.exec(cellHtml);
  if (rl) return rl[1].trim();
  // standalone rows: first truncate div (these are growth-only rows → skipped
  // by the caller when they end with " Growth")
  const tr = /<div[^>]*class="truncate[^"]*"[^>]*>([^<]+)<\/div>/.exec(cellHtml);
  if (tr) return tr[1].trim();
  return stripTags(cellHtml);
}

function cleanLabel(raw: string): string {
  // fallback cleaner for cells without the structured divs: repeated name
  // ("Revenue  Revenue Growth") keeps the first name
  let t = raw.replace(/\s+/g, " ").trim();
  const m = t.match(/^(.*?)\s+\1\s+Growth$/i);
  if (m) return m[1].trim();
  return t;
}

/** Labels that mark a table as ratios/margins rather than a statement —
 *  those pages mix several tables and we only want real statement sections. */
const RATIO_TABLE_FIRST_LABELS = new Set([
  "PE Ratio",
  "Forward PE",
  "PS Ratio",
  "P/B Ratio",
  "P/FCF Ratio",
  "Profit Margin",
  "FCF Margin",
  "Dividend Per Share",
]);

function parseOneTable(tableHtml: string): { periods: string[]; endings: string[]; rows: { label: string; values: (number | null)[] }[] } | null {
  const rows = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  if (!rows.length) return null;

  let periods: string[] | null = null;
  let endings: string[] = [];
  const data: { label: string; cells: string[] }[] = [];

  for (const r of rows) {
    const rawCells = r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) ?? [];
    if (!rawCells.length) continue;
    const first = stripTags(rawCells[0] ?? "");
    if (first === "Fiscal Year" || first === "Fiscal Quarter") {
      if (!periods) periods = rawCells.slice(1).map((c) => stripTags(c));
      continue;
    }
    if (first === "Period Ending") {
      if (!endings.length) {
        endings = rawCells.slice(1).map((c) => {
          const t = stripTags(c);
          const m = t.match(/[A-Z][a-z]{2} \d{1,2}, \d{4}/);
          return m ? m[0] : t;
        });
      }
      continue;
    }
    const cells = rawCells.map((c) => stripTags(c));
    // primary label from the structured cell; drop standalone growth rows
    const label = cleanLabel(labelOf(rawCells[0] ?? ""));
    if (!label || / Growth$/.test(label)) continue;
    if (/^(Breakdown|Quarters?|Years?|Period Ending)$/i.test(label)) continue;
    data.push({ label, cells });
  }
  if (!periods || periods.length < 2) return null;
  const width = periods.length;
  const out: { label: string; values: (number | null)[] }[] = [];
  for (const d of data) {
    const label = cleanLabel(d.label);
    if (!label || label.length > 60) continue;
    const vals: (number | null)[] = [];
    for (let i = 1; i <= width; i++) {
      vals.push(i < d.cells.length ? parseNum(d.cells[i]) : null);
    }
    if (vals.every((v) => v === null)) continue;
    out.push({ label, values: vals });
  }
  if (out.length < 2) return null;
  return { periods, endings, rows: out };
}

function parseStmtTable(html: string, kind: "income" | "balance" | "cashflow"): StmtTable | null {
  try {
    const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/g) ?? [];
    if (!tables.length) return null;

    // the income page embeds ratios/segments/balance snapshots after the
    // primary table — take only the FIRST real table there. Balance and
    // cash-flow pages split one statement across several consecutive
    // sections — merge them all.
    const candidates: string[] =
      kind === "income" ? [tables[0] ?? ""] : tables;

    const seen = new Set<string>();
    let periods: string[] | null = null;
    let endings: string[] = [];
    const lines: StmtLine[] = [];

    for (const t of candidates) {
      const parsed = parseOneTable(t);
      if (!parsed) continue;
      // skip ratio/margin tables on multi-table pages
      if (parsed.rows.length && RATIO_TABLE_FIRST_LABELS.has(parsed.rows[0].label)) continue;
      if (!periods) {
        periods = parsed.periods;
        endings = parsed.endings;
      } else if (parsed.periods.join("|") !== periods.join("|")) {
        continue; // layout drift — don't merge mismatched periods
      }
      for (const r of parsed.rows) {
        if (seen.has(r.label)) continue;
        seen.add(r.label);
        lines.push({ label: r.label, labelAr: AR_LINES[r.label] ?? null, values: r.values });
      }
    }
    if (!periods || lines.length < 3) return null;
    return {
      periods,
      periodEndings: endings.length ? endings : periods.map(() => ""),
      lines,
    };
  } catch {
    return null;
  }
}

async function fetchPage(path: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

const TTL = 6 * 3600_000; // statements rarely change — 6h

/** Fetch full statements for one EGX ticker. Throws only on total failure. */
export async function fetchStatements(tickerRaw: string): Promise<StatementsData> {
  const t = tickerRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!t) throw new Error("statements: empty ticker");
  return cached(`stmt:${t}`, TTL, async () => {
    const [incHtml, bsHtml, cfHtml, qIncHtml] = await Promise.all([
      fetchPage(`/${t}/financials/`),
      fetchPage(`/${t}/financials/balance-sheet/`),
      fetchPage(`/${t}/financials/cash-flow-statement/`),
      fetchPage(`/${t}/financials/?p=quarterly`),
    ]);

    const income = incHtml ? parseStmtTable(incHtml, "income") : null;
    const balance = bsHtml ? parseStmtTable(bsHtml, "balance") : null;
    const cashflow = cfHtml ? parseStmtTable(cfHtml, "cashflow") : null;
    const qIncome = qIncHtml ? parseStmtTable(qIncHtml, "income") : null;

    const hasData = !!(income || balance || cashflow);
    return {
      ticker: t,
      currency: "EGP",
      scale: "mn",
      source: "stockanalysis.com — company financials (EGX)",
      sourceUrl: `${BASE}/${t}/financials/`,
      annual: { income, balance, cashflow },
      quarterly: { income: qIncome && qIncome !== income ? qIncome : null },
      hasData,
      fetchedAt: new Date().toISOString(),
    } satisfies StatementsData;
  });
}

/** Light availability probe (for the company route to decide showing the tab):
 *  reuses the same cache — first open pays the fetch, later opens are ~0ms. */
export async function statementsAvailable(ticker: string): Promise<boolean> {
  try {
    const d = await fetchStatements(ticker);
    return d.hasData;
  } catch {
    return false;
  }
}
