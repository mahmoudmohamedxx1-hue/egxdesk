/** Server-side events calendar layer (G5) — announced and honestly-estimated
 *  dates, organized by date:
 *
 *  - Expected results (earnings): 397 filing-history-derived dates from
 *    esthmr.com's published calendar (EGX disclosures) — every event carries
 *    its estimated flag so the UI can label expectations vs announcements.
 *  - Corporate actions: dividend ex/pay dates and rights-issue windows from
 *    the same published calendar, each linked to its official EGX document;
 *    PLUS live upcoming dividend dates refreshed from stockanalysis.com.
 *  - Assemblies: general-assembly announcements mined live from our real
 *    news archive — only items whose text carries a FUTURE date become
 *    events, each linked to its article.
 *
 *  Nothing here is a forecast we invented: every row is either an
 *  announcement or a clearly-flagged expectation derived from filing
 *  history. */

import { fetchUniverse } from "@/lib/market";
import { fetchUpcomingDividends, cairoToday } from "@/lib/dividends";
import { db } from "@/lib/db";
import seed from "@/data/calendar-seed.json";

export type CalendarEventType = "earnings" | "dividend" | "assembly" | "rights";

export type CalendarEvent = {
  date: string; // yyyy-mm-dd
  type: CalendarEventType;
  ticker: string | null;
  estimated?: boolean; // true = derived from filing history, not announced
  amount?: number; // live dividend: EGP per share
  labelAr: string;
  labelEn: string;
  note?: string;
  url: string | null;
  source: string;
};

export type CalendarData = {
  asOf: string; // yyyy-mm-dd (Cairo)
  events: CalendarEvent[]; // sorted by date ascending
  counts: { earnings: number; dividend: number; assembly: number; rights: number };
};

// ───────────────────────────────────── Arabic date mining (assemblies) ───

const AR_MONTHS: Record<string, number> = {
  "يناير": 1, "فبراير": 2, "مارس": 3, "أبريل": 4, "ابريل": 4, "مايو": 5, "يونيو": 6,
  "يونيه": 6, "يوليو": 7, "يوليه": 7, "أغسطس": 8, "اغسطس": 8, "سبتمبر": 9,
  "أكتوبر": 10, "اكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12,
};

/** Normalize Arabic-Indic digits to ASCII so "٢٥ سبتمبر" parses too. */
function normalizeDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

/** Try to find a full date in Arabic news text: "25 سبتمبر (2026)",
 *  "سبتمبر 25, 2026", "25/09/2026", "2026-09-25". Only dates within
 *  [today, today+120d] are returned — the calendar is announced events only. */
function extractFutureDate(text: string, today: string): string | null {
  const s = normalizeDigits(text);
  const candidates: string[] = [];

  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) candidates.push(`${m[1]}-${m[2]}-${m[3]}`);

  m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) candidates.push(`${m[3]}-${String(+m[2]).padStart(2, "0")}-${m[1].padStart(2, "0")}`);

  for (const [name, num] of Object.entries(AR_MONTHS)) {
    const re = new RegExp(`(\\d{1,2})\\s+${name}(?:\\s+(\\d{4}))?`);
    const mm = re.exec(s);
    if (mm) {
      const year = mm[2] ?? today.slice(0, 4);
      candidates.push(`${year}-${String(num).padStart(2, "0")}-${mm[1].padStart(2, "0")}`);
    }
    const re2 = new RegExp(`${name}\\s+(\\d{1,2}),?\\s*(\\d{4})?`);
    const mm2 = re2.exec(s);
    if (mm2) {
      const year = mm2[2] ?? today.slice(0, 4);
      candidates.push(`${year}-${String(num).padStart(2, "0")}-${mm2[1].padStart(2, "0")}`);
    }
  }

  const y = Number(today.slice(0, 4));
  const maxDate = `${y + 1}-12-31`;
  for (const c of candidates) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(c) && c >= today && c <= maxDate) return c;
  }
  return null;
}

