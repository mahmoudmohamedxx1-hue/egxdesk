"use client";

/** Client-side price-alerts + date-reminders store (G1, upgraded T27 to
 *  multi-condition technical alerts — the P1-4 gap).
 *
 *  Alerts live in localStorage only — no account, no server. The engine (app
 *  shell) evaluates conditions once a minute: quote conditions against the
 *  delayed quote table, indicator conditions (RSI / MACD / MA cross / volume
 *  surge) against the same client-side indicator math the chart uses, fed by
 *  /api/chart candles. ALL conditions must hold simultaneously (AND) — e.g.
 *  "COMI > 90 AND RSI < 30 AND volume > 2× average". Each alert flips to
 *  "triggered" exactly once, firing a toast + browser notification.
 *
 *  The original single-condition format (cond/value) keeps loading through a
 *  migration so no user ever loses a saved alert. */

import type { CompanyRow } from "@/components/market/types";
import { rsiSeries, macdSeries, smaSeries } from "@/lib/indicators";
import { resolveTicker } from "@/lib/ticker-aliases";

/** Legacy single-condition kinds (G1) — kept for migration. */
export type AlertCond = "above" | "below" | "risePct" | "fallPct" | "onDate";

/** T27 — condition kinds the builder offers. Quote-based ones evaluate from
 *  /api/companies rows; indicator ones from /api/chart + client math. */
export type CondKind =
  | "priceAbove"
  | "priceBelow"
  | "chgAbove"
  | "chgBelow"
  | "rsiAbove"
  | "rsiBelow"
  | "macdAbove"
  | "macdBelow"
  | "maCrossUp"
  | "maCrossDown"
  | "volRatioAbove"
  | "onDate";

export type AlertCondition = {
  kind: CondKind;
  value: number;
};

export type PriceAlert = {
  id: string;
  ticker: string;
  /** ALL must hold at the same moment (AND logic). */
  conditions: AlertCondition[];
  /** YYYY-MM-DD — the reminder date when the only condition is onDate. */
  date?: string;
  createdAt: string; // ISO
  triggeredAt: string | null; // ISO — set once when all conditions first hold
  triggeredValue: number | null;
};

const ALERTS_KEY = "egx-alerts";
const VALID_KINDS: CondKind[] = [
  "priceAbove",
  "priceBelow",
  "chgAbove",
  "chgBelow",
  "rsiAbove",
  "rsiBelow",
  "macdAbove",
  "macdBelow",
  "maCrossUp",
  "maCrossDown",
  "volRatioAbove",
  "onDate",
];

/** Indicator conditions — these need candles, not just the quote row. */
export const INDICATOR_KINDS = new Set<CondKind>(["rsiAbove", "rsiBelow", "macdAbove", "macdBelow", "maCrossUp", "maCrossDown"]);

/** Snapshot of client-computed indicator values for one ticker (last bar). */
export type IndSnapshot = {
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  maShort: number | null;
  maLong: number | null;
  maShortPrev: number | null;
  maLongPrev: number | null;
  volRatio: number | null;
};

/** Compute the alert-evaluation snapshot from daily candles (the same math
 *  the price chart uses — /api/chart 6M daily points). Cross conditions
 *  compare the last CLOSED bar against the one before it. */
export function indicatorSnapshot(
  points: { close: number; volume: number | null }[],
): IndSnapshot {
  const n = points.length;
  const closes = points.map((p) => p.close);
  const last = n - 1;
  const snap: IndSnapshot = {
    rsi: null,
    macd: null,
    macdSignal: null,
    maShort: null,
    maLong: null,
    maShortPrev: null,
    maLongPrev: null,
    volRatio: null,
  };
  if (n < 2) return snap;
  const rsi = n >= 15 ? rsiSeries(closes, 14) : null;
  if (rsi) snap.rsi = rsi[last] ?? null;
  const macd = n >= 36 ? macdSeries(closes) : null;
  if (macd) {
    snap.macd = macd.macd[last] ?? null;
    snap.macdSignal = macd.signal[last] ?? null;
  }
  const ma20 = n >= 21 ? smaSeries(closes, 20) : null;
  const ma50 = n >= 51 ? smaSeries(closes, 50) : null;
  if (ma20) {
    snap.maShort = ma20[last] ?? null;
    snap.maShortPrev = ma20[last - 1] ?? null;
  }
  if (ma50) {
    snap.maLong = ma50[last] ?? null;
    snap.maLongPrev = ma50[last - 1] ?? null;
  }
  // volume surge: last bar volume vs the 20-bar mean
  const vols = points.map((p) => (typeof p.volume === "number" ? p.volume : null));
  const lastVol = vols[last];
  if (lastVol != null && lastVol > 0) {
    const vals = vols.slice(Math.max(0, last - 19), last + 1).filter((v): v is number => v != null && v > 0);
    if (vals.length >= 5) {
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      if (mean > 0) snap.volRatio = lastVol / mean;
    }
  }
  return snap;
}

