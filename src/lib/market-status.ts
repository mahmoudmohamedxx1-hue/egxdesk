/** EGX market status — pure date math, safe on client and server.
 *  Trading hours: Sunday–Thursday, 10:00–14:30 Africa/Cairo.
 *
 *  Holiday awareness (Task 20): fixed national holidays are exact; religious
 *  dates follow the lunar Hijri calendar and are APPROXIMATE to ±1 day (and
 *  the exchange sometimes closes more days around Eid than listed here) —
 *  they are a heuristic for the status chip, never a trading calendar. When
 *  in doubt the data itself is the source of truth: on an unlisted holiday
 *  quotes simply stop updating, so `lastSession` still shows the last real
 *  session from the data's perspective. */

export type MarketStatus = {
  open: boolean;
  /** trading day that the last quotes belong to (YYYY-MM-DD) */
  lastSession: string;
  cairoTime: string;
  cairoDate: string;
  weekday: string;
};

/** Fixed national holidays (exact every year). */
const FIXED_HOLIDAYS = ["01-01", "01-07", "01-25", "04-25", "05-01", "07-23", "10-06"];

/** Fixed-date set per year (fast membership check). */
function isFixedHoliday(ymd: string): boolean {
  return FIXED_HOLIDAYS.includes(ymd.slice(5));
}

/** Religious holidays (approximate, ±1 day) + multi-day Eid closures.
 *  Keys: full YYYY-MM-DD. Maintained for the current ±2 years. */
const RELIGIOUS_HOLIDAYS = new Set<string>([
  // 2026 (past dates kept for completeness — harmless)
  "2026-03-19", "2026-03-20", "2026-03-21", // Eid al-Fitr ≈ Mar 20
  "2026-04-13", // Sham El-Nessim (Coptic Easter Apr 12 + 1)
  "2026-05-26", "2026-05-27", "2026-05-28", // Eid al-Adha ≈ May 27
  "2026-06-16", // Islamic New Year ≈ Jun 16
  "2026-08-25", // Mawlid an-Nabi ≈ Aug 25
  // 2027
  "2027-03-09", "2027-03-10", "2027-03-11", // Eid al-Fitr ≈ Mar 10
  "2027-05-03", // Sham El-Nessim (Coptic Easter May 2 + 1)
  "2027-05-16", "2027-05-17", "2027-05-18", // Eid al-Adha ≈ May 17
  "2027-06-06", // Islamic New Year ≈ Jun 6
  "2027-08-14", // Mawlid an-Nabi ≈ Aug 14
  // 2028
  "2028-02-26", "2028-02-27", "2028-02-28", // Eid al-Fitr ≈ Feb 27
  "2028-04-17", // Sham El-Nessim (Coptic Easter Apr 16 + 1)
  "2028-05-04", "2028-05-05", "2028-05-06", // Eid al-Adha ≈ May 5
  "2028-05-25", // Islamic New Year ≈ May 25
  "2028-08-03", // Mawlid an-Nabi ≈ Aug 3
]);

function isHoliday(ymd: string): boolean {
  return isFixedHoliday(ymd) || RELIGIOUS_HOLIDAYS.has(ymd);
}

function cairoParts(now: Date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  return parts;
}

/** The YYYY-MM-DD of a Date as seen in Cairo (not the box's local zone). */
function cairoYmd(now: Date): string {
  const p = cairoParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

/** T45 — is this Cairo day an EGX trading day (Sun–Thu, not a listed
 *  holiday)? Exposed for the autonomous agent's weekday scheduler: the
 *  pre-open brief is pointless on a closed day. */
export function isEgxTradingDay(now: Date = new Date()): boolean {
  const p = cairoParts(now);
  return isTradingDay(`${p.year}-${p.month}-${p.day}`, p.weekday ?? "");
}

function isTradingDay(ymd: string, weekday: string): boolean {
  if (!["Sun", "Mon", "Tue", "Wed", "Thu"].includes(weekday)) return false; // Fri/Sat weekend
  return !isHoliday(ymd);
}

export function marketStatus(now: Date = new Date()): MarketStatus {
  const p = cairoParts(now);
  const hour = Number(p.hour ?? "0");
  const minute = Number(p.minute ?? "0");
  const minutes = hour * 60 + minute;
  const day = p.weekday ?? "";
  const todayYmd = `${p.year}-${p.month}-${p.day}`;
  const tradingDay = isTradingDay(todayYmd, day);
  const open = tradingDay && minutes >= 10 * 60 && minutes < 14 * 60 + 30;

  // The session the current quotes belong to: if the market has not opened yet
  // today (or it is a weekend/holiday), the quotes are from the previous
  // trading day.
  let last = new Date(now);
  if (!tradingDay || minutes < 10 * 60) {
    // roll back to the previous trading day (weekends + holidays)
    do {
      last = new Date(last.getTime() - 24 * 3600_000);
    } while (!isTradingDay(cairoYmd(last), cairoParts(last).weekday ?? ""));
  }
  const lp = cairoParts(last);
  return {
    open,
    lastSession: `${lp.year}-${lp.month}-${lp.day}`,
    cairoTime: `${p.hour}:${p.minute}`,
    cairoDate: todayYmd,
    weekday: day,
  };
}
