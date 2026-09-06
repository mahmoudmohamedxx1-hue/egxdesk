/** EGX market status — pure date math, safe on client and server.
 *  Trading hours: Sunday–Thursday, 10:00–14:30 Africa/Cairo. */

export type MarketStatus = {
  open: boolean;
  /** trading day that the last quotes belong to (YYYY-MM-DD) */
  lastSession: string;
  cairoTime: string;
  cairoDate: string;
  weekday: string;
};

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

export function marketStatus(now: Date = new Date()): MarketStatus {
  const p = cairoParts(now);
  const hour = Number(p.hour ?? "0");
  const minute = Number(p.minute ?? "0");
  const minutes = hour * 60 + minute;
  const day = p.weekday ?? "";
  const isTradingDay = ["Sun", "Mon", "Tue", "Wed", "Thu"].includes(day);
  const open = isTradingDay && minutes >= 10 * 60 && minutes < 14 * 60 + 30;

  // The session the current quotes belong to: if the market has not opened yet
  // today (or it is a weekend), the quotes are from the previous trading day.
  let last = new Date(now);
  if (!isTradingDay || minutes < 10 * 60) {
    // roll back to the previous trading day
    do {
      last = new Date(last.getTime() - 24 * 3600 * 1000);
    } while (!["Sun", "Mon", "Tue", "Wed", "Thu"].includes(cairoParts(last).weekday ?? ""));
  }
  const lp = cairoParts(last);
  return {
    open,
    lastSession: `${lp.year}-${lp.month}-${lp.day}`,
    cairoTime: `${p.hour}:${p.minute}`,
    cairoDate: `${p.year}-${p.month}-${p.day}`,
    weekday: day,
  };
}