/** Local calendar day as YYYY-MM-DD (the user's own timezone). */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Pretty date for the active language, e.g. "24 سبتمبر 2026" / "Sep 24, 2026". */
export function formatDate(d: string, lang: "ar" | "en"): string {
  const ms = Date.parse(`${d}T00:00:00`);
  if (!Number.isFinite(ms)) return d;
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(ms));
}

const KIND_LABELS: Record<CondKind, { ar: string; en: string }> = {
  priceAbove: { ar: "السعر أعلى من", en: "price above" },
  priceBelow: { ar: "السعر أدنى من", en: "price below" },
  chgAbove: { ar: "التغير اليومي أعلى من", en: "day change above" },
  chgBelow: { ar: "التغير اليومي أدنى من", en: "day change below" },
  rsiAbove: { ar: "‏RSI(14) أعلى من", en: "RSI(14) above" },
  rsiBelow: { ar: "‏RSI(14) أدنى من", en: "RSI(14) below" },
  macdAbove: { ar: "‏MACD أعلى من", en: "MACD above" },
  macdBelow: { ar: "‏MACD أدنى من", en: "MACD below" },
  maCrossUp: { ar: "‏MA20 يعبر صاعدًا فوق MA50", en: "MA20 crosses above MA50" },
  maCrossDown: { ar: "‏MA20 يعبر هابطًا تحت MA50", en: "MA20 crosses below MA50" },
  volRatioAbove: { ar: "الحجم أعلى من (×المتوسط)", en: "volume above (×average)" },
  onDate: { ar: "في تاريخ", en: "on date" },
};

export function kindLabel(kind: CondKind, lang: "ar" | "en"): string {
  return lang === "ar" ? KIND_LABELS[kind].ar : KIND_LABELS[kind].en;
}

/** Kinds offered in the builder (onDate is handled as its own row). */
export const BUILDABLE_KINDS: CondKind[] = VALID_KINDS.filter((k) => k !== "onDate");

/** Legacy → modern mapping for migrated alerts. */
const LEGACY_MAP: Record<AlertCond, AlertCondition[]> = {
  above: [{ kind: "priceAbove", value: 0 }],
  below: [{ kind: "priceBelow", value: 0 }],
  risePct: [{ kind: "chgAbove", value: 0 }],
  fallPct: [{ kind: "chgBelow", value: 0 }],
  onDate: [{ kind: "onDate", value: 0 }],
};