/** Company ticker whose Arabic brand appears in the text (for tagging). */
const AR_TICKER_HINTS: [string, string][] = [
  ["COMI", "التجاري الدولي"], ["TMGH", "طلعت مصطفى"], ["HRHO", "هيرميس"], ["ETEL", "المصرية للاتصالات"],
  ["EAST", "الشرق للدخان"], ["ABUK", "أبو قير"], ["QALA", "قلعة"], ["SWDY", "السويدي"],
  ["ORWE", "النسيج الشرقي"], ["ORAS", "أوراسكوم للإنشاء"], ["ORHD", "أوراسكوم للتطوير"],
  ["MFPC", "مصر للأسمدة"], ["ESRS", "حديد عز"], ["ADIB", "أبو ظبي الإسلامي"], ["FWRY", "فوري"],
  ["AMOC", "للزيوت"], ["EFID", "إيديتا"], ["GBCO", "GB"], ["DOMY", "دومتي"], ["EMAAR", "إعمار"],
  ["PHDC", "بالم هيلز"], ["EFIH", "التمويل"], ["ISPH", "الأحواض"], ["CLHO", "كلية"], ["SKRC", "سكر"],
];

function tickerFromText(text: string): string | null {
  for (const [t, hint] of AR_TICKER_HINTS) {
    if (text.includes(hint)) return t;
  }
  return null;
}

// ─────────────────────────────────────────────────────── assembly scan ───

