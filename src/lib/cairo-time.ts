/** T74 — canonical Cairo wall-clock math (Africa/Cairo).
 *
 *  Egypt reintroduced DST in 2023: Cairo is UTC+3 in summer but UTC+2 from
 *  the last Thursday of October to the last Friday of April. Six data-path
 *  files used to hardcode "+3" (charts, news dates, calendar cutoffs) —
 *  every winter that stamped intraday bars one hour into the future and
 *  rolled the "today" label at 21:00 UTC. Everything now goes through
 *  Intl with timeZone:"Africa/Cairo", which the runtime keeps correct
 *  across DST switches, so no offset table lives in this repo.
 *
 *  (`market-status.ts`, `signal-track.ts`, `agent-scheduler.ts` and
 *  `push.ts` already used the Intl pattern — this module is the shared
 *  home so the fixed-offset arithmetic can never creep back.)
 */

const CAIRO_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const CAIRO_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function partsOf(at: Date): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of CAIRO_FMT.formatToParts(at)) out[p.type] = Number(p.value);
  return out;
}

/** Cairo's effective offset from UTC at the given instant, in ms (2h or 3h). */
export function cairoOffsetMs(at: Date = new Date()): number {
  const p = partsOf(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** "YYYY-MM-DD" for the Cairo calendar day of `at`. */
export function cairoDateKey(at: Date = new Date()): string {
  return CAIRO_DATE_FMT.format(at);
}

/** "YYYY-MM-DD HH:MM" — the sortable minute bucket key in Cairo time. */
export function cairoMinuteKey(at: Date = new Date()): string {
  const p = partsOf(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour % 24)}:${pad(p.minute)}`;
}

/** Interpret a Cairo WALL-CLOCK time (the numbers a clock in Cairo shows)
 *  as an absolute Date, DST-correct at that moment. Two-pass resolution —
 *  the standard algorithm for wall-clock → instant around a DST boundary.
 *  Accepts the pieces (not a string) so callers parse their own formats. */
export function cairoWallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const off1 = cairoOffsetMs(new Date(naive));
  const off2 = cairoOffsetMs(new Date(naive - off1));
  return new Date(naive - off2);
}
