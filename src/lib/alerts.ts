"use client";

/** Client-side price-alerts store (G1). Alerts live in localStorage only —
 *  no account, no server. The engine (app shell) evaluates them against the
 *  delayed quote refresh once a minute and flips each alert to "triggered"
 *  exactly once, so a level fires a single notification, not a storm.
 *
 *  Conditions reference the LAST price (crosses above/below) or the day
 *  change percent (rises/falls by X%) — both computable from /api/companies
 *  rows the site already polls. */

import type { CompanyRow } from "@/components/market/types";

export type AlertCond = "above" | "below" | "risePct" | "fallPct";

export type PriceAlert = {
  id: string;
  ticker: string;
  cond: AlertCond;
  value: number;
  createdAt: string; // ISO
  triggeredAt: string | null; // ISO — set once when condition first holds
  triggeredValue: number | null;
};

const ALERTS_KEY = "egx-alerts";

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
        ["above", "below", "risePct", "fallPct"].includes(a.cond) &&
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
  }
}

/** Does the row satisfy the alert's condition right now? */
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
  }
}

/** The observed value that satisfied the condition (for the notification). */
export function observedValue(a: PriceAlert, r: CompanyRow): number | null {
  if (a.cond === "above" || a.cond === "below") return r.close ?? null;
  return r.changePct ?? null;
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