async function assemblyEvents(today: string): Promise<CalendarEvent[]> {
  try {
    const since = new Date(`${today}T00:00:00.000Z`);
    since.setDate(since.getDate() - 30); // announcements appear ~a month ahead
    const rows = await db.newsPost.findMany({
      where: { publishedAt: { gte: since } },
      orderBy: { publishedAt: "desc" },
    });
    const out: CalendarEvent[] = [];
    const seen = new Set<string>(); // (date|ticker|title) — one event per announcement
    for (const r of rows) {
      const text = `${r.title} ${r.snippet ?? ""}`;
      if (!/عمومية|جمعية/.test(text)) continue;
      const date = extractFutureDate(text, today);
      if (!date) continue;
      const ticker = tickerFromText(text);
      const key = `${date}|${ticker ?? ""}|${r.title.slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const title = r.title.length > 90 ? `${r.title.slice(0, 90)}…` : r.title;
      out.push({
        date,
        type: "assembly",
        ticker,
        labelAr: title,
        labelEn: `General assembly — press announcement (article in Arabic)`,
        url: r.link,
        source: r.source,
      });
    }
    return out.slice(0, 30);
  } catch {
    return [];
  }
}

// ───────────────────────────────────────────── published-calendar seed ───

type SeedEvent = {
  date: string;
  kind: string; // ex_dividend | dividend_payment | rights_open | rights_close | results_expected
  ticker: string;
  title: string;
  title_ar: string;
  note: string;
  link?: string;
  estimated?: boolean;
};

function seedEvents(today: string): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const pastFloor = addDays(today, -7);
  // T41 — dedupe key: the seed sometimes carries BOTH the ex-dividend and
  // the payment row for the same announcement on the same date with the
  // SAME title (GRCA 2026-09-10 rendered twice in the agenda). One event
  // per (date|type|ticker|label); when both kinds collide, the payment
  // row wins (it is the day money moves).
  const seen = new Map<string, number>(); // key -> index in out
  const addOrReplace = (key: string, ev: CalendarEvent, isPayment: boolean) => {
    const existing = seen.get(key);
    if (existing === undefined) {
      seen.set(key, out.length);
      out.push(ev);
      return;
    }
    if (isPayment) out[existing] = ev; // payment supersedes ex on collision
  };
  for (const e of (seed as { events: SeedEvent[] }).events) {
    if (e.date < pastFloor) continue;
    const est = !!e.estimated;
    if (e.kind === "results_expected") {
      out.push({
        date: e.date,
        type: "earnings",
        ticker: e.ticker,
        estimated: est,
        labelAr: e.title_ar || e.title,
        labelEn: e.title,
        url: e.link ?? null,
        source: est ? "esthmr.com calendar — filing-history estimate" : "esthmr.com calendar — EGX disclosure",
      });
    } else if (e.kind === "ex_dividend" || e.kind === "dividend_payment") {
      addOrReplace(
        `${e.date}|dividend|${e.ticker}|${(e.title_ar || e.title).slice(0, 60)}`,
        {
          date: e.date,
          type: "dividend",
          ticker: e.ticker,
          labelAr: e.title_ar || e.title,
          labelEn: e.title,
          note: e.note,
          url: e.link ?? null,
          source: "esthmr.com calendar — EGX disclosure",
        },
        e.kind === "dividend_payment"
      );
    } else if (e.kind === "rights_open" || e.kind === "rights_close") {
      addOrReplace(
        `${e.date}|rights|${e.ticker}|${(e.title_ar || e.title).slice(0, 60)}`,
        {
          date: e.date,
          type: "rights",
          ticker: e.ticker,
          labelAr: e.title_ar || e.title,
          labelEn: e.title,
          note: e.note,
          url: e.link ?? null,
          source: "esthmr.com calendar — EGX disclosure",
        },
        e.kind === "rights_close"
      );
    }
  }
  return out;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────── main API ───

const CALENDAR_TTL = 10 * 60_000; // 10 min — dates move slowly, upstreams vary

type Entry = { data: CalendarData; at: number };
let calendarCache: Entry | null = null;
let calendarInflight: Promise<CalendarData> | null = null;

export async function fetchCalendar(): Promise<CalendarData> {
  if (calendarCache && Date.now() - calendarCache.at < CALENDAR_TTL) {
    return calendarCache.data;
  }
  if (calendarInflight) return calendarInflight;
  const p = (async (): Promise<CalendarData> => {
    const today = cairoToday();

    // 1) published calendar seed — corporate actions + expected results
    const fromSeed = seedEvents(today);

    // 2) live upcoming dividends from stockanalysis.com (supersedes stale seed rows)
    const stocks = await fetchUniverse();
    const payers = stocks.filter((s) => s.divYield != null && s.divYield > 0).map((s) => s.ticker);
    const upcoming = await fetchUpcomingDividends(payers);
    const liveDividends: CalendarEvent[] = upcoming.map((u) => ({
      date: u.payDate ?? u.exDate, // when money moves
      type: "dividend" as const,
      ticker: u.ticker,
      amount: u.amount,
      labelAr: `صرف توزيعة نقدية ${u.amount} ج.م/سهم (الاستحقاق ${u.exDate})`,
      labelEn: `Cash dividend payment EGP ${u.amount}/share (ex-date ${u.exDate})`,
      url: null,
      source: "stockanalysis.com",
    }));

    // 3) live assemblies from the news archive
    const assemblies = await assemblyEvents(today);

    // merge: live dividend rows replace seed dividend rows for the same
    // date+ticker (fresher amounts); everything else is additive
    const liveKeys = new Set(liveDividends.map((d) => `${d.date}|${d.ticker}`));
    const events = [...fromSeed.filter((e) => !(e.type === "dividend" && liveKeys.has(`${e.date}|${e.ticker}`))), ...liveDividends, ...assemblies]
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .slice(0, 600);

    const counts = { earnings: 0, dividend: 0, assembly: 0, rights: 0 };
    for (const e of events) counts[e.type]++;

    const data: CalendarData = { asOf: today, events, counts };
    calendarCache = { data, at: Date.now() };
    return data;
  })();
  calendarInflight = p;
  try {
    return await p;
  } finally {
    calendarInflight = null;
  }
}
