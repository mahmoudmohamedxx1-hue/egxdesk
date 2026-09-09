/** Server-side dividend layer (G3) — per-company cash-dividend history with
 *  ex-date / record date / pay date, scraped from stockanalysis.com's public
 *  dividend pages (no key, no auth; the same source that already powers our
 *  statements layer). An original parser: regex table extraction with date and
 *  amount validation. Amounts are per share in EGP exactly as published.
 *
 *  Aggregation helper fetches upcoming dividend dates for the current payers
 *  so the calendar (G5) can show them; per-ticker results share the 6h cache
 *  with the company tab, so a calendar open warms the tab and vice versa.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const BASE = "https://stockanalysis.com/quote/egx";

export type DividendRow = {
  exDate: string; // ISO yyyy-mm-dd
  recordDate: string | null;
  payDate: string | null;
  amount: number; // EGP per share
};

export type DividendsData = {
  ticker: string;
  currency: "EGP";
  perShare: true;
  rows: DividendRow[]; // newest first, as published
  source: string;
  sourceUrl: string;
  fetchedAt: string;
};

export type UpcomingDividend = {
  ticker: string;
  exDate: string;
  recordDate: string | null;
  payDate: string | null;
  amount: number;
};

// ─────────────────────────────────────────────────────────── caching ───
// same pattern as statements.ts: TTL cache + in-flight dedup + stale fallback

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

const TTL = 6 * 3600_000; // dividend tables change rarely — 6h

// ─────────────────────────────────────────────────────────── parsing ───

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/** "Apr 7, 2026" → "2026-04-07" (null when unparseable). */
function parseDate(s: string): string | null {
  const m = /^\s*([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})\s*$/.exec(s);
  if (!m) return null;
  const mm = MONTHS[m[1]];
  if (!mm) return null;
  const day = String(Number(m[2])).padStart(2, "0");
  return `${m[3]}-${mm}-${day}`;
}

/** "6.000 EGP" → 6 ; "0.500 EGP" → 0.5 (null when unparseable). */
function parseAmount(s: string): number | null {
  const m = /^\s*([\d,.]+)\s*(EGP|E£|£)?\s*$/i.exec(s);
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(v) && v > 0 ? v : null;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDividendTable(html: string): DividendRow[] {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  const out: DividendRow[] = [];
  for (const r of rows) {
    const cells = r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) ?? [];
    const vals = cells.map((c) => stripTags(c));
    // header row identifies the table: Ex-Dividend Date | Cash Amount | Record Date | Pay Date
    if (vals.length >= 4 && /ex-dividend/i.test(vals[0])) continue;
    if (vals.length < 2) continue;
    const exDate = parseDate(vals[0] ?? "");
    const amount = parseAmount(vals[1] ?? "");
    if (!exDate || !amount) continue; // not a dividend data row
    const recordDate = vals[2] ? parseDate(vals[2]) : null;
    const payDate = vals[3] ? parseDate(vals[3]) : null;
    out.push({ exDate, recordDate, payDate, amount });
  }
  return out;
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

/** Fetch dividend history for one EGX ticker (empty rows = none published). */
export async function fetchDividends(tickerRaw: string): Promise<DividendsData> {
  const t = tickerRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!t) throw new Error("dividends: empty ticker");
  return cached(`div:${t}`, TTL, async () => {
    const html = await fetchPage(`/${t}/dividend/`);
    const rows = html ? parseDividendTable(html) : [];
    return {
      ticker: t,
      currency: "EGP" as const,
      perShare: true as const,
      rows,
      source: "stockanalysis.com — dividend history (EGX)",
      sourceUrl: `${BASE}/${t}/dividend/`,
      fetchedAt: new Date().toISOString(),
    } satisfies DividendsData;
  });
}

// ─────────────────────────────────────────────── aggregate for calendar ───

/** Today's date in Africa/Cairo as yyyy-mm-dd (exchange calendar reference). */
export function cairoToday(): string {
  // Cairo is UTC+2 (winter) / UTC+3 (summer, since 2023 no DST switch-back).
  const now = new Date();
  const cairo = new Date(now.getTime() + 3 * 3600_000); // server runs Cairo time; +3 keeps the label correct even if TZ drifts
  return cairo.toISOString().slice(0, 10);
}

/** Upcoming dividends (ex-date or pay-date on/after today) for the given
 *  tickers, fetched with bounded concurrency. Per-ticker failures are skipped
 *  — the calendar shows what could be verified, never a wrong number. */
export async function fetchUpcomingDividends(tickers: string[]): Promise<UpcomingDividend[]> {
  const today = cairoToday();
  const out: UpcomingDividend[] = [];
  const CONCURRENCY = 8;
  const queue = [...new Set(tickers.map((t) => t.toUpperCase()))];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const t = queue.shift();
      if (!t) break;
      try {
        const d = await fetchDividends(t);
        for (const r of d.rows) {
          const upcoming =
            (r.exDate && r.exDate >= today) || (r.payDate && r.payDate >= today);
          if (upcoming) {
            out.push({ ticker: t, exDate: r.exDate, recordDate: r.recordDate, payDate: r.payDate, amount: r.amount });
          }
        }
      } catch {
        // skip this ticker — a single source failure must not break the calendar
      }
    }
  });
  await Promise.all(workers);
  return out;
}