export function loadAlerts(): PriceAlert[] {
  try {
    const raw = localStorage.getItem(ALERTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Partial<PriceAlert>[];
    if (!Array.isArray(arr)) return [];
    return arr
      .map((a): PriceAlert | null => {
        if (!a || typeof a !== "object" || typeof a.ticker !== "string") return null;
        // T27 migration: legacy single-condition alerts become one-condition
        // modern alerts with their value carried over
        let conditions: AlertCondition[] = Array.isArray(a.conditions)
          ? a.conditions.filter(
              (c) => c && typeof c.kind === "string" && VALID_KINDS.includes(c.kind) && typeof c.value === "number" && Number.isFinite(c.value),
            )
          : [];
        if (conditions.length === 0 && typeof (a as { cond?: AlertCond }).cond === "string") {
          const legacy = (a as { cond?: AlertCond }).cond as AlertCond;
          const value = typeof (a as { value?: number }).value === "number" ? ((a as { value?: number }).value as number) : 0;
          const mapped = LEGACY_MAP[legacy] ?? [];
          conditions = mapped.map((c) => ({ ...c, value: legacy === "fallPct" ? -Math.abs(value) : value }));
        }
        if (conditions.length === 0) return null;
        const isReminder = conditions.length === 1 && conditions[0].kind === "onDate";
        return {
          id: String(a.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
          ticker: resolveTicker(a.ticker.toUpperCase()), // T38 — legacy ISIN form -> Reuters ticker
          conditions,
          ...(isReminder && typeof a.date === "string" ? { date: a.date } : {}),
          createdAt: typeof a.createdAt === "string" ? a.createdAt : new Date().toISOString(),
          triggeredAt: a.triggeredAt === null || typeof a.triggeredAt === "string" ? (a.triggeredAt ?? null) : null,
          triggeredValue: typeof a.triggeredValue === "number" ? a.triggeredValue : null,
        };
      })
      .filter((a): a is PriceAlert => a !== null);
  } catch {
    return [];
  }
}

export function saveAlerts(alerts: PriceAlert[]): void {
  try {
    localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
  } catch {}
}

/** Is this alert a pure date reminder? */
export function isReminder(a: PriceAlert): boolean {
  return a.conditions.length === 1 && a.conditions[0].kind === "onDate";
}

/** Condition text in the active language, e.g. "COMI: price above 90 and RSI(14) below 30". */
export function alertText(a: PriceAlert, lang: "ar" | "en"): string {
  if (isReminder(a)) {
    return lang === "ar"
      ? `تذكير بـ${a.ticker} — ${a.date ? formatDate(a.date, lang) : ""}`
      : `Reminder for ${a.ticker} — ${a.date ? formatDate(a.date, lang) : ""}`;
  }
  const parts = a.conditions.map((c) => {
    if (c.kind === "maCrossUp" || c.kind === "maCrossDown") return kindLabel(c.kind, lang);
    const v = c.kind === "chgAbove" || c.kind === "chgBelow" || c.kind === "rsiAbove" || c.kind === "rsiBelow" ? `${Math.abs(c.value)}%` : c.kind === "volRatioAbove" ? `${c.value}×` : String(c.value);
    return `${kindLabel(c.kind, lang)} ${v}`;
  });
  return `${a.ticker}: ${parts.join(lang === "ar" ? " و" : " and ")}`;
}

/** Does one condition hold right now? Quote conditions read the live row;
 *  indicator conditions read the client-computed snapshot. */
export function conditionHolds(
  c: AlertCondition,
  row: CompanyRow | null,
  snap: IndSnapshot | null,
): boolean {
  switch (c.kind) {
    case "priceAbove":
      return row?.close != null && Number.isFinite(row.close) && row.close >= c.value;
    case "priceBelow":
      return row?.close != null && Number.isFinite(row.close) && row.close <= c.value;
    case "chgAbove":
      return row?.changePct != null && Number.isFinite(row.changePct) && row.changePct >= c.value;
    case "chgBelow":
      return row?.changePct != null && Number.isFinite(row.changePct) && row.changePct <= c.value;
    case "rsiAbove":
      return snap?.rsi != null && snap.rsi >= c.value;
    case "rsiBelow":
      return snap?.rsi != null && snap.rsi <= c.value;
    case "macdAbove":
      return snap?.macd != null && snap.macd >= c.value;
    case "macdBelow":
      return snap?.macd != null && snap.macd <= c.value;
    case "maCrossUp":
      return (
        snap?.maShort != null &&
        snap?.maLong != null &&
        snap?.maShortPrev != null &&
        snap?.maLongPrev != null &&
        snap.maShortPrev <= snap.maLongPrev &&
        snap.maShort > snap.maLong
      );
    case "maCrossDown":
      return (
        snap?.maShort != null &&
        snap?.maLong != null &&
        snap?.maShortPrev != null &&
        snap?.maLongPrev != null &&
        snap.maShortPrev >= snap.maLongPrev &&
        snap.maShort < snap.maLong
      );
    case "volRatioAbove":
      return snap?.volRatio != null && snap.volRatio >= c.value;
    case "onDate":
      return false; // handled by the engine against the local calendar day
  }
}

/** Do ALL conditions hold right now? (AND logic — the P1-4 ask.) */
export function conditionsHold(a: PriceAlert, row: CompanyRow | null, snap: IndSnapshot | null): boolean {
  if (isReminder(a)) return false;
  return a.conditions.every((c) => conditionHolds(c, row, snap));
}

/** The observed price (for the notification) when the alert fires. */
export function observedValue(a: PriceAlert, row: CompanyRow | null): number | null {
  if (row?.close != null) return row.close;
  return null;
}

/** Has a date-reminder's day arrived (local timezone)? */
export function dateArrived(a: PriceAlert): boolean {
  return isReminder(a) && typeof a.date === "string" && a.date <= todayStr();
}

/** Ask the browser for notification permission (returns the new state). */
export async function requestNotifyPermission(): Promise<NotificationPermission | null> {
  try {
    if (typeof Notification === "undefined") return null;
    if (Notification.permission === "default") {
      return await Notification.requestPermission();
    }
    return Notification.permission;
  } catch {
    return null;
  }
}

/** Fire a browser notification (best-effort — in-app toasts always fire). */
export function notify(title: string, body: string): void {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      new Notification(title, { body, tag: `egx-${title}`, icon: "/icon-192.png" });
    }
  } catch {}
}
