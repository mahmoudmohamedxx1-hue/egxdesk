"use client";

/** Client-side price-alerts + date-reminders store (G1). Alerts live in
 *  localStorage only — no account, no server. The engine (app shell)
 *  evaluates price conditions against the delayed quote refresh once a
 *  minute and flips each alert to "triggered" exactly once, so a level
 *  fires a single notification, not a storm.
 *
 *  Conditions reference the LAST price (crosses above/below) or the day
 *  change percent (rises/falls by X%) — both computable from
 *  /api/companies rows the site already polls. The fifth condition,
 *  "onDate", is a pure reminder: it needs no quotes and fires the day the
 *  chosen date arrives (earnings day, dividend pay date, assembly…). */

import type { CompanyRow } from "@/components/market/types";

export type AlertCond = "above" | "below" | "risePct" | "fallPct" | "onDate";

export type PriceAlert = {
  id: string;
  ticker: string;
  cond: AlertCond;
  value: number;
  /** YYYY-MM-DD — only used by the "onDate" reminder condition. */
  date?: string;
  createdAt: string; // ISO
  triggeredAt: string | null; // ISO — set once when condition first holds
  triggeredValue: number | null;
};

const ALERTS_KEY = "egx-alerts";
const VALID_CONDS = ["above", "below", "risePct", "fallPct", "onDate"];

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

export function loadAlerts(): PriceAlert[] {
  try {
    const raw = localStorage.getItem(ALERTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (a): a is PriceAlert =>
        a &&
        typeof a === "object" &&
        typeof a.ticker === "string" &&
        typeof a.value === "number" &&
        Number.isFinite(a.value) &&
        VALID_CONDS.includes(a.cond) &&
        (a.cond !== "onDate" || typeof a.date === "string") &&
        (a.triggeredAt === null || typeof a.triggeredAt === "string")
    );
  } catch {
    return [];
  }
}

export function saveAlerts(alerts: PriceAlert[]): void {
  try {
    localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
  } catch {}
}

/** Condition text in the active language, e.g. "COMI crosses above 150". */
export function alertText(a: PriceAlert, lang: "ar" | "en"): string {
  const t = a.ticker;
  switch (a.cond) {
    case "above":
      return lang === "ar" ? `${t} يعبر أعلى ${a.value}` : `${t} crosses above ${a.value}`;
    case "below":
      return lang === "ar" ? `${t} يعبر أدنى ${a.value}` : `${t} crosses below ${a.value}`;
    case "risePct":
      return lang === "ar" ? `${t} يصعد ${a.value}% خلال الجلسة` : `${t} rises ${a.value}% today`;
    case "fallPct":
      return lang === "ar" ? `${t} يهبط ${a.value}% خلال الجلسة` : `${t} falls ${a.value}% today`;
    case "onDate":
      return lang === "ar"
        ? `تذكير بـ${t} — ${a.date ? formatDate(a.date, lang) : ""}`
        : `Reminder for ${t} — ${a.date ? formatDate(a.date, lang) : ""}`;
  }
}

/** Does the row satisfy the alert's condition right now? (Price conditions
 *  only — "onDate" reminders are evaluated by the engine against the local
 *  calendar day instead, no quotes needed.) */
export function conditionHolds(a: PriceAlert, r: CompanyRow): boolean {
  switch (a.cond) {
    case "above":
      return r.close != null && Number.isFinite(r.close) && r.close >= a.value;
    case "below":
      return r.close != null && Number.isFinite(r.close) && r.close <= a.value;
    case "risePct":
      return r.changePct != null && Number.isFinite(r.changePct) && r.changePct >= a.value;
    case "fallPct":
      return r.changePct != null && Number.isFinite(r.changePct) && r.changePct <= -a.value;
    case "onDate":
      return false;
  }
}

/** The observed value that satisfied the condition (for the notification). */
export function observedValue(a: PriceAlert, r: CompanyRow): number | null {
  if (a.cond === "above" || a.cond === "below") return r.close ?? null;
  if (a.cond === "onDate") return null;
  return r.changePct ?? null;
}

/** Has a date-reminder's day arrived (local timezone)? */
export function dateArrived(a: PriceAlert): boolean {
  return a.cond === "onDate" && typeof a.date === "string" && a.date <= todayStr();
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
